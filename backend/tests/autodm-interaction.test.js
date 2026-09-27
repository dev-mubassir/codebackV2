/**
 * Auto DM taps, follow gate, main message, and worker failure handling.
 * Real signed webhooks; only Meta's HTTP layer is stubbed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb } from './helpers/db.js';
import {
  saveFlags,
  postWebhook,
  waitFor,
  installGraphStub,
  metaError,
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
const jobs = require('../src/jobs/index.js');
const instagram = require('../src/lib/instagram.js');

let app;
let restoreFlags;
let graphStub;
let enqueue;

beforeAll(async () => {
  const webhookRoutes = (await import('../src/routes/webhook.js')).default;
  app = buildTestApp({ mount: { '/webhooks/instagram': webhookRoutes } });
});

function stub(overrides = {}) {
  vi.restoreAllMocks();
  vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
  enqueue = vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue(undefined);
  graphStub = installGraphStub(overrides);
}

beforeEach(async () => {
  await resetDb();
  restoreFlags = saveFlags();
  process.env.AUTODM_ENABLED = 'true';
  process.env.AUTODM_POLL_MODE = 'off';
  stub();
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreFlags();
});

const getRun = (id) => prisma.autoDmRun.findUnique({ where: { id } });

/** Comment -> run -> opener sent. Returns the OPENER_SENT run. */
async function openRun(t, opts = {}) {
  const hook = commentWebhook(t.igUserId, opts);
  expect((await postWebhook(app, hook)).status).toBe(200);
  const commentId = hook.entry[0].changes[0].value.id;
  const run = await waitFor(() => prisma.autoDmRun.findUnique({ where: { commentId } }), 'the run');
  await worker.tick();
  const opened = await getRun(run.id);
  expect(opened.status).toBe('OPENER_SENT');
  return opened;
}

async function tap(t, run, action, sender = run.igsid) {
  expect((await postWebhook(app, postbackWebhook(t.igUserId, sender, `AUTODM:${run.id}:${action}`))).status).toBe(200);
  await waitFor(
    async () => (await prisma.webhookDelivery.count({ where: { processedAt: null, payload: { not: null } } })) === 0,
    'the postback delivery to be processed'
  );
}

function withFollowStatus(value) {
  // GET /{igsid}?fields=is_user_follow_business
  const route = (url, body, config) => {
    if (config && config.params && config.params.fields === 'is_user_follow_business') {
      if (value instanceof Error) throw value;
      return value === undefined ? {} : { is_user_follow_business: value };
    }
    return { username: 'a_contact' };
  };
  route.kind = 'get';
  return route;
}

