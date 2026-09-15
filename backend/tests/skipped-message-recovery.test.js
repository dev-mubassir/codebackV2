/**
 * Messages skipped while a tenant had no entitlement — recorded, recovered,
 * and shown.
 *
 * The loss this pins: with billing on, an inbound DM that arrived before a
 * tenant's trial or plan existed was marked `skipped` and never classified
 * again — the customer's real leads, silently dropped. Pinned here:
 *
 *   1. every skip records the gate's reason (aiSkipReason)
 *   2. an entitlement grant re-queues `not_entitled` (and pre-column NULL)
 *      skips from the last 7 days — newest first, bounded by the remaining
 *      classification cap, never cycle_cap skips, never outbound, and each
 *      message exactly once even when two recoveries race
 *   3. the trial claim route triggers that recovery
 *   4. a recovered message auto-replies only if it arrived within the last
 *      hour; older ones are classified and left for the human
 *   5. /api/billing/summary counts what is still unsorted, by reason
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, uniq } from './helpers/db.js';
import { skipReasonLabel } from '../../frontend/src/content/labels.js';

const require = createRequire(import.meta.url);
const aiService = require('../src/services/aiService.js');
const instagram = require('../src/lib/instagram.js');
const jobs = require('../src/jobs/index.js');
const igIdentity = require('../src/lib/igIdentity.js');
const billingRoutes = require('../src/routes/billing.js');
const { processMessageAnalysis } = require('../src/jobs/messageAnalysisJob.js');
const { recoverSkippedMessages, countUnsortedMessages } = require('../src/services/skippedMessageRecovery.js');
const { encrypt } = require('../src/lib/crypto.js');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ago = (ms) => new Date(Date.now() - ms);

const ELIGIBLE_ANALYSIS = {
  category: 'pricing_inquiry',
  intent: 'price_inquiry',
  customerType: 'lead',
  purchaseIntent: 70,
  leadQuality: 70,
  riskLevel: 'LOW',
  scamProbability: 0,
  confidence: 0.9,
  needsCreatorAttention: false,
  shouldAutoReply: true,
  summary: 'Customer asking about price.',
  reason: 'Pricing question.',
  recommendedAction: 'ANSWER_PRICING',
  brandDeal: null,
  model: 'test-model',
  priorityScore: 50,
  priority: 'normal',
  failed: false,
  billable: true,
};

let app;
let sendSpy;
let enqueueSpy;
let ipCounter = 0;
const nextIp = () => `10.88.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

beforeAll(() => {
  app = buildTestApp({ mount: { '/api/billing': billingRoutes } });
});

beforeEach(async () => {
  await resetDb();
  process.env.BILLING_ENABLED = 'true';
  // The trial's catalogue row, as the seed migration installs it — upserted in
  // case an earlier file changed it.
  const trial = {
    name: 'Trial', igAccountLimit: 1, autoReplyCreditsPerCycle: 25, autoReplyBankCap: 25,
    classificationCapCycle: 100, classificationThrottlePerHour: 100, cycleLengthDays: 3, isActive: true,
  };
  await prisma.plan.upsert({ where: { code: 'TRIAL' }, update: trial, create: { code: 'TRIAL', ...trial } });

  vi.spyOn(aiService, 'analyzeConversation').mockResolvedValue({ ...ELIGIBLE_ANALYSIS });
  vi.spyOn(aiService, 'summarizeConversation').mockResolvedValue({ summary: null, stage: null, failed: true });
  vi.spyOn(aiService, 'generateReply').mockResolvedValue({ text: 'Packages start at INR 5,000.', model: 'test-model', provider: 'test', failed: false });
  sendSpy = vi.spyOn(instagram, 'sendMessage').mockResolvedValue({ message_id: uniq('mid') });
  enqueueSpy = vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue({ id: 'queued' });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.BILLING_ENABLED = 'true';
});

/** A plan with a known cap, and optionally a live entitlement on it. */
async function makePlan(overrides = {}) {
  return prisma.plan.create({
    data: {
      code: uniq('PLAN').toUpperCase(), name: 'Test Plan', igAccountLimit: 1,
      autoReplyCreditsPerCycle: 500, autoReplyBankCap: 500,
      classificationCapCycle: 1000, classificationThrottlePerHour: 1000, cycleLengthDays: 30,
      ...overrides,
    },
  });
}

async function entitle(userId, plan, overrides = {}) {
  return prisma.entitlement.create({
    data: {
      userId, planCode: plan.code, status: 'ACTIVE',
      validUntil: new Date(Date.now() + 10 * DAY_MS), replyCreditsCurrent: 10,
      ...overrides,
    },
  });
}

