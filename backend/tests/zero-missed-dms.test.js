/**
 * Zero missed DMs — the durable webhook inbox (services/webhookDeliveries.js).
 *
 *   - the payload is saved BEFORE the 200; a failed save answers 503 (Meta retries)
 *   - a processing failure after the 200 leaves the delivery unprocessed, and
 *     the recovery sweep processes it — exactly once per message
 *   - queue unavailable (Redis down): processed in-process, still 200
 *   - AI outage: the DM is saved and visible; only the analysis is retried
 *   - an orphaned analysis (lost queue job) is re-enqueued
 *   - housekeeping never deletes an unprocessed delivery
 *   - the backlog alert fires
 *   - while shutting down, new webhooks get 503 so Meta retries elsewhere
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const instagram = require('../src/lib/instagram.js');
const aiService = require('../src/services/aiService.js');
const deliveries = require('../src/services/webhookDeliveries.js');
const processor = require('../src/services/metaWebhookProcessor.js');
const queue = require('../src/lib/queue.js');
const jobs = require('../src/jobs/index.js');
const { purgeWebhookDeliveries } = require('../src/jobs/purgeJob.js');
const { CHECKS } = require('../src/jobs/alertJob.js');
const health = require('../src/lib/health.js');

let app;
const MIN = 60 * 1000;

const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', process.env.INSTAGRAM_APP_SECRET).update(raw).digest('hex');
const post = (raw) =>
  request(app).post('/webhooks/instagram').set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw)).send(raw);

function dm({ igUserId, mid = uniq('mid'), text = 'hello' }) {
  return JSON.stringify({
    object: 'instagram',
    entry: [{ id: igUserId, time: Date.now(), messaging: [{ sender: { id: uniq('s') }, recipient: { id: igUserId }, timestamp: Date.now(), message: { mid, text } }] }],
  });
}

async function waitFor(fn, what, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function tenant() {
  const { user } = await createUser({});
  const igUserId = uniq('ig');
  await createAccount({ userId: user.id, igUserId });
  return { user, igUserId };
}

beforeAll(async () => {
  const webhookRoutes = (await import('../src/routes/webhook.js')).default;
  app = buildTestApp({ mount: { '/webhooks/instagram': webhookRoutes } });
});

beforeEach(async () => {
  await resetDb();
  vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
  vi.spyOn(aiService, 'analyzeConversation').mockResolvedValue(null);
});

afterEach(() => vi.restoreAllMocks());
afterAll(async () => prisma.$disconnect());

describe('save before acknowledge', () => {
  it('a delivery is stored with its payload, processed, then the payload is cleared', async () => {
    const { igUserId } = await tenant();
    const mid = uniq('mid');
    expect((await post(dm({ igUserId, mid }))).status).toBe(200);

    await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM in the inbox');
    const row = await waitFor(
      () => prisma.webhookDelivery.findFirst({ where: { processedAt: { not: null } } }),
      'the delivery marked processed'
    );
    expect(row.payload, 'no DM text is kept once it is in the inbox').toBeNull();
  });

  it('if the delivery cannot be saved, Meta gets 503 (so it retries) — never a 200', async () => {
    const { igUserId } = await tenant();
    vi.spyOn(prisma.webhookDelivery, 'create').mockRejectedValueOnce(new Error('db down'));
    const res = await post(dm({ igUserId }));
    expect(res.status).toBe(503);
    expect(await prisma.message.count()).toBe(0);
  });
});

describe('recovery', () => {
  it('a processing crash after the 200 leaves the delivery for the sweep, which saves the DM once', async () => {
    const { igUserId } = await tenant();
    const mid = uniq('mid');
    vi.spyOn(processor, 'processEntry').mockRejectedValueOnce(new Error('crashed mid-processing'));

    expect((await post(dm({ igUserId, mid }))).status).toBe(200);
    const stuck = await waitFor(
      () => prisma.webhookDelivery.findFirst({ where: { lastError: { not: null } } }),
      'the failed attempt to be recorded'
    );
    expect(stuck.processedAt).toBeNull();
    expect(stuck.payload).not.toBeNull();
    expect(await prisma.message.count({ where: { igMessageId: mid } })).toBe(0);

    // Five minutes later the sweep takes it.
    const out = await deliveries.recoverUnprocessedDeliveries({ now: Date.now() + 6 * MIN });
    expect(out.recovered).toBe(1);
    expect(await prisma.message.count({ where: { igMessageId: mid } })).toBe(1);

    // Running the sweep again changes nothing.
    await deliveries.recoverUnprocessedDeliveries({ now: Date.now() + 12 * MIN });
    expect(await prisma.message.count({ where: { igMessageId: mid } })).toBe(1);
  });

  it('a Meta retry of a stored-but-unprocessed delivery is acknowledged and still processed once', async () => {
    const { igUserId } = await tenant();
    const mid = uniq('mid');
    const raw = dm({ igUserId, mid });
    vi.spyOn(processor, 'processEntry').mockRejectedValueOnce(new Error('crash'));
    await post(raw);
    await waitFor(() => prisma.webhookDelivery.findFirst({ where: { lastError: { not: null } } }), 'first attempt');

    expect((await post(raw)).status).toBe(200);
    expect(await prisma.webhookDelivery.count()).toBe(1);
    await deliveries.recoverUnprocessedDeliveries({ now: Date.now() + 6 * MIN });
    expect(await prisma.message.count({ where: { igMessageId: mid } })).toBe(1);
  });

  it('when the queue cannot take the job (Redis down), the delivery is processed in-process', async () => {
    const { igUserId } = await tenant();
    const mid = uniq('mid');
    jobs.startWorkers();
    vi.spyOn(queue.getJobSystem(deliveries.WEBHOOK_QUEUE), 'add').mockRejectedValue(new Error('redis down'));

    expect((await post(dm({ igUserId, mid }))).status).toBe(200);
    await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM despite the queue');
  });
});

describe('AI outage', () => {
  it('the DM is saved and visible even when the AI analysis fails', async () => {
    const { igUserId } = await tenant();
    const mid = uniq('mid');
    aiService.analyzeConversation.mockRejectedValue(Object.assign(new Error('gemini 503'), { response: { status: 503 } }));

    expect((await post(dm({ igUserId, mid, text: 'are you open today?' }))).status).toBe(200);
    const msg = await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM');
    expect(msg.content).toBe('are you open today?');
    const conv = await prisma.conversation.findUnique({ where: { id: msg.conversationId } });
    expect(conv.lastMessage).toBe('are you open today?');
  });

  it('orphaned analyses (lost queue job, or failed during an outage) are re-enqueued; old ones are not', async () => {
    const { igUserId } = await tenant();
    const account = await prisma.instagramAccount.findFirst({ where: { igUserId } });
    const contact = await prisma.contact.create({ data: { instagramAccountId: account.id, igsid: uniq('c') } });
    const conv = await prisma.conversation.create({ data: { instagramAccountId: account.id, contactId: contact.id } });
    const mk = (data) => prisma.message.create({ data: { conversationId: conv.id, direction: 'inbound', content: 'x', ...data } });
    const now = Date.now();
    const lost = await mk({ aiStatus: 'pending', createdAt: new Date(now - 20 * MIN) });
    const failed = await mk({ aiStatus: 'failed', attempts: 3, createdAt: new Date(now - 2 * MIN) });
    await mk({ aiStatus: 'pending', createdAt: new Date(now - 2 * MIN) }); // too fresh: its job is still queued
    await mk({ aiStatus: 'failed', attempts: 12, createdAt: new Date(now - 5 * MIN) }); // out of attempts
    await mk({ aiStatus: 'pending', createdAt: new Date(now - 30 * 60 * MIN) }); // older than 24h

    const enqueue = vi.spyOn(jobs, 'enqueueMessageAnalysis');
    const count = await jobs.requeueOrphanedAnalyses({ now });
    expect(count).toBe(2);
    const ids = (await prisma.message.findMany({ where: { id: { in: [lost.id, failed.id] } } })).map((m) => m.id).sort();
    expect(ids).toEqual([lost.id, failed.id].sort());
    enqueue.mockRestore();
  });
});

describe('housekeeping and alerts', () => {
  it('purge never deletes an unprocessed delivery that still holds its DM', async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * MIN);
    await prisma.webhookDelivery.create({ data: { deliveryHash: 'a', payload: '{}', receivedAt: old } });
    await prisma.webhookDelivery.create({ data: { deliveryHash: 'b', payload: null, processedAt: old, receivedAt: old } });
    await purgeWebhookDeliveries();
    const left = await prisma.webhookDelivery.findMany();
    expect(left.map((r) => r.deliveryHash)).toEqual(['a']);
  });

  it('the backlog alert fires for deliveries unprocessed over 10 minutes', async () => {
    const check = CHECKS.find((c) => c.name === 'checkWebhookBacklog');
    expect(await check(Date.now())).toBeNull();
    await prisma.webhookDelivery.create({ data: { deliveryHash: 'x', payload: '{}', receivedAt: new Date(Date.now() - 11 * MIN) } });
    const alert = await check(Date.now());
    expect(alert.type).toBe('webhook_backlog');
  });

  it('the Redis-down alert is quiet when Redis is not configured', async () => {
    const check = CHECKS.find((c) => c.name === 'checkRedisDown');
    expect(await check(Date.now())).toBeNull();
  });
});

describe('graceful shutdown', () => {
  // Last in the file: markShuttingDown() is process-wide.
  it('once shutdown starts, new webhooks get 503 so Meta retries on a live instance', async () => {
    const { igUserId } = await tenant();
    health.markShuttingDown();
    const res = await post(dm({ igUserId }));
    expect(res.status).toBe(503);
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });
});
