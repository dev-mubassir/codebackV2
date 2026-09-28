/**
 * Gate 9B — Auto DM plan limits, usage and enforcement.
 *
 *   1 Auto DM = 1 person who received the opening DM. Reserved atomically
 *   before the opener; released on a definite send failure. Out of quota or
 *   without an active plan (enforcement ON) a run waits as WAITING_QUOTA —
 *   never dropped — and goes out when the period resets or the plan allows
 *   it, or expires 7 days after the comment. Enforcement OFF counts and never
 *   blocks; "No limits" users are never blocked. The poller reads each post
 *   once per sweep, by post age.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb, createUser, createAdmin, expireTrial } from './helpers/db.js';
import { saveFlags, installGraphStub, autodmTenant, createAutomation, metaError, prisma, uniq } from './helpers/autodm.js';

const require = createRequire(import.meta.url);
const autodm = require('../src/features/autodm/index.js');
const worker = require('../src/features/autodm/worker.js');
const poller = require('../src/features/autodm/poller.js');
const quota = require('../src/features/autodm/quota.js');
const limits = require('../src/features/autodm/limits.js');
const entitlementService = require('../src/services/entitlementService.js');
const jobs = require('../src/jobs/index.js');
const instagram = require('../src/lib/instagram.js');
const mailer = require('../src/lib/email/index.js');
const adminRoutes = require('../src/routes/admin.js');

const ORIGIN = 'https://app.test.local';
const DAY = 24 * 60 * 60 * 1000;

let app;
let restoreFlags;
let graphStub;
let usageMail;
let ipSeq = 0;
const nextIp = () => `10.93.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(() => {
  app = buildTestApp({ admin: adminRoutes, mount: { '/api/autodm': autodm.apiRouter } });
});

beforeEach(async () => {
  await resetDb();
  await prisma.autoDmPlanLimit.deleteMany({}); // plans are catalogue rows, not reset per test
  restoreFlags = saveFlags();
  process.env.AUTODM_ENABLED = 'true';
  process.env.AUTODM_POLL_MODE = 'off';
  poller.resetPollerState();
  vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
  vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue(undefined);
  vi.spyOn(mailer, 'sendAdminSecurityAlert').mockResolvedValue({ id: 'mocked', transport: 'mock' });
  usageMail = vi.spyOn(mailer, 'sendAutoDmUsage').mockResolvedValue({ id: 'mocked', transport: 'mock' });
  graphStub = installGraphStub();
});

afterEach(async () => {
  vi.restoreAllMocks();
  restoreFlags();
  await prisma.autoDmPlanLimit.deleteMany({});
});

/** A QUEUED run with its opener due (as intake creates it). */
function queuedRun(t, automation, { commentCreatedAt = new Date() } = {}) {
  return prisma.autoDmRun.create({
    data: {
      id: crypto.randomUUID(),
      userId: t.user.id,
      instagramAccountId: t.account.id,
      automationId: automation.id,
      commentId: uniq('c'),
      commenterId: uniq('fan'),
      status: 'QUEUED',
      pendingAction: 'OPENER',
      nextAttemptAt: new Date(),
      commentCreatedAt,
    },
  });
}

const getRun = (id) => prisma.autoDmRun.findUnique({ where: { id } });
const usedBy = async (userId) => (await prisma.autoDmUsage.findMany({ where: { userId } })).reduce((n, r) => n + r.used, 0);
const trialLimit = (monthlyDms, maxAutomations = 30) => limits.setPlanLimits('TRIAL', { maxAutomations, monthlyDms, displayUnlimited: false });
const enforce = (mode = 'ON') => limits.setEnforcement(mode);

async function customer(t) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: t.user.email, password: t.password });
  expect(res.status).toBe(200);
  return agent;
}