describe('follow gate', () => {
  it('follows -> the main message is delivered', async () => {
    const t = await autodmTenant();
    await createAutomation(t, { followGateEnabled: true });
    const run = await openRun(t);
    stub({ 'igsid-': withFollowStatus(true) });
    await tap(t, run, 'GET');
    await worker.tick();
    const done = await getRun(run.id);
    expect(done.status).toBe('DELIVERED');
    expect(done.followChecks).toBe(0);
    expect(done.lastError).toBeNull();
  });

  it('not following -> follow prompt with a FOLLOWED postback; following on the next tap -> delivered', async () => {
    const t = await autodmTenant();
    await createAutomation(t, { followGateEnabled: true, followButtonLabel: "I've followed" });
    const run = await openRun(t);

    stub({ 'igsid-': withFollowStatus(false) });
    await tap(t, run, 'GET');
    await worker.tick();
    let r = await getRun(run.id);
    expect(r.status).toBe('AWAITING_FOLLOW');
    expect(r.followChecks).toBe(1);
    const prompt = graphStub.sends().find((c) => c.body.recipient.id === run.igsid);
    expect(prompt.body.message.attachment.payload.buttons[0]).toEqual({
      type: 'postback',
      title: "I've followed",
      payload: `AUTODM:${run.id}:FOLLOWED`,
    });

    stub({ 'igsid-': withFollowStatus(true) });
    await tap(t, run, 'FOLLOWED');
    await worker.tick();
    r = await getRun(run.id);
    expect(r.status).toBe('DELIVERED');
  });

  it('3 failed checks -> the polite final message, NOT_FOLLOWING, and no link', async () => {
    const t = await autodmTenant();
    await createAutomation(t, { followGateEnabled: true, followFailText: 'Maybe next time.' });
    const run = await openRun(t);
    stub({ 'igsid-': withFollowStatus(false) });

    await tap(t, run, 'GET');
    await worker.tick();
    await tap(t, run, 'FOLLOWED');
    await worker.tick();
    await tap(t, run, 'FOLLOWED');
    await worker.tick();

    const r = await getRun(run.id);
    expect(r.status).toBe('NOT_FOLLOWING');
    expect(r.followChecks).toBe(3);
    const texts = graphStub.sends().map((c) => c.body.message.text).filter(Boolean);
    expect(texts).toContain('Maybe next time.');
    const linkSent = graphStub.sends().some((c) => JSON.stringify(c.body).includes('https://example.com/guide'));
    expect(linkSent).toBe(false);

    // A 4th tap changes nothing.
    await tap(t, run, 'FOLLOWED');
    await worker.tick();
    expect((await getRun(run.id)).followChecks).toBe(3);
  });

  it('Meta will not say (error or missing field) -> FAIL OPEN: link sent, FAIL_OPEN recorded', async () => {
    const t = await autodmTenant();
    await createAutomation(t, { followGateEnabled: true });
    const run = await openRun(t);
    stub({ 'igsid-': withFollowStatus(metaError(10)) });
    await tap(t, run, 'GET');
    await worker.tick();
    const r = await getRun(run.id);
    expect(r.status).toBe('DELIVERED');
    expect(r.lastError).toBe('FAIL_OPEN');
  });

  it('the LINK keyword while waiting for a follow counts as "I followed"', async () => {
    const t = await autodmTenant();
    await createAutomation(t, { followGateEnabled: true });
    const run = await openRun(t);
    stub({ 'igsid-': withFollowStatus(false) });
    await tap(t, run, 'GET');
    await worker.tick();

    stub({ 'igsid-': withFollowStatus(true) });
    const mid = uniq('mid');
    await postWebhook(app, dmWebhook(t.igUserId, run.igsid, { text: 'Link', mid }));
    await waitFor(async () => (await getRun(run.id)).pendingAction === 'FOLLOWED', 'the FOLLOWED claim');
    await worker.tick();
    expect((await getRun(run.id)).status).toBe('DELIVERED');
  });
});

