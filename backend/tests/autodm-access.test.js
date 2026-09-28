/**
 * Gate 8 — admin-controlled Auto DM access.
 *
 *   hasAutoDmAccess = AUTODM_ENABLED AND (EVERYONE OR (BETA AND (grant OR env list)))
 *
 * Covers every rollout mode for granted / env-listed / other users (status,
 * 404s, the connect URL), revoke making the worker, poller, intake and taps
 * inert (and re-grant resuming), and the admin endpoints.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb, createUser, createAdmin } from './helpers/db.js';
import {
  saveFlags,
  setRolloutMode,
  postWebhook,
  waitFor,
  installGraphStub,
  autodmTenant,
  createAutomation,
  commentWebhook,
  dmWebhook,
  prisma,
  uniq,
} from './helpers/autodm.js';

const require = createRequire(import.meta.url);
const autodm = require('../src/features/autodm/index.js');
const worker = require('../src/features/autodm/worker.js');
const poller = require('../src/features/autodm/poller.js');
const jobs = require('../src/jobs/index.js');
const instagram = require('../src/lib/instagram.js');
const mailer = require('../src/lib/email/index.js');
const adminRoutes = require('../src/routes/admin.js');

const ORIGIN = 'https://app.test.local';
const BASE_SCOPE = 'instagram_business_basic,instagram_business_manage_messages';

let app;
let restoreFlags;
let graphStub;
let ipSeq = 0;
const nextIp = () => `10.72.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(async () => {
  const webhookRoutes = (await import('../src/routes/webhook.js')).default;
  app = buildTestApp({
    admin: adminRoutes,
    mount: { '/api/autodm': autodm.apiRouter, '/webhooks/instagram': webhookRoutes },
  });
});

beforeEach(async () => {
  await resetDb();
  restoreFlags = saveFlags();
  process.env.AUTODM_ENABLED = 'true';
  process.env.AUTODM_POLL_MODE = 'off';
  poller.resetPollerState();
  vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
  vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue(undefined);
  vi.spyOn(mailer, 'sendAdminSecurityAlert').mockResolvedValue({ id: 'mocked', transport: 'mock' });
  graphStub = installGraphStub();
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreFlags();
});

async function customer(user, password) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password });
  expect(res.status).toBe(200);
  return agent;
}

/** The authorize URL exactly as the pre-Auto-DM code built it. */
const preAutoDmUrl = (state) =>
  `https://www.instagram.com/oauth/authorize?client_id=${process.env.INSTAGRAM_APP_ID}` +
  `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
  `&scope=${BASE_SCOPE}&response_type=code&state=${encodeURIComponent(state)}`;

async function authorize(agent) {
  const res = await agent.get('/auth/instagram');
  expect(res.status).toBe(302);
  const url = new URL(res.headers.location);
  return {
    scope: url.searchParams.get('scope'),
    byteIdentical: res.headers.location === preAutoDmUrl(url.searchParams.get('state')),
  };
}

const grant = (userId) => prisma.autoDmAccess.create({ data: { userId, note: 'test grant' } });

// ---------------------------------------------------------------------------
// Rollout modes × users
// ---------------------------------------------------------------------------

describe('rollout modes', () => {
  async function threeUsers() {
    const granted = await createUser();
    const listed = await createUser();
    const other = await createUser();
    await grant(granted.user.id);
    process.env.AUTODM_SCOPE_ALLOWLIST = listed.user.email;
    return { granted, listed, other };
  }

  async function view(u) {
    const agent = await customer(u.user, u.password);
    return {
      status: (await agent.get('/api/autodm/status')).body,
      api: (await agent.get('/api/autodm/automations')).status,
      connect: await authorize(agent),
    };
  }

  const NO_ACCESS = { status: { enabled: false }, api: 404, connect: { scope: BASE_SCOPE, byteIdentical: true } };
  const ACCESS = {
    status: { enabled: true, available: true },
    api: 200,
    connect: { scope: `${BASE_SCOPE},instagram_business_manage_comments`, byteIdentical: false },
  };

  it('OFF (the default): nobody has access — not a granted user, not the env list', async () => {
    const u = await threeUsers();
    for (const who of [u.granted, u.listed, u.other]) expect(await view(who)).toEqual(NO_ACCESS);
  });

  it('BETA: granted users and the env list have access; everyone else is byte-identical', async () => {
    const u = await threeUsers();
    await setRolloutMode('BETA');
    expect(await view(u.granted)).toEqual(ACCESS);
    expect(await view(u.listed)).toEqual(ACCESS);
    expect(await view(u.other)).toEqual(NO_ACCESS);
  });

  it('EVERYONE: every user has access', async () => {
    const u = await threeUsers();
    await setRolloutMode('EVERYONE');
    for (const who of [u.granted, u.listed, u.other]) expect(await view(who)).toEqual(ACCESS);
  });

  it('the kill switch overrides every mode', async () => {
    const u = await threeUsers();
    await setRolloutMode('EVERYONE');
    process.env.AUTODM_ENABLED = 'false';
    for (const who of [u.granted, u.listed, u.other]) expect(await view(who)).toEqual(NO_ACCESS);
  });

  it('a no-access user gets 404 on every Auto DM route, never 403', async () => {
    const other = await createUser();
    const agent = await customer(other.user, other.password);
    for (const [method, path] of [
      ['get', '/api/autodm/accounts'],
      ['get', `/api/autodm/automations/${crypto.randomUUID()}`],
      ['post', '/api/autodm/automations'],
      ['post', '/api/autodm/images'],
    ]) {
      const res = await agent[method](path).send({});
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// Revoke / re-grant
// ---------------------------------------------------------------------------

describe('revoking access makes a user inert at once (no data deleted); re-granting resumes', () => {
  async function grantedTenant() {
    const t = await autodmTenant({ allowlist: false }); // BETA, not on the env list
    await grant(t.user.id);
    return t;
  }

  it('worker: a revoked owner\'s queued run is not sent, not failed, not counted; re-grant sends it', async () => {
    const t = await grantedTenant();
    await createAutomation(t);
    const hook = commentWebhook(t.igUserId, { commentId: 'c-revoke' });
    await postWebhook(app, hook);
    const run = await waitFor(() => prisma.autoDmRun.findUnique({ where: { commentId: 'c-revoke' } }), 'the run');

    await prisma.autoDmAccess.delete({ where: { userId: t.user.id } });
    await worker.tick();
    let r = await prisma.autoDmRun.findUnique({ where: { id: run.id } });
    expect(r).toMatchObject({ status: 'QUEUED', pendingAction: 'OPENER', attempts: 0 });
    expect(r.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(graphStub.sends()).toHaveLength(0);
    expect(await prisma.autoDmAutomation.count({ where: { userId: t.user.id } })).toBe(1); // nothing deleted

    await grant(t.user.id);
    await prisma.autoDmRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } }); // time passes
    await worker.tick();
    r = await prisma.autoDmRun.findUnique({ where: { id: run.id } });
    expect(r.status).toBe('OPENER_SENT');
    expect(graphStub.sends()).toHaveLength(1);
  });

  it('intake, poller and taps skip a revoked owner; the DM is sorted normally', async () => {
    process.env.AUTODM_POLL_MODE = 'allowlist';
    const t = await grantedTenant();
    const a = await createAutomation(t, { postScope: 'SPECIFIC', mediaIds: ['media-r'] });
    await prisma.autoDmAccess.delete({ where: { userId: t.user.id } });

    // comment webhook → no run
    await postWebhook(app, commentWebhook(t.igUserId, { commentId: 'c-after-revoke', mediaId: 'media-r' }));
    await waitFor(async () => (await prisma.webhookDelivery.count({ where: { processedAt: null, payload: { not: null } } })) === 0, 'delivery');
    expect(await prisma.autoDmRun.count({ where: { automationId: a.id } })).toBe(0);

    // poller → never reads this account's comments
    const stats = await poller.sweep();
    expect(stats.accounts).toBe(0);
    expect(graphStub.calls.filter((c) => c.url.includes('/comments'))).toHaveLength(0);

    // a LINK reply → an ordinary DM, classified
    const mid = uniq('mid');
    await postWebhook(app, dmWebhook(t.igUserId, 'someone', { text: 'LINK', mid }));
    const msg = await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM');
    await waitFor(() => jobs.enqueueMessageAnalysis.mock.calls.some((c) => c[0] === msg.id), 'classification');
  });

  it('mode back to OFF stops everyone the same way', async () => {
    const t = await autodmTenant(); // BETA + env list
    await createAutomation(t);
    await postWebhook(app, commentWebhook(t.igUserId, { commentId: 'c-off' }));
    const run = await waitFor(() => prisma.autoDmRun.findUnique({ where: { commentId: 'c-off' } }), 'the run');
    await setRolloutMode('OFF');
    await worker.tick();
    expect((await prisma.autoDmRun.findUnique({ where: { id: run.id } })).status).toBe('QUEUED');
    expect(graphStub.sends()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

async function adminAgent() {
  const { admin, password } = await createAdmin();
  const agent = request.agent(app);
  const res = await agent.post('/api/admin/login').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).send({ email: admin.email, password });
  expect(res.status).toBe(200);
  return { agent, admin, password };
}

async function stepUp(agent, password) {
  const res = await agent.post('/api/admin/step-up').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).send({ password });
  expect(res.status).toBe(200);
}

describe('admin endpoints', () => {
  it('a customer, or nobody, cannot reach them (the admin router\'s usual 404)', async () => {
    const u = await createUser();
    const agent = await customer(u.user, u.password);
    expect((await agent.get('/api/admin/autodm')).status).toBe(404);
    expect((await agent.put('/api/admin/autodm/mode').set('Origin', ORIGIN).send({ mode: 'EVERYONE', reason: 'try it', confirm: 'EVERYONE' })).status).toBe(404);
    expect((await agent.post('/api/admin/autodm/grants').set('Origin', ORIGIN).send({ email: u.user.email, note: 'me me me' })).status).toBe(404);
    expect((await request(app).get('/api/admin/autodm')).status).toBe(404);
    expect(await prisma.autoDmAccess.count()).toBe(0);
  });

  it('mode: needs step-up; EVERYONE needs an explicit confirm; every change is audited', async () => {
    const { agent, password } = await adminAgent();
    const put = (body) => agent.put('/api/admin/autodm/mode').set('Origin', ORIGIN).send(body);

    expect((await put({ mode: 'BETA', reason: 'start the beta' })).status).toBe(403); // no step-up
    await stepUp(agent, password);
    expect((await put({ mode: 'BETA', reason: 'start the beta' })).body).toEqual({ mode: 'BETA' });
    expect((await put({ mode: 'EVERYONE', reason: 'go live' })).status).toBe(400);
    expect((await put({ mode: 'EVERYONE', reason: 'go live', confirm: 'EVERYONE' })).body).toEqual({ mode: 'EVERYONE' });
    expect((await put({ mode: 'SOMETIMES', reason: 'nope' })).status).toBe(400);
    expect((await put({ mode: 'OFF' })).status).toBe(400); // a reason is required

    const audits = await prisma.adminAuditLog.findMany({ where: { action: 'AUTODM_ROLLOUT_MODE' }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => a.after)).toEqual([{ value: 'BETA' }, { value: 'EVERYONE' }]);
    expect((await agent.get('/api/admin/autodm')).body.mode).toBe('EVERYONE');
  });

  it('grant by email (the user must exist), list with counts, revoke — all audited, no tokens', async () => {
    const { agent } = await adminAgent();
    const t = await autodmTenant({ allowlist: false });
    await createAutomation(t);

    expect((await agent.post('/api/admin/autodm/grants').set('Origin', ORIGIN).send({ email: 'nobody@nowhere.test', note: 'beta tester' })).status).toBe(404);
    const granted = await agent.post('/api/admin/autodm/grants').set('Origin', ORIGIN).send({ email: t.user.email.toUpperCase(), note: 'beta tester' });
    expect(granted.status).toBe(201);
    expect(await autodm.hasAutoDmAccess({ id: t.user.id, email: t.user.email })).toBe(true);

    const list = await agent.get('/api/admin/autodm');
    expect(list.body.grants).toEqual([
      expect.objectContaining({ userId: t.user.id, email: t.user.email, note: 'beta tester', counts: { automations: 1, dmsSent: 0, failures: 0 } }),
    ]);
    expect(JSON.stringify(list.body)).not.toMatch(/token|accessToken|ciphertext/i);

    const revoked = await agent.delete(`/api/admin/autodm/grants/${t.user.id}`).set('Origin', ORIGIN).send({ reason: 'beta over' });
    expect(revoked.status).toBe(200);
    expect(await autodm.hasAutoDmAccess({ id: t.user.id, email: t.user.email })).toBe(false);
    expect((await agent.delete(`/api/admin/autodm/grants/${t.user.id}`).set('Origin', ORIGIN).send({ reason: 'beta over' })).status).toBe(404);
    expect(await prisma.autoDmAutomation.count({ where: { userId: t.user.id } })).toBe(1); // revoke deletes no data

    const actions = (await prisma.adminAuditLog.findMany({ where: { action: { startsWith: 'AUTODM_ACCESS' } } })).map((a) => a.action).sort();
    expect(actions).toEqual(['AUTODM_ACCESS_GRANT', 'AUTODM_ACCESS_REVOKE']);
  });

  it('a cross-origin admin request is refused by the existing CSRF guard', async () => {
    const { agent } = await adminAgent();
    const u = await createUser();
    const res = await agent.post('/api/admin/autodm/grants').set('Origin', 'https://evil.example').send({ email: u.user.email, note: 'sneaky grant' });
    expect(res.status).toBe(403);
    expect(await prisma.autoDmAccess.count()).toBe(0);
  });
});