describe('counting and the atomic reservation', () => {
  it('race: 20 concurrent sends at limit-1 -> exactly one sends', async () => {
    await enforce('ON');
    await trialLimit(5);
    const t = await autodmTenant();
    const a = await createAutomation(t);
    // Four already used this period.
    const ctx = await quota.contextFor(t.user.id);
    await prisma.autoDmUsage.create({ data: { userId: t.user.id, periodStart: ctx.periodStart, planCode: 'TRIAL', used: 4 } });

    const runs = [];
    for (let i = 0; i < 20; i += 1) runs.push(await queuedRun(t, a));
    await Promise.all(runs.map((r) => worker.processRun(r.id)));

    expect(graphStub.sends()).toHaveLength(1);
    const after = await Promise.all(runs.map((r) => getRun(r.id)));
    expect(after.filter((r) => r.status === 'OPENER_SENT')).toHaveLength(1);
    expect(after.filter((r) => r.status === 'WAITING_QUOTA')).toHaveLength(19);
    expect(after.filter((r) => r.status === 'WAITING_QUOTA').every((r) => r.lastError === 'QUOTA' && r.pendingAction === null)).toBe(true);
    expect(await usedBy(t.user.id)).toBe(5);
  });

  it('only the opener counts; follow prompts, the link and public replies are free; a definite failure is released', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t, { publicReplyEnabled: true, publicReplies: ['Sent you a DM!'] });
    const run = await queuedRun(t, a);
    await worker.processRun(run.id);
    expect((await getRun(run.id)).status).toBe('OPENER_SENT');
    expect(await usedBy(t.user.id)).toBe(1);

    // The tap and the link message: still 1.
    await prisma.autoDmRun.update({ where: { id: run.id }, data: { pendingAction: 'GET', nextAttemptAt: new Date() } });
    await worker.processRun(run.id);
    expect((await getRun(run.id)).status).toBe('DELIVERED');
    expect(await usedBy(t.user.id)).toBe(1);

    // A definite send failure gives the Auto DM back, and the run retries later.
    graphStub = installGraphStub({
      '/messages': () => {
        throw metaError(2, null, 500);
      },
    });
    const failing = await queuedRun(t, a);
    await worker.processRun(failing.id);
    const retried = await getRun(failing.id);
    expect(retried.status).toBe('QUEUED');
    expect(retried.lastError).toBeTruthy();
    expect(await usedBy(t.user.id)).toBe(1);
  });

  it('an unconfirmed opener counts (the person may have it)', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    graphStub = installGraphStub({
      '/messages': () => {
        throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
      },
    });
    const run = await queuedRun(t, a);
    await worker.processRun(run.id);
    expect((await getRun(run.id)).status).toBe('OPENER_UNCONFIRMED');
    expect(await usedBy(t.user.id)).toBe(1);
  });
});