/** A tenant with one connected account and one conversation, in smart reply mode. */
async function seedTenant({ emailVerified = true } = {}) {
  const { user, password } = await createUser({ withTrial: false, emailVerified });
  await prisma.businessProfile.update({ where: { userId: user.id }, data: { autoReplyMode: 'smart' } });
  const igUserId = uniq('ig');
  const account = await prisma.instagramAccount.create({
    data: { userId: user.id, igUserId, igUsername: uniq('acct'), accessToken: encrypt('test-token'), tokenStatus: 'VALID', connectionStatus: 'CONNECTED' },
  });
  const contact = await prisma.contact.create({ data: { instagramAccountId: account.id, igsid: uniq('igsid'), username: uniq('customer') } });
  const conversation = await prisma.conversation.create({
    data: { instagramAccountId: account.id, contactId: contact.id, lastMessageAt: new Date(), autoReplyEnabled: null },
  });
  return { user, password, igUserId, conversation };
}

async function addMessage(conversation, { createdAt = new Date(), direction = 'inbound', aiStatus = 'skipped', aiSkipReason = 'not_entitled', aiRecoveredAt = null } = {}) {
  return prisma.message.create({
    data: {
      conversationId: conversation.id, direction, content: 'Hi, how much for ten reels?', messageType: 'text',
      aiStatus, aiSkipReason, aiRecoveredAt, igTimestamp: createdAt, createdAt,
    },
  });
}

async function loginAgent(email, password) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password });
  expect(res.status, `login should succeed, got ${res.status}`).toBe(200);
  return agent;
}

const reload = (m) => prisma.message.findUnique({ where: { id: m.id } });

