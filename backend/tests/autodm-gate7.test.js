/**
 * Gate 7 fixes: the poller sweeps once across pods (advisory lock + due
 * check), the admin re-subscribe keeps `comments` for Auto DM accounts only,
 * and an opener whose outcome is unknown is never retried but stays tappable.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb, createAdmin } from './helpers/db.js';
import {
  saveFlags,
  postWebhook,
  waitFor,
  installGraphStub,
  autodmTenant,
  createAutomation,
  commentWebhook,
  postbackWebhook,
  dmWebhook,
  prisma,
  uniq,
} from './helpers/autodm.js';

const require = createRequire(import.meta.url);
const worker = require('../src/features/autodm/worker.js');
const poller = require('../src/features/autodm/poller.js');
const { closeLockPool } = require('../src/jobs/scheduler.js');
const jobs = require('../src/jobs/index.js');
const instagram = require('../src/lib/instagram.js');
const mailer = require('../src/lib/email/index.js');
const adminRoutes = require('../src/routes/admin.js');

const ORIGIN = 'https://app.test.local';
const BASE_FIELDS = 'messages,message_reactions,messaging_seen';

let app;
let restoreFlags;
let graphStub;
let ipSeq = 0;
const nextIp = () => `10.71.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(async () => {
  const webhookRoutes = (await import('../src/routes/webhook.js')).default;
  app = buildTestApp({ admin: adminRoutes, mount: { '/webhooks/instagram': webhookRoutes } });
});

afterAll(async () => {
  await closeLockPool();
});

function stub(overrides = {}) {
  vi.restoreAllMocks();
  vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
  vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue(undefined);
  vi.spyOn(mailer, 'sendAdminSecurityAlert').mockResolvedValue({ id: 'mocked', transport: 'mock' });
  graphStub = installGraphStub(overrides);
}

beforeEach(async () => {
  await resetDb();
  restoreFlags = saveFlags();
  process.env.AUTODM_ENABLED = 'true';
  process.env.AUTODM_POLL_MODE = 'off';
  poller.resetPollerState();
  stub();
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreFlags();
});

// ---------------------------------------------------------------------------
// 1. One sweep across pods
// ---------------------------------------------------------------------------

describe('poller lock', () => {
  it('two concurrent sweeps: exactly one runs and calls Meta; a third right after is not due', async () => {
    process.env.AUTODM_POLL_MODE = 'allowlist';
    const t = await autodmTenant();
    await createAutomation(t, { postScope: 'SPECIFIC', mediaIds: ['media-lock'] });
    // A slow comment read holds the lock while the other "pod" tries for it.
    graphStub.get.mockImplementation(async (url, config) => {
      graphStub.calls.push({ kind: 'get', url: String(url), params: config && config.params });
      await new Promise((r) => setTimeout(r, 300));
      return { data: { data: [] } };
    });

    const [a, b] = await Promise.all([poller.sweepOnce(), poller.sweepOnce()]);
    const ran = [a, b].filter((r) => r.ran);
    expect(ran).toHaveLength(1);
    expect([a, b].find((r) => !r.ran).reason).toMatch(/locked|not_due/);
    expect(graphStub.calls.filter((c) => c.url.includes('/comments'))).toHaveLength(1);

    const third = await poller.sweepOnce();
    expect(third).toMatchObject({ ran: false, reason: 'not_due' });
    expect(await prisma.jobRun.count({ where: { jobName: poller.JOB_NAME, success: true } })).toBe(1);
  });

  it('poll mode off: the locked sweep does not even take the lock', async () => {
    const out = await poller.sweepOnce();
    expect(out).toMatchObject({ ran: false, reason: 'disabled' });
    expect(await prisma.jobRun.count({ where: { jobName: poller.JOB_NAME } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Admin re-subscribe
// ---------------------------------------------------------------------------

async function adminAgent() {
  const { admin, password } = await createAdmin();
  const agent = request.agent(app);
  const res = await agent.post('/api/admin/login').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).send({ email: admin.email, password });
  expect(res.status).toBe(200);
  return agent;
}

const subscribeCalls = () =>
  graphStub.calls.filter((c) => c.kind === 'post' && c.url.includes('subscribed_apps')).map((c) => c.params.subscribed_fields);

// lib/instagram.subscribeToWebhooks posts with the fields in `params`, like ours.
describe('admin re-subscribe webhooks', () => {
  it('an Auto DM account (comments granted + access) gets the extended call after the default one', async () => {
    const t = await autodmTenant();
    const agent = await adminAgent();
    const res = await agent
      .post(`/api/admin/accounts/${t.account.id}/resubscribe-webhook`)
      .set('Origin', ORIGIN)
      .send({ reason: 'restore webhooks' });
    expect(res.status).toBe(200);
    expect(subscribeCalls()).toEqual([BASE_FIELDS, `${BASE_FIELDS},comments,messaging_postbacks`]);
  });

  it('everyone else is byte-identical: one default call only', async () => {
    const noAccess = await autodmTenant({ allowlist: false }); // comments granted, but no Auto DM access
    const noScope = await autodmTenant({ commentsGranted: false });
    const agent = await adminAgent();
    for (const t of [noAccess, noScope]) {
      graphStub.calls.length = 0;
      const res = await agent.post(`/api/admin/accounts/${t.account.id}/resubscribe-webhook`).set('Origin', ORIGIN).send({ reason: 'restore webhooks' });
      expect(res.status).toBe(200);
      expect(subscribeCalls()).toEqual([BASE_FIELDS]);
    }
  });

  it('with the kill switch off, an Auto DM account is byte-identical too', async () => {
    const t = await autodmTenant();
    process.env.AUTODM_ENABLED = 'false';
    const agent = await adminAgent();
    await agent.post(`/api/admin/accounts/${t.account.id}/resubscribe-webhook`).set('Origin', ORIGIN).send({ reason: 'restore webhooks' });
    expect(subscribeCalls()).toEqual([BASE_FIELDS]);
  });
});

// ---------------------------------------------------------------------------
// 3. OPENER_UNCONFIRMED
// ---------------------------------------------------------------------------

function timeoutError() {
  const err = new Error('timeout of 15000ms exceeded');
  err.code = 'ECONNABORTED';
  return err;
}

async function queuedRun(t, opts = {}) {
  const hook = commentWebhook(t.igUserId, opts);
  expect((await postWebhook(app, hook)).status).toBe(200);
  return waitFor(() => prisma.autoDmRun.findUnique({ where: { commentId: hook.entry[0].changes[0].value.id } }), 'the run');
}

const getRun = (id) => prisma.autoDmRun.findUnique({ where: { id } });

async function settled() {
  await waitFor(
    async () => (await prisma.webhookDelivery.count({ where: { processedAt: null, payload: { not: null } } })) === 0,
    'deliveries processed'
  );
}

describe('opener outcome unknown', () => {
  it('a timeout marks OPENER_UNCONFIRMED and is never retried; a later tap is accepted and delivers', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    stub({ '/me/messages': () => { throw timeoutError(); } });
    const run = await queuedRun(t, { fromId: 'commenter-9' });

    await worker.tick();
    let r = await getRun(run.id);
    expect(r).toMatchObject({ status: 'OPENER_UNCONFIRMED', pendingAction: null, igsid: 'commenter-9', lastError: 'OPENER_UNCONFIRMED' });

    // Never retried, even if something made it look due.
    await prisma.autoDmRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await worker.tick();
    expect(graphStub.sends().filter((c) => c.body.recipient.comment_id)).toHaveLength(1);

    // The person did get it and taps (Meta's IGSID differs from the comment's from.id).
    stub();
    await postWebhook(app, postbackWebhook(t.igUserId, 'real-igsid-9', `AUTODM:${run.id}:GET`));
    await settled();
    r = await getRun(run.id);
    expect(r).toMatchObject({ igsid: 'real-igsid-9', pendingAction: 'GET', status: 'OPENER_SENT' });
    await worker.tick();
    expect((await getRun(run.id)).status).toBe('DELIVERED');
    expect(graphStub.sends().some((c) => c.body.recipient.id === 'real-igsid-9')).toBe(true);
  });

  it('the reply keyword works for an unconfirmed opener, and the DM is not classified', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    stub({ '/me/messages': () => { throw timeoutError(); } });
    const run = await queuedRun(t, { fromId: 'commenter-10' });
    await worker.tick();
    stub();

    const mid = uniq('mid');
    await postWebhook(app, dmWebhook(t.igUserId, 'commenter-10', { text: 'LINK', mid }));
    await settled();
    const msg = await prisma.message.findFirst({ where: { igMessageId: mid } });
    expect(msg.aiStatus).toBe('autodm');
    await worker.tick();
    expect((await getRun(run.id)).status).toBe('DELIVERED');
  });

  it('a FOLLOWED tap, or a tap for another run id, does not bind an unconfirmed run', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    stub({ '/me/messages': () => { throw timeoutError(); } });
    const run = await queuedRun(t, { fromId: 'commenter-11' });
    await worker.tick();
    stub();

    await postWebhook(app, postbackWebhook(t.igUserId, 'someone', `AUTODM:${run.id}:FOLLOWED`));
    await postWebhook(app, postbackWebhook(t.igUserId, 'someone', `AUTODM:${crypto.randomUUID()}:GET`));
    await settled();
    expect(await getRun(run.id)).toMatchObject({ status: 'OPENER_UNCONFIRMED', pendingAction: null, igsid: 'commenter-11' });
  });

  it('a connection that never reached Meta is an ordinary retry, not unconfirmed', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    stub({
      '/me/messages': () => {
        const err = new Error('getaddrinfo ENOTFOUND graph.instagram.com');
        err.code = 'ENOTFOUND';
        throw err;
      },
    });
    const run = await queuedRun(t);
    await worker.tick();
    expect(await getRun(run.id)).toMatchObject({ status: 'QUEUED', pendingAction: 'OPENER', attempts: 1, lastError: 'NETWORK' });
  });
});
