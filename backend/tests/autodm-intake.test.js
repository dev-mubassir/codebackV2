/**
 * Auto DM comment intake — real signed webhooks through the real route and
 * the durable delivery inbox; only Meta's HTTP layer is stubbed.
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
  dmWebhook,
  prisma,
  uniq,
} from './helpers/autodm.js';

const require = createRequire(import.meta.url);
const worker = require('../src/features/autodm/worker.js');
const poller = require('../src/features/autodm/poller.js');
const deliveries = require('../src/services/webhookDeliveries.js');
const jobs = require('../src/jobs/index.js');
const instagram = require('../src/lib/instagram.js');

let app;
let restoreFlags;
let graphStub;

beforeAll(async () => {
  const webhookRoutes = (await import('../src/routes/webhook.js')).default;
  app = buildTestApp({ mount: { '/webhooks/instagram': webhookRoutes } });
});

beforeEach(async () => {
  await resetDb();
  restoreFlags = saveFlags();
  process.env.AUTODM_ENABLED = 'true';
  process.env.AUTODM_POLL_MODE = 'off';
  poller.resetPollerState();
  graphStub = installGraphStub();
  vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
  vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreFlags();
});

/** Post a comment webhook and wait until its delivery is fully processed. */
async function deliver(body) {
  expect((await postWebhook(app, body)).status).toBe(200);
  await waitFor(
    async () => (await prisma.webhookDelivery.count({ where: { processedAt: null, payload: { not: null } } })) === 0,
    'the delivery to be processed'
  );
}

const runsFor = (automationId) => prisma.autoDmRun.findMany({ where: { automationId } });

describe('matching', () => {
  it('a keyword comment creates one QUEUED run; a non-matching comment creates none', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t, { keywords: ['guide'] });

    await deliver(commentWebhook(t.igUserId, { text: 'Send me the GUIDE please' }));
    await deliver(commentWebhook(t.igUserId, { text: 'nice video' }));

    const runs = await runsFor(a.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'QUEUED', pendingAction: 'OPENER', source: 'webhook', commenterUsername: 'fan_one' });
  });

  it('exclude words veto a keyword match', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t, { keywords: ['guide'], excludeKeywords: ['refund'] });
    await deliver(commentWebhook(t.igUserId, { text: 'guide or refund?' }));
    expect(await runsFor(a.id)).toHaveLength(0);
  });

  it('SPECIFIC beats ANY, then newest wins — one run per comment', async () => {
    const t = await autodmTenant();
    const any = await createAutomation(t, { name: 'any', keywords: ['guide'] });
    const specific = await createAutomation(t, { name: 'specific', keywords: ['guide'], postScope: 'SPECIFIC', mediaIds: ['media-42'] });
    await deliver(commentWebhook(t.igUserId, { text: 'guide', mediaId: 'media-42' }));
    expect(await runsFor(specific.id)).toHaveLength(1);
    expect(await runsFor(any.id)).toHaveLength(0);
  });

  it('paused automations never match', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t, { status: 'paused' });
    await deliver(commentWebhook(t.igUserId, { text: 'guide' }));
    expect(await runsFor(a.id)).toHaveLength(0);
  });
});

describe('who gets a run', () => {
  it("the account's own comments (our public replies) are ignored — by id and by username", async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t, { triggerType: 'ANY_COMMENT', keywords: [] });
    await deliver(commentWebhook(t.igUserId, { fromId: t.igUserId, text: 'guide' }));
    await deliver(commentWebhook(t.igUserId, { fromId: uniq('other-id'), username: t.account.igUsername.toUpperCase(), text: 'guide' }));
    expect(await runsFor(a.id)).toHaveLength(0);
  });

  it('a duplicate webhook produces one run and exactly one DM', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    const hook = commentWebhook(t.igUserId, { commentId: 'c-dup-1' });
    await deliver(hook);
    // Same comment, different delivery bytes (Meta re-sends with a new time).
    await deliver({ ...hook, entry: [{ ...hook.entry[0], time: hook.entry[0].time + 5 }] });
    expect(await runsFor(a.id)).toHaveLength(1);

    await worker.tick();
    await worker.tick();
    const openers = graphStub.sends().filter((c) => c.body.recipient.comment_id === 'c-dup-1');
    expect(openers).toHaveLength(1);
  });

  it('the same commenter twice on one automation gets one run', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    await deliver(commentWebhook(t.igUserId, { fromId: 'same-fan', text: 'guide' }));
    await deliver(commentWebhook(t.igUserId, { fromId: 'same-fan', text: 'guide again' }));
    expect(await runsFor(a.id)).toHaveLength(1);
  });

  it('a comment payload with a bad shape is ignored', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t, { triggerType: 'ANY_COMMENT', keywords: [] });
    const bad = commentWebhook(t.igUserId);
    bad.entry[0].changes[0].value.from = { id: '../../me/messages?x=1' };
    await deliver(bad);
    expect(await runsFor(a.id)).toHaveLength(0);
  });

  it('a disconnected account is inert', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    await prisma.instagramAccount.update({ where: { id: t.account.id }, data: { connectionStatus: 'DISCONNECTED' } });
    await deliver(commentWebhook(t.igUserId, { text: 'guide' }));
    expect(await runsFor(a.id)).toHaveLength(0);
  });
});