describe('WAITING_QUOTA: held, never dropped', () => {
  it('held at the limit; released when the period resets', async () => {
    await enforce('ON');
    await trialLimit(1);
    const t = await autodmTenant();
    const a = await createAutomation(t);
    const first = await queuedRun(t, a);
    const held = await queuedRun(t, a);
    await worker.processRun(first.id);
    await worker.processRun(held.id);
    expect((await getRun(held.id)).status).toBe('WAITING_QUOTA');
    expect(graphStub.sends()).toHaveLength(1);

    // Same period: the sweep keeps it held.
    await quota.sweep();
    expect((await getRun(held.id)).status).toBe('WAITING_QUOTA');

    // The cycle rolls (the same clock the plan's credits roll on).
    await prisma.entitlement.update({ where: { userId: t.user.id }, data: { cycleStartedAt: new Date(Date.now() - 4 * DAY), validUntil: new Date(Date.now() + DAY) } });
    await entitlementService.rollCycle(t.user.id);
    const res = await quota.sweep();
    expect(res.released).toBe(1);
    const released = await getRun(held.id);
    expect(released).toMatchObject({ status: 'QUEUED', pendingAction: 'OPENER', lastError: null });
    await worker.processRun(held.id);
    expect((await getRun(held.id)).status).toBe('OPENER_SENT');
    expect(graphStub.sends()).toHaveLength(2);
  });

  it('released when the user upgrades (a plan with room)', async () => {
    await enforce('ON');
    await trialLimit(1);
    const t = await autodmTenant();
    const a = await createAutomation(t);
    await worker.processRun((await queuedRun(t, a)).id);
    const held = await queuedRun(t, a);
    await worker.processRun(held.id);
    expect((await getRun(held.id)).status).toBe('WAITING_QUOTA');

    await prisma.entitlement.update({
      where: { userId: t.user.id },
      data: { planCode: 'STARTER', status: 'ACTIVE', cycleStartedAt: new Date(), validUntil: new Date(Date.now() + 30 * DAY) },
    });
    expect((await quota.sweep()).released).toBe(1);
    await worker.processRun(held.id);
    expect((await getRun(held.id)).status).toBe('OPENER_SENT');
  });

  it('no active plan or trial: held (NO_PLAN) until one exists; then sent', async () => {
    await enforce('ON');
    const t = await autodmTenant();
    const a = await createAutomation(t);
    await expireTrial(t.user.id);
    const held = await queuedRun(t, a);
    await worker.processRun(held.id);
    expect(await getRun(held.id)).toMatchObject({ status: 'WAITING_QUOTA', lastError: 'NO_PLAN' });
    expect(graphStub.sends()).toHaveLength(0);
    expect((await quota.sweep()).released).toBe(0);

    await prisma.entitlement.update({
      where: { userId: t.user.id },
      data: { planCode: 'STARTER', status: 'ACTIVE', cycleStartedAt: new Date(), validUntil: new Date(Date.now() + 30 * DAY) },
    });
    expect((await quota.sweep()).released).toBe(1);
    await worker.processRun(held.id);
    expect((await getRun(held.id)).status).toBe('OPENER_SENT');
  });

  it('expires 7 days after the comment (Instagram no longer allows the reply)', async () => {
    await enforce('ON');
    await trialLimit(0);
    const t = await autodmTenant();
    const a = await createAutomation(t);
    const old = await queuedRun(t, a, { commentCreatedAt: new Date(Date.now() - 6 * DAY) });
    await worker.processRun(old.id);
    expect((await getRun(old.id)).status).toBe('WAITING_QUOTA');

    await prisma.autoDmRun.update({ where: { id: old.id }, data: { commentCreatedAt: new Date(Date.now() - 7 * DAY - 1000) } });
    const res = await quota.sweep();
    expect(res.expired).toBe(1);
    expect(await getRun(old.id)).toMatchObject({ status: 'EXPIRED', lastError: 'QUOTA', pendingAction: null });
    expect(graphStub.sends()).toHaveLength(0);
  });

  it('turning enforcement off releases everything held', async () => {
    await enforce('ON');
    await trialLimit(0);
    const t = await autodmTenant();
    const a = await createAutomation(t);
    const held = [await queuedRun(t, a), await queuedRun(t, a)];
    for (const r of held) await worker.processRun(r.id);
    await enforce('OFF');
    expect((await quota.sweep()).released).toBe(2);
  });

  it('notices: one email at 80% and one at 100%, once per period; none while enforcement is off', async () => {
    await enforce('ON');
    await trialLimit(5);
    const t = await autodmTenant();
    const a = await createAutomation(t);
    for (let i = 0; i < 7; i += 1) await worker.processRun((await queuedRun(t, a)).id);
    expect(usageMail.mock.calls.map((c) => c[1].level)).toEqual([80, 100]);
    expect(usageMail.mock.calls[0][0]).toBe(t.user.email);
    expect(usageMail.mock.calls[1][1]).toMatchObject({ used: 5, limit: 5 });
    const row = await prisma.autoDmUsage.findFirst({ where: { userId: t.user.id } });
    expect(row.warned80At).toBeTruthy();
    expect(row.warned100At).toBeTruthy();

    const u = await (await customer(t)).get('/api/autodm/usage');
    expect(u.body).toMatchObject({ used: 5, limit: 5, held: 2, enforced: true, notice: 'limit' });

    usageMail.mockClear();
    await enforce('OFF');
    const other = await autodmTenant();
    const b = await createAutomation(other);
    for (let i = 0; i < 6; i += 1) await worker.processRun((await queuedRun(other, b)).id);
    expect(usageMail).not.toHaveBeenCalled();
  });
});