describe('tap security', () => {
  it("another tenant's run id is ignored — and the DM is still classified normally", async () => {
    const a = await autodmTenant();
    await createAutomation(a);
    const runA = await openRun(a);
    const b = await autodmTenant();

    // B's account receives a quick-reply "tap" carrying A's run id, from A's recipient.
    const mid = uniq('mid');
    await postWebhook(app, dmWebhook(b.igUserId, runA.igsid, { text: 'Send me the link', mid, quickReplyPayload: `AUTODM:${runA.id}:GET` }));
    const msg = await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM');
    await waitFor(() => enqueue.mock.calls.some((c) => c[0] === msg.id), 'normal classification');
    expect((await prisma.message.findUnique({ where: { id: msg.id } })).aiStatus).toBe('pending');
    expect((await getRun(runA.id)).pendingAction).toBeNull();

    // Same via postback on B's account: nothing happens to A's run.
    await tap(b, runA, 'GET');
    expect((await getRun(runA.id)).pendingAction).toBeNull();
  });

  it('the right account but the wrong sender is ignored — and the DM is still classified', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    const run = await openRun(t);
    const mid = uniq('mid');
    await postWebhook(app, dmWebhook(t.igUserId, 'someone-else', { text: 'x', mid, quickReplyPayload: `AUTODM:${run.id}:GET` }));
    const msg = await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM');
    await waitFor(() => enqueue.mock.calls.some((c) => c[0] === msg.id), 'normal classification');
    await tap(t, run, 'GET', 'someone-else');
    expect((await getRun(run.id)).pendingAction).toBeNull();
  });

  it('a malformed AUTODM payload is ignored and the DM is classified', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    const mid = uniq('mid');
    await postWebhook(app, dmWebhook(t.igUserId, 'fan', { text: 'x', mid, quickReplyPayload: "AUTODM:' OR 1=1 --:GET" }));
    const msg = await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM');
    await waitFor(() => enqueue.mock.calls.some((c) => c[0] === msg.id), 'normal classification');
  });

  it('LINK from a sender with no open run is an ordinary DM', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    const mid = uniq('mid');
    await postWebhook(app, dmWebhook(t.igUserId, 'stranger', { text: 'LINK', mid }));
    const msg = await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM');
    await waitFor(() => enqueue.mock.calls.some((c) => c[0] === msg.id), 'normal classification');
  });

  it('a double tap sends the main message once', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    const run = await openRun(t);
    await tap(t, run, 'GET');
    await tap(t, run, 'GET');
    await worker.tick();
    await tap(t, run, 'GET');
    await worker.tick();
    const mains = graphStub.sends().filter((c) => c.body.recipient.id === run.igsid);
    expect(mains).toHaveLength(1);
    expect((await getRun(run.id)).status).toBe('DELIVERED');
  });

  it('non-Auto-DM postbacks keep today\'s behaviour (nothing happens)', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    const run = await openRun(t);
    const before = await prisma.message.count();
    expect((await postWebhook(app, postbackWebhook(t.igUserId, run.igsid, 'SOME_OTHER_PAYLOAD'))).status).toBe(200);
    await waitFor(
      async () => (await prisma.webhookDelivery.count({ where: { processedAt: null, payload: { not: null } } })) === 0,
      'the delivery'
    );
    expect(await prisma.message.count()).toBe(before);
    expect((await getRun(run.id)).pendingAction).toBeNull();
  });
});

describe('main message', () => {
  it('image first, then the text; a rejected link template falls back to text + link', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    const image = await prisma.autoDmImage.create({
      data: { id: crypto.randomUUID(), userId: t.user.id, automationId: a.id, contentType: 'image/png', byteSize: 10, data: Buffer.from('0123456789') },
    });
    const run = await openRun(t);
    stub({
      '/me/messages': (url, body) => {
        if (body.message.attachment && body.message.attachment.type === 'template') throw metaError(100);
        return { message_id: 'm' };
      },
    });
    await tap(t, run, 'GET');
    await worker.tick();

    const sends = graphStub.sends();
    expect(sends[0].body.message.attachment).toEqual({ type: 'image', payload: { url: `https://api.test.local/public/autodm/images/${image.id}` } });
    expect(sends[sends.length - 1].body.message.text).toBe('Here is your guide\n\nhttps://example.com/guide');
    const r = await getRun(run.id);
    expect(r.status).toBe('DELIVERED');
    expect(r.mainImageSentAt).not.toBeNull();
  });

  it('a retry after a failed text does not resend the image', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t, { linkUrl: null, linkLabel: null });
    await prisma.autoDmImage.create({
      data: { id: crypto.randomUUID(), userId: t.user.id, automationId: a.id, contentType: 'image/png', byteSize: 3, data: Buffer.from('abc') },
    });
    const run = await openRun(t);
    let failText = true;
    stub({
      '/me/messages': (url, body) => {
        if (body.message.text && failText) {
          failText = false;
          throw metaError(2);
        }
        return { message_id: 'm' };
      },
    });
    await tap(t, run, 'GET');
    await worker.tick();
    expect((await getRun(run.id)).status).toBe('OPENER_SENT'); // retry scheduled
    await prisma.autoDmRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await worker.tick();
    const images = graphStub.sends().filter((c) => c.body.message.attachment && c.body.message.attachment.type === 'image');
    expect(images).toHaveLength(1);
    expect((await getRun(run.id)).status).toBe('DELIVERED');
  });

  it('a public reply is posted at most once, and its failure never blocks the DM', async () => {
    const t = await autodmTenant();
    await createAutomation(t, { publicReplyEnabled: true, publicReplies: ['Sent you a DM!'] });
    stub({ '/replies': () => { throw metaError(2); } });
    const run = await openRun(t);
    expect(run.publicReplyAt).not.toBeNull();
    expect(graphStub.calls.filter((c) => c.url.includes('/replies'))).toHaveLength(1);
  });
});