describe('7-day private-reply window', () => {
  it('a comment already 7+ days old creates no run', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    await deliver(commentWebhook(t.igUserId, { time: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    expect(await runsFor(a.id)).toHaveLength(0);
  });

  it('an opener still unsent at 7 days is EXPIRED, not sent', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    await deliver(commentWebhook(t.igUserId, { commentId: 'c-old' }));
    await prisma.autoDmRun.updateMany({
      where: { commentId: 'c-old' },
      data: { commentCreatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000) },
    });
    await worker.tick();
    expect((await runsFor(a.id))[0].status).toBe('EXPIRED');
    expect(graphStub.sends()).toHaveLength(0);
  });
});

describe('kill switch', () => {
  it('AUTODM_ENABLED off: comment webhooks do nothing and touch no Auto DM table; the loop is idle', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    process.env.AUTODM_ENABLED = 'false';
    const automationQuery = vi.spyOn(prisma.autoDmAutomation, 'findMany');
    const runQuery = vi.spyOn(prisma.autoDmRun, 'findMany');
    const claim = vi.spyOn(prisma, '$queryRaw');

    await deliver(commentWebhook(t.igUserId, { text: 'guide' }));
    await worker.tick();

    expect(automationQuery).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(graphStub.calls).toHaveLength(0);
    expect(await prisma.autoDmRun.count({ where: { automationId: a.id } })).toBe(0);
  });

  it('AUTODM_ENABLED off: the messaging seam runs no Auto DM query and the DM is classified', async () => {
    const t = await autodmTenant();
    process.env.AUTODM_ENABLED = 'false';
    const runFindFirst = vi.spyOn(prisma.autoDmRun, 'findFirst');
    const runFindMany = vi.spyOn(prisma.autoDmRun, 'findMany');
    const mid = uniq('mid');
    await postWebhook(app, dmWebhook(t.igUserId, 'someone', { text: 'LINK', mid, quickReplyPayload: `AUTODM:${crypto.randomUUID()}:GET` }));
    const msg = await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM');
    await waitFor(() => jobs.enqueueMessageAnalysis.mock.calls.some((c) => c[0] === msg.id), 'classification enqueue');
    expect(runFindFirst).not.toHaveBeenCalled();
    expect(runFindMany).not.toHaveBeenCalled();
  });
});

describe('webhook plumbing', () => {
  it('comment-only entries never write a WebhookLog row (flag on or off); DM entries still do', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    await deliver(commentWebhook(t.igUserId));
    process.env.AUTODM_ENABLED = 'false';
    await deliver(commentWebhook(t.igUserId));
    expect(await prisma.webhookLog.count({ where: { igUserId: t.igUserId } })).toBe(0);

    process.env.AUTODM_ENABLED = 'true';
    await deliver(dmWebhook(t.igUserId, 'someone', { text: 'hello' }));
    expect(await prisma.webhookLog.count({ where: { igUserId: t.igUserId, eventType: 'messaging' } })).toBe(1);
  });

  it('a comments-only delivery that fails is left for the inbox to retry, and the retry creates the run', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    const blip = vi.spyOn(prisma.autoDmAutomation, 'findMany').mockRejectedValueOnce(new Error('db blip'));

    expect((await postWebhook(app, commentWebhook(t.igUserId, { commentId: 'c-retry' }))).status).toBe(200);
    const row = await waitFor(
      () => prisma.webhookDelivery.findFirst({ where: { processedAt: null, lastError: { not: null } } }),
      'the failed delivery to be recorded'
    );
    expect(await runsFor(a.id)).toHaveLength(0);
    blip.mockRestore();

    // The queue's own retry or the recovery sweep (every 2 min in production)
    // picks it up — whichever runs first; the result is one processed
    // delivery and exactly one run.
    await deliveries.recoverUnprocessedDeliveries({ now: Date.now() + 6 * 60 * 1000 });
    await waitFor(
      async () => (await prisma.webhookDelivery.findUnique({ where: { id: row.id } })).processedAt !== null,
      'the retried delivery to be processed'
    );
    expect(await runsFor(a.id)).toHaveLength(1);
  });

  it('a mixed delivery (DM entry + comment entry) swallows a comment error; the DM is processed', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    vi.spyOn(prisma.autoDmAutomation, 'findMany').mockRejectedValueOnce(new Error('db blip'));
    const mid = uniq('mid');
    const body = {
      object: 'instagram',
      entry: [dmWebhook(t.igUserId, 'someone', { text: 'hi', mid }).entry[0], commentWebhook(t.igUserId).entry[0]],
    };
    expect((await postWebhook(app, body)).status).toBe(200);
    await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM');
    await waitFor(
      async () => (await prisma.webhookDelivery.count({ where: { processedAt: { not: null } } })) === 1,
      'the delivery marked processed'
    );
  });
});