describe('enforcement off and "No limits"', () => {
  it('enforcement OFF (the default) counts usage but never blocks', async () => {
    await trialLimit(1, 1);
    const t = await autodmTenant();
    const a = await createAutomation(t);
    for (let i = 0; i < 3; i += 1) await worker.processRun((await queuedRun(t, a)).id);
    expect(graphStub.sends()).toHaveLength(3);
    expect(await usedBy(t.user.id)).toBe(3);

    const agent = await customer(t);
    const second = await agent.post('/api/autodm/automations').send(autoBody(t));
    expect(second.status).toBe(201); // over maxAutomations (1), but nothing is blocked
    const u = await agent.get('/api/autodm/usage');
    expect(u.body).toMatchObject({ used: 3, limit: 1, enforced: false, notice: null, activeAutomations: 2 });
  });

  it('a "No limits" user (tester / Meta reviewer) is never blocked, and still counted', async () => {
    await enforce('ON');
    await trialLimit(1, 1);
    const t = await autodmTenant();
    await limits.setExempt(t.user.id, true, { note: 'meta reviewer' });
    const a = await createAutomation(t);
    for (let i = 0; i < 3; i += 1) await worker.processRun((await queuedRun(t, a)).id);
    expect(graphStub.sends()).toHaveLength(3);
    expect(await usedBy(t.user.id)).toBe(3);

    // No plan at all: still never blocked.
    await expireTrial(t.user.id);
    const r = await queuedRun(t, a);
    await worker.processRun(r.id);
    expect((await getRun(r.id)).status).toBe('OPENER_SENT');

    const agent = await customer(t);
    expect((await agent.post('/api/autodm/automations').send(autoBody(t))).status).toBe(201);
    expect(usageMail).not.toHaveBeenCalled();
  });
});

function autoBody(t, over = {}) {
  return {
    instagramAccountId: t.account.id,
    name: 'Guide',
    postScope: 'ANY',
    triggerType: 'KEYWORDS',
    keywords: ['guide'],
    openerText: 'Tap below or reply LINK.',
    mainText: 'Here you go',
    linkUrl: 'https://example.com/guide',
    linkLabel: 'Open',
    ...over,
  };
}