describe('failures', () => {
  it('a transient Meta error backs off; the 5th failure is FAILED with a safe code', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    stub({ '/me/messages': () => { throw metaError(2); } });
    const hook = commentWebhook(t.igUserId);
    await postWebhook(app, hook);
    const run = await waitFor(() => prisma.autoDmRun.findUnique({ where: { commentId: hook.entry[0].changes[0].value.id } }), 'run');

    await worker.tick();
    let r = await getRun(run.id);
    expect(r).toMatchObject({ status: 'QUEUED', attempts: 1, lastError: 'META_2' });
    expect(r.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await prisma.autoDmRun.update({ where: { id: run.id }, data: { attempts: 4, nextAttemptAt: new Date(Date.now() - 1000) } });
    await worker.tick();
    r = await getRun(run.id);
    expect(r).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'META_2', pendingAction: null });
  });

  it('a dead token fails at once and flags the account for reconnect', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    stub({ '/me/messages': () => { throw metaError(190); } });
    const hook = commentWebhook(t.igUserId);
    await postWebhook(app, hook);
    const run = await waitFor(() => prisma.autoDmRun.findUnique({ where: { commentId: hook.entry[0].changes[0].value.id } }), 'run');
    await worker.tick();
    expect((await getRun(run.id)).status).toBe('FAILED');
    expect((await prisma.instagramAccount.findUnique({ where: { id: t.account.id } })).tokenStatus).toBe('NEEDS_RECONNECT');
  });

  it('at the hourly private-reply cap the opener is re-queued (not failed, not dropped)', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    const now = new Date();
    await prisma.autoDmRun.createMany({
      data: Array.from({ length: worker.PRIVATE_REPLIES_PER_HOUR }, (_, i) => ({
        id: crypto.randomUUID(), userId: t.user.id, instagramAccountId: t.account.id, automationId: a.id,
        commentId: `cap-${i}`, commenterId: `cap-fan-${i}`, status: 'OPENER_SENT', openerSentAt: now, commentCreatedAt: now,
      })),
    });
    const hook = commentWebhook(t.igUserId, { fromId: 'over-cap' });
    await postWebhook(app, hook);
    const run = await waitFor(() => prisma.autoDmRun.findUnique({ where: { commentId: hook.entry[0].changes[0].value.id } }), 'run');
    await worker.tick();
    const r = await getRun(run.id);
    expect(r).toMatchObject({ status: 'QUEUED', pendingAction: 'OPENER', attempts: 0 });
    expect(r.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60 * 1000);
    expect(graphStub.sends()).toHaveLength(0);
  });

  it('a run of a disconnected account fails without calling Meta', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    const hook = commentWebhook(t.igUserId);
    await postWebhook(app, hook);
    const run = await waitFor(() => prisma.autoDmRun.findUnique({ where: { commentId: hook.entry[0].changes[0].value.id } }), 'run');
    await prisma.instagramAccount.update({ where: { id: t.account.id }, data: { connectionStatus: 'DISCONNECTED' } });
    await worker.tick();
    expect(await getRun(run.id)).toMatchObject({ status: 'FAILED', lastError: 'ACCOUNT_DISCONNECTED' });
    expect(graphStub.sends()).toHaveLength(0);
  });
});