describe('poller (AUTODM_POLL_MODE)', () => {
  function stubComments(commentsByMedia, { failWith } = {}) {
    vi.restoreAllMocks();
    vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
    vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue(undefined);
    graphStub = installGraphStub({
      '/comments': (url) => {
        if (failWith) throw failWith;
        const mediaId = decodeURIComponent(url.split('/').slice(-2)[0]);
        return { data: commentsByMedia[mediaId] || [] };
      },
    });
  }

  const polled = (id, text, fromId = uniq('fan'), at = new Date(Date.now() + 1000)) => ({
    id,
    text,
    timestamp: at.toISOString(),
    from: { id: fromId, username: `u_${fromId}` },
  });

  it('the same comment via poller and then webhook is one run', async () => {
    process.env.AUTODM_POLL_MODE = 'allowlist';
    const t = await autodmTenant();
    const a = await createAutomation(t, { postScope: 'SPECIFIC', mediaIds: ['media-7'] });
    stubComments({ 'media-7': [polled('c-both', 'guide please', 'fan-both')] });

    const stats = await poller.sweep();
    expect(stats.queued).toBe(1);
    await deliver(commentWebhook(t.igUserId, { commentId: 'c-both', fromId: 'fan-both', mediaId: 'media-7' }));

    const runs = await runsFor(a.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].source).toBe('poll');
  });

  it('the same comment via webhook and then poller is one run', async () => {
    process.env.AUTODM_POLL_MODE = 'allowlist';
    const t = await autodmTenant();
    const a = await createAutomation(t, { postScope: 'SPECIFIC', mediaIds: ['media-8'] });
    await deliver(commentWebhook(t.igUserId, { commentId: 'c-both-2', fromId: 'fan-2', mediaId: 'media-8' }));
    stubComments({ 'media-8': [polled('c-both-2', 'guide please', 'fan-2')] });
    await poller.sweep();
    const runs = await runsFor(a.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].source).toBe('webhook');
  });

  it('never picks up comments older than the automation, and caps at 30 new per automation per sweep', async () => {
    process.env.AUTODM_POLL_MODE = 'allowlist';
    const t = await autodmTenant();
    const a = await createAutomation(t, { postScope: 'SPECIFIC', mediaIds: ['media-9'], triggerType: 'ANY_COMMENT', keywords: [] });
    const before = polled('c-before', 'guide', 'fan-before', new Date(Date.now() - 60 * 60 * 1000));
    const many = Array.from({ length: 35 }, (_, i) => polled(`c-many-${i}`, 'hi', `fan-many-${i}`, new Date(Date.now() + 1000 + i)));
    stubComments({ 'media-9': [before, ...many] });

    await poller.sweep();
    const runs = await runsFor(a.id);
    expect(runs).toHaveLength(30);
    expect(runs.some((r) => r.commentId === 'c-before')).toBe(false);
  });

  it('allowlist mode skips owners not on the email list; off does nothing', async () => {
    process.env.AUTODM_POLL_MODE = 'allowlist';
    const t = await autodmTenant({ allowlist: false });
    process.env.AUTODM_SCOPE_ALL = 'true';
    const a = await createAutomation(t, { postScope: 'SPECIFIC', mediaIds: ['media-10'] });
    stubComments({ 'media-10': [polled('c-na', 'guide')] });
    await poller.sweep();
    expect(await runsFor(a.id)).toHaveLength(0);

    process.env.AUTODM_POLL_MODE = 'off';
    expect(await poller.maybePoll()).toBeNull();
    expect(graphStub.calls).toHaveLength(0);
  });

  it('error 368 pauses that account instead of hammering the comment API', async () => {
    process.env.AUTODM_POLL_MODE = 'allowlist';
    const t = await autodmTenant();
    await createAutomation(t, { postScope: 'SPECIFIC', mediaIds: ['media-11'] });
    stubComments({}, { failWith: metaError(368) });
    await poller.sweep();
    const calls = graphStub.calls.length;
    const second = await poller.sweep();
    expect(second.paused).toBe(1);
    expect(graphStub.calls.length).toBe(calls);
  });
});