describe('automation limit', () => {
  it('blocks creating or activating beyond maxAutomations, with a clear message', async () => {
    await enforce('ON');
    await trialLimit(1000, 2);
    const t = await autodmTenant();
    const agent = await customer(t);
    expect((await agent.post('/api/autodm/automations').send(autoBody(t))).status).toBe(201);
    expect((await agent.post('/api/autodm/automations').send(autoBody(t))).status).toBe(201);

    const third = await agent.post('/api/autodm/automations').send(autoBody(t));
    expect(third.status).toBe(409);
    expect(third.body).toMatchObject({ code: 'AUTOMATION_LIMIT', max: 2 });
    expect(third.body.error).toMatch(/allows 2 active automations/);

    const paused = await agent.post('/api/autodm/automations').send(autoBody(t, { status: 'paused' }));
    expect(paused.status).toBe(201);
    expect((await agent.patch(`/api/autodm/automations/${paused.body.id}/status`).send({ status: 'active' })).status).toBe(409);
    expect((await agent.put(`/api/autodm/automations/${paused.body.id}`).send(autoBody(t, { status: 'active' }))).status).toBe(409);
    // Editing an automation that is already active is fine.
    const list = await agent.get('/api/autodm/automations');
    const active = list.body.find((x) => x.status === 'active');
    expect((await agent.put(`/api/autodm/automations/${active.id}`).send(autoBody(t, { name: 'Renamed' }))).status).toBe(200);
    expect(await prisma.autoDmAutomation.count({ where: { userId: t.user.id, status: 'active' } })).toBe(2);
  });

  it('downgrade: keeps the newest N active, pauses the rest with a notice, deletes nothing', async () => {
    const t = await autodmTenant();
    const made = [];
    for (let i = 0; i < 5; i += 1) {
      made.push(await createAutomation(t, { name: `A${i}`, createdAt: new Date(Date.now() - (10 - i) * 60 * 1000) }));
    }
    await enforce('ON');
    await trialLimit(1000, 2); // the plan now allows 2
    const res = await quota.sweep();
    expect(res.paused).toBe(3);
    const rows = await prisma.autoDmAutomation.findMany({ where: { userId: t.user.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.status)).toEqual(['paused_limit', 'paused_limit', 'paused_limit', 'active', 'active']);

    const agent = await customer(t);
    const u = await agent.get('/api/autodm/usage');
    expect(u.body).toMatchObject({ pausedForLimit: 3, activeAutomations: 2, maxAutomations: 2 });
    // Re-activating one is refused while at the limit.
    expect((await agent.patch(`/api/autodm/automations/${made[0].id}/status`).send({ status: 'active' })).status).toBe(409);
    // Pausing one active makes room for it.
    await agent.patch(`/api/autodm/automations/${made[4].id}/status`).send({ status: 'paused' });
    expect((await agent.patch(`/api/autodm/automations/${made[0].id}/status`).send({ status: 'active' })).status).toBe(200);
  });

  it('a paused_limit automation takes no new comments (it is not active)', async () => {
    const t = await autodmTenant();
    await createAutomation(t, { status: 'paused_limit', triggerType: 'ANY_COMMENT', keywords: [] });
    const { intakeComment } = require('../src/features/autodm/intake.js');
    const out = await intakeComment(
      { id: t.account.id, userId: t.user.id, igUserId: t.igUserId, igUsername: 'me' },
      { commentId: uniq('c'), commenterId: uniq('fan'), commenterUsername: 'fan', text: 'hi', mediaId: 'm', createdAt: new Date() }
    );
    expect(out).toBe('no_automation');
  });
});

describe('poller efficiency', () => {
  function pollStub({ recent, timestamps, comments = {} }) {
    const route = (url, body, config) => {
      if (url.includes('/me/media')) return { data: recent };
      if (url.includes('/comments')) {
        const mediaId = decodeURIComponent(url.split('/').slice(-2)[0]);
        return { data: comments[mediaId] || [] };
      }
      if (config && config.params && config.params.fields === 'id,timestamp') {
        const mediaId = decodeURIComponent(url.split('/').pop());
        return { id: mediaId, timestamp: timestamps[mediaId] };
      }
      return { username: 'a_contact' };
    };
    route.kind = 'get';
    graphStub = installGraphStub({ 'graph.instagram.com': route });
  }

  const commentCalls = () => graphStub.calls.filter((c) => c.kind === 'get' && c.url.includes('/comments')).map((c) => decodeURIComponent(c.url.split('/').slice(-2)[0]));

  it('one comments call per post however many automations share it; "any post" reads only the latest 3', async () => {
    process.env.AUTODM_POLL_MODE = 'allowlist';
    const now = Date.now();
    const iso = (ms) => new Date(now - ms).toISOString();
    pollStub({
      recent: [
        { id: 'm-shared', timestamp: iso(60 * 60 * 1000) },
        { id: 'm-recent-1', timestamp: iso(2 * 60 * 60 * 1000) },
        { id: 'm-recent-2', timestamp: iso(3 * DAY) },
      ],
      timestamps: { 'm-old': iso(10 * DAY) },
    });
    const t = await autodmTenant();
    for (let i = 0; i < 3; i += 1) await createAutomation(t, { name: `S${i}`, postScope: 'SPECIFIC', mediaIds: ['m-shared'] });
    await createAutomation(t, { name: 'Old', postScope: 'SPECIFIC', mediaIds: ['m-shared', 'm-old'] });
    await createAutomation(t, { name: 'Any', postScope: 'ANY' });

    const first = await poller.sweep({ now });
    expect(commentCalls().sort()).toEqual(['m-old', 'm-recent-1', 'm-recent-2', 'm-shared']);
    expect(first.mediaPolled).toBe(4);
    const mediaList = graphStub.calls.filter((c) => c.url.includes('/me/media'));
    expect(mediaList).toHaveLength(1);
    expect(mediaList[0].params.limit).toBe(3);

    // 3 minutes later: only posts under 48 hours old are read again.
    graphStub.calls.length = 0;
    await poller.sweep({ now: now + 3 * 60 * 1000 });
    expect(commentCalls().sort()).toEqual(['m-recent-1', 'm-shared']);

    // 16 minutes: plus the 2–7 day old post. The 10-day-old post waits an hour.
    graphStub.calls.length = 0;
    await poller.sweep({ now: now + 16 * 60 * 1000 });
    expect(commentCalls().sort()).toEqual(['m-recent-1', 'm-recent-2', 'm-shared']);

    graphStub.calls.length = 0;
    await poller.sweep({ now: now + 61 * 60 * 1000 });
    expect(commentCalls().sort()).toEqual(['m-old', 'm-recent-1', 'm-recent-2', 'm-shared']);
    // A post's publish time is asked for once, ever.
    expect(graphStub.calls.filter((c) => c.params && c.params.fields === 'id,timestamp')).toHaveLength(0);
    expect(await prisma.autoDmMediaState.count({ where: { instagramAccountId: t.account.id } })).toBe(4);
  });

  it('the tier table', () => {
    const now = Date.now();
    expect(poller.pollIntervalFor(new Date(now - 47 * 60 * 60 * 1000), now)).toBe(2 * 60 * 1000);
    expect(poller.pollIntervalFor(new Date(now - 3 * DAY), now)).toBe(15 * 60 * 1000);
    expect(poller.pollIntervalFor(new Date(now - 8 * DAY), now)).toBe(60 * 60 * 1000);
    expect(poller.pollIntervalFor(null, now)).toBe(2 * 60 * 1000);
  });
});

describe('tenant isolation and the admin page', () => {
  async function adminAgent() {
    const { admin, password } = await createAdmin();
    const agent = request.agent(app);
    const res = await agent.post('/api/admin/login').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).send({ email: admin.email, password });
    expect(res.status).toBe(200);
    return { agent, admin, password };
  }
  async function stepUp(agent, password) {
    expect((await agent.post('/api/admin/step-up').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).send({ password })).status).toBe(200);
  }

  it("a user sees only their own usage; another tenant's never leaks", async () => {
    const a = await autodmTenant();
    const b = await autodmTenant();
    const aa = await createAutomation(a);
    for (let i = 0; i < 3; i += 1) await worker.processRun((await queuedRun(a, aa)).id);
    const ua = await (await customer(a)).get('/api/autodm/usage');
    const ub = await (await customer(b)).get('/api/autodm/usage');
    expect(ua.body.used).toBe(3);
    expect(ub.body.used).toBe(0);
    expect(ub.body.activeAutomations).toBe(0);
    expect(Object.keys(ub.body).sort()).toEqual(
      ['activeAutomations', 'displayUnlimited', 'enforced', 'held', 'limit', 'maxAutomations', 'notice', 'pausedForLimit', 'periodEnd', 'periodStart', 'planCode', 'used'].sort()
    );
    // No access (not on the beta list) = the usual 404.
    const c = await createUser();
    const agent = request.agent(app);
    await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: c.user.email, password: c.password });
    expect((await agent.get('/api/autodm/usage')).status).toBe(404);
  });

  it('customers cannot reach the new admin endpoints', async () => {
    const t = await autodmTenant();
    const agent = await customer(t);
    expect((await agent.put('/api/admin/autodm/enforcement').set('Origin', ORIGIN).send({ mode: 'ON', reason: 'try it' })).status).toBe(404);
    expect((await agent.put('/api/admin/autodm/plan-limits/PRO').set('Origin', ORIGIN).send({ maxAutomations: 1, monthlyDms: 1, displayUnlimited: false, reason: 'try it' })).status).toBe(404);
    expect((await agent.put(`/api/admin/autodm/grants/${t.user.id}/limits`).set('Origin', ORIGIN).send({ noLimits: true, reason: 'try it' })).status).toBe(404);
    expect(await limits.getEnforcement()).toBe('OFF');
    expect(await prisma.autoDmPlanLimit.count()).toBe(0);
    expect(await prisma.autoDmExemption.count()).toBe(0);
  });

  it('enforcement switch and plan limits need step-up and are audited; grants take "No limits"', async () => {
    const t = await autodmTenant();
    const { agent, password } = await adminAgent();

    const page = await agent.get('/api/admin/autodm');
    expect(page.status).toBe(200);
    expect(page.body.enforcement).toBe('OFF');
    const byCode = Object.fromEntries(page.body.planLimits.map((p) => [p.planCode, p]));
    expect(byCode.TRIAL).toMatchObject({ maxAutomations: 30, monthlyDms: 1000, displayUnlimited: false, source: 'default' });
    expect(byCode.STARTER).toMatchObject({ maxAutomations: 100, monthlyDms: 10000, displayUnlimited: false });
    expect(byCode.PRO).toMatchObject({ maxAutomations: 500, monthlyDms: 100000, displayUnlimited: true });
    expect(byCode.ENTERPRISE).toMatchObject({ maxAutomations: 500, monthlyDms: 100000, source: 'default' });

    const put = (path, body) => agent.put(`/api/admin/autodm${path}`).set('Origin', ORIGIN).send(body);
    expect((await put('/enforcement', { mode: 'ON', reason: 'billing is live' })).status).toBe(403);
    expect((await put('/plan-limits/STARTER', { maxAutomations: 120, monthlyDms: 12000, displayUnlimited: false, reason: 'raise' })).status).toBe(403);
    await stepUp(agent, password);
    expect((await put('/enforcement', { mode: 'ON', reason: 'billing is live' })).status).toBe(200);
    expect((await put('/plan-limits/STARTER', { maxAutomations: 120, monthlyDms: 12000, displayUnlimited: false, reason: 'raise' })).status).toBe(200);
    expect((await put('/plan-limits/NOPE', { maxAutomations: 1, monthlyDms: 1, displayUnlimited: false, reason: 'raise' })).status).toBe(404);
    expect((await put('/plan-limits/STARTER', { maxAutomations: -1, monthlyDms: 1, displayUnlimited: false, reason: 'raise' })).status).toBe(400);
    expect(await limits.getPlanLimits('STARTER')).toMatchObject({ maxAutomations: 120, monthlyDms: 12000, source: 'custom' });

    const grant = await agent.post('/api/admin/autodm/grants').set('Origin', ORIGIN).send({ email: t.user.email, note: 'Meta reviewer', noLimits: true });
    expect(grant.body).toMatchObject({ granted: true, noLimits: true });
    expect(await limits.isExempt(t.user.id)).toBe(true);
    expect((await put(`/grants/${t.user.id}/limits`, { noLimits: false, reason: 'review done' })).body.noLimits).toBe(false);
    expect((await put(`/grants/${t.user.id}/limits`, { noLimits: true, reason: 'review again' })).body.noLimits).toBe(true);
    const revoke = await agent.delete(`/api/admin/autodm/grants/${t.user.id}`).set('Origin', ORIGIN).send({ reason: 'beta over' });
    expect(revoke.status).toBe(200);
    expect(await limits.isExempt(t.user.id)).toBe(false);

    const actions = (await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'asc' } })).map((l) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining(['AUTODM_ENFORCEMENT', 'AUTODM_PLAN_LIMITS', 'AUTODM_ACCESS_GRANT', 'AUTODM_NO_LIMITS', 'AUTODM_ACCESS_REVOKE'])
    );
    const planAudit = await prisma.adminAuditLog.findFirst({ where: { action: 'AUTODM_PLAN_LIMITS' } });
    expect(planAudit.targetId).toBe('STARTER');
  });

  it('the admin page lists per-user usage for this period', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    for (let i = 0; i < 2; i += 1) await worker.processRun((await queuedRun(t, a)).id);
    const { agent } = await adminAgent();
    const page = await agent.get('/api/admin/autodm');
    expect(page.body.usage).toEqual([
      expect.objectContaining({ userId: t.user.id, email: t.user.email, planCode: 'TRIAL', used: 2, limit: 1000, noLimits: false }),
    ]);
  });
});