describe('every skip records the gate reason', () => {
  it('no entitlement -> skipped, not_entitled, not re-queued', async () => {
    const { conversation } = await seedTenant();
    const message = await addMessage(conversation, { aiStatus: 'pending', aiSkipReason: null });

    await processMessageAnalysis({ data: { messageId: message.id } });

    const after = await reload(message);
    expect(after.aiStatus).toBe('skipped');
    expect(after.aiSkipReason).toBe('not_entitled');
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('cycle cap reached -> cycle_cap', async () => {
    const { user, conversation } = await seedTenant();
    const plan = await makePlan({ classificationCapCycle: 1 });
    await entitle(user.id, plan, { classificationCountCycle: 1 });
    const message = await addMessage(conversation, { aiStatus: 'pending', aiSkipReason: null });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect((await reload(message)).aiSkipReason).toBe('cycle_cap');
  });

  it('still throttled after the last re-queue -> hourly_throttle', async () => {
    const { user, conversation } = await seedTenant();
    const plan = await makePlan({ classificationThrottlePerHour: 1 });
    await entitle(user.id, plan, { classificationCountHour: 1, hourWindowStartedAt: new Date() });
    const message = await addMessage(conversation, { aiStatus: 'pending', aiSkipReason: null });

    await processMessageAnalysis({ data: { messageId: message.id, throttleAttempt: 7 } });

    const after = await reload(message);
    expect(after.aiStatus).toBe('skipped');
    expect(after.aiSkipReason).toBe('hourly_throttle');
  });
});

describe('recoverSkippedMessages', () => {
  it('re-queues not_entitled and unrecorded skips from the last 7 days, newest first, within the remaining cap — nothing else', async () => {
    const { user, conversation } = await seedTenant();
    const plan = await makePlan({ classificationCapCycle: 3 });
    await entitle(user.id, plan, { classificationCountCycle: 1 }); // 2 left

    const newest = await addMessage(conversation, { createdAt: ago(1 * HOUR_MS) });
    const unrecorded = await addMessage(conversation, { createdAt: ago(2 * DAY_MS), aiSkipReason: null });
    const overCap = await addMessage(conversation, { createdAt: ago(3 * DAY_MS) });
    const capSkip = await addMessage(conversation, { createdAt: ago(30 * 60 * 1000), aiSkipReason: 'cycle_cap' });
    const tooOld = await addMessage(conversation, { createdAt: ago(8 * DAY_MS) });
    const outbound = await addMessage(conversation, { createdAt: ago(10 * 60 * 1000), direction: 'outbound', aiSkipReason: null });

    const result = await recoverSkippedMessages(user.id, { trigger: 'test' });
    expect(result.requeued).toBe(2);

    for (const m of [newest, unrecorded]) {
      const after = await reload(m);
      expect(after.aiStatus, 'recovered').toBe('pending');
      expect(after.aiSkipReason).toBeNull();
      expect(after.aiRecoveredAt).not.toBeNull();
    }
    for (const m of [overCap, capSkip, tooOld, outbound]) {
      expect((await reload(m)).aiStatus, 'left alone').toBe('skipped');
    }

    const enqueued = enqueueSpy.mock.calls.map(([id]) => id).sort();
    expect(enqueued).toEqual([newest.id, unrecorded.id].sort());
    // Its own jobId: the queue drops a second `analyze-<id>`.
    for (const [, opts] of enqueueSpy.mock.calls) expect(opts.jobKey).toMatch(/^recovered-/);
  });

  it('recovers nothing for a tenant who is still not entitled', async () => {
    const { user, conversation } = await seedTenant();
    const message = await addMessage(conversation, { createdAt: ago(HOUR_MS) });

    expect((await recoverSkippedMessages(user.id)).requeued).toBe(0);
    expect((await reload(message)).aiStatus).toBe('skipped');
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('two recoveries racing enqueue each message exactly once', async () => {
    const { user, conversation } = await seedTenant();
    await entitle(user.id, await makePlan());
    const messages = await Promise.all([1, 2, 3, 4].map((h) => addMessage(conversation, { createdAt: ago(h * HOUR_MS) })));

    const [a, b] = await Promise.all([recoverSkippedMessages(user.id), recoverSkippedMessages(user.id)]);

    expect(a.requeued + b.requeued).toBe(messages.length);
    const enqueued = enqueueSpy.mock.calls.map(([id]) => id);
    expect(new Set(enqueued).size).toBe(enqueued.length);
    expect(enqueued).toHaveLength(messages.length);
  });

  it('never throws — a failure is returned, so it cannot fail a grant', async () => {
    const { user } = await seedTenant();
    await entitle(user.id, await makePlan());
    vi.spyOn(prisma.message, 'findMany').mockRejectedValueOnce(new Error('database went away'));

    const result = await recoverSkippedMessages(user.id);
    expect(result.requeued).toBe(0);
    expect(result.error).toMatch(/database went away/);
  });
});

describe('the trial claim triggers recovery', () => {
  it('POST /api/billing/trial/claim grants the trial and re-queues the DM that arrived before it', async () => {
    const { user, password, igUserId, conversation } = await seedTenant();
    await prisma.instagramIdentity.create({ data: { igUserIdHash: igIdentity.hashIgUserId(igUserId), purgeAfter: igIdentity.purgeAfterDate() } });
    const waiting = await addMessage(conversation, { createdAt: ago(30 * 60 * 1000) });

    const agent = await loginAgent(user.email, password);
    const res = await agent.post('/api/billing/trial/claim');
    expect(res.body.trialOutcome).toBe('TRIAL_GRANTED');

    const after = await reload(waiting);
    expect(after.aiStatus).toBe('pending');
    expect(after.aiRecoveredAt).not.toBeNull();
    expect(enqueueSpy.mock.calls.map(([id]) => id)).toContain(waiting.id);
  });
});

describe('a recovered message auto-replies only if it arrived within the last hour', () => {
  async function tenantReadyToReply() {
    const t = await seedTenant();
    await entitle(t.user.id, await makePlan());
    return t;
  }
  const spends = (tenantId) => prisma.creditLedger.count({ where: { tenantId, type: 'SPEND' } });

  it('recovered, arrived 30 minutes ago: classified AND answered', async () => {
    const { user, conversation } = await tenantReadyToReply();
    const message = await addMessage(conversation, { createdAt: ago(30 * 60 * 1000), aiStatus: 'pending', aiSkipReason: null, aiRecoveredAt: new Date() });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect((await reload(message)).aiStatus).toBe('completed');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await spends(user.id)).toBe(1);
  });

  it('recovered, arrived 3 hours ago: classified, NOT answered, no credit spent', async () => {
    const { user, conversation } = await tenantReadyToReply();
    const message = await addMessage(conversation, { createdAt: ago(3 * HOUR_MS), aiStatus: 'pending', aiSkipReason: null, aiRecoveredAt: new Date() });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect((await reload(message)).aiStatus, 'still classified').toBe('completed');
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await spends(user.id)).toBe(0);
  });

  it('the rule is for recovered messages only: an ordinary message from 3 hours ago still auto-replies', async () => {
    const { conversation } = await tenantReadyToReply();
    const message = await addMessage(conversation, { createdAt: ago(3 * HOUR_MS), aiStatus: 'pending', aiSkipReason: null });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

describe('what is still unsorted is visible', () => {
  it('countUnsortedMessages and /summary report recent inbound skips by reason, including unrecorded ones', async () => {
    const { user, password, conversation } = await seedTenant();
    await addMessage(conversation, { createdAt: ago(HOUR_MS) });
    await addMessage(conversation, { createdAt: ago(2 * HOUR_MS) });
    await addMessage(conversation, { createdAt: ago(3 * HOUR_MS), aiSkipReason: 'cycle_cap' });
    await addMessage(conversation, { createdAt: ago(4 * HOUR_MS), aiSkipReason: null });
    await addMessage(conversation, { createdAt: ago(9 * DAY_MS) }); // outside the window
    await addMessage(conversation, { direction: 'outbound', aiSkipReason: null }); // never counted

    const direct = await countUnsortedMessages(user.id);
    expect(direct).toEqual({ count: 4, byReason: { not_entitled: 2, cycle_cap: 1, unrecorded: 1 }, windowDays: 7 });

    const res = await (await loginAgent(user.email, password)).get('/api/billing/summary');
    expect(res.body.unsortedMessages).toEqual(direct);
  });

  it('each reason has inbox wording, and none of it names a number', () => {
    for (const reason of ['not_entitled', 'cycle_cap', 'hourly_throttle', null, 'something_new']) {
      const l = skipReasonLabel(reason);
      expect(l.label, String(reason)).toBe('Not sorted');
      expect(l.description, String(reason)).toBeTruthy();
      expect(l.description, String(reason)).not.toMatch(/\d/);
    }
    expect(skipReasonLabel('not_entitled').description).toMatch(/no active trial or plan/);
  });
});
