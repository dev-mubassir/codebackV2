/**
 * Gate 4 — entitlement enforcement on the message hot path.
 *
 * These are the four behaviours that decide whether a customer is charged
 * fairly and whether a DM can be silently lost:
 *
 *   1. A message blocked ONLY by the hourly throttle is re-queued, not
 *      dropped, and goes through once the window clears.
 *   2. A durable block (not entitled / cycle cap) does NOT re-queue —
 *      retrying in ten minutes could not help, and a queue full of them
 *      would never drain.
 *   3. A reply credit is spent only when the DM actually reaches
 *      Instagram. A generated reply that fails to send costs nothing.
 *   4. A classification is counted once per message even across retries
 *      and provider failover.
 *
 * BILLING_ENABLED is set per-test rather than globally: enforcement is
 * supposed to be inert while the flag is off, and the last test here
 * asserts exactly that.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const aiService = require('../src/services/aiService.js');
const instagram = require('../src/lib/instagram.js');
const entitlementService = require('../src/services/entitlementService.js');
const { processMessageAnalysis } = require('../src/jobs/messageAnalysisJob.js');
const jobs = require('../src/jobs/index.js');
const { encrypt } = require('../src/lib/crypto.js');

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
  // A real provider was called — this is what the billing layer counts.
  billable: true,
};

let sendSpy;
let enqueueSpy;

beforeEach(async () => {
  await resetDb();
  process.env.BILLING_ENABLED = 'true';

  vi.spyOn(aiService, 'analyzeConversation').mockResolvedValue({ ...ELIGIBLE_ANALYSIS });
  vi.spyOn(aiService, 'summarizeConversation').mockResolvedValue({ summary: null, stage: null, failed: true });
  vi.spyOn(aiService, 'generateReply').mockResolvedValue({
    text: 'Our packages start at INR 5,000.',
    model: 'test-model',
    provider: 'test',
    failed: false,
  });
  sendSpy = vi.spyOn(instagram, 'sendMessage').mockResolvedValue({ message_id: uniq('mid') });
  // Spied rather than executed: the real one schedules a 10-minute timer.
  enqueueSpy = vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue({ id: 'queued' });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BILLING_ENABLED;
});

/** A tenant with a live paid plan, an IG account, and one inbound DM ready to analyse. */
async function seedTenant({ planOverrides = {}, entitlementOverrides = {}, autoReplyMode = 'smart' } = {}) {
  const { user } = await createUser({ withTrial: false });

  const plan = await prisma.plan.create({
    data: {
      code: uniq('PLAN').toUpperCase(),
      name: 'Test Plan',
      igAccountLimit: 1,
      autoReplyCreditsPerCycle: 500,
      autoReplyBankCap: 500,
      classificationCapCycle: 1000,
      classificationThrottlePerHour: 1000,
      cycleLengthDays: 30,
      ...planOverrides,
    },
  });

  await prisma.businessProfile.update({
    where: { userId: user.id },
    data: { autoReplyMode },
  });

  await prisma.entitlement.create({
    data: {
      userId: user.id,
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      replyCreditsCurrent: 10,
      ...entitlementOverrides,
    },
  });

  const account = await prisma.instagramAccount.create({
    data: {
      userId: user.id,
      igUserId: uniq('ig'),
      igUsername: uniq('acct'),
      accessToken: encrypt('test-token'),
      tokenStatus: 'VALID',
      connectionStatus: 'CONNECTED',
    },
  });
  const contact = await prisma.contact.create({
    data: { instagramAccountId: account.id, igsid: uniq('igsid'), username: uniq('customer') },
  });
  const conversation = await prisma.conversation.create({
    data: {
      instagramAccountId: account.id,
      contactId: contact.id,
      lastMessageAt: new Date(),
      autoReplyEnabled: null,
    },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'inbound',
      content: 'Hi, how much for ten reels?',
      messageType: 'text',
      aiStatus: 'pending',
      igTimestamp: new Date(),
    },
  });

  return { user, plan, conversation, message };
}

describe('Gate 4 — hourly throttle re-queues rather than dropping', () => {
  it('re-queues a throttled message with a delay, leaving it pending and un-analysed', async () => {
    const { user, message } = await seedTenant({
      planOverrides: { classificationThrottlePerHour: 1 },
      entitlementOverrides: { classificationCountHour: 1, hourWindowStartedAt: new Date() },
    });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const [requeuedId, opts] = enqueueSpy.mock.calls[0];
    expect(requeuedId).toBe(message.id);
    expect(opts.delayMs, 'must be deferred, not re-run immediately').toBeGreaterThan(0);
    expect(opts.throttleAttempt).toBe(1);

    const after = await prisma.message.findUnique({ where: { id: message.id } });
    expect(after.aiStatus, 'stays pending and visible — only enrichment waits').toBe('pending');
    expect(aiService.analyzeConversation).not.toHaveBeenCalled();

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.classificationCountCycle, 'a throttled message is never counted').toBe(0);
  });

  it('goes through once the hourly window has cleared', async () => {
    const { message } = await seedTenant({
      planOverrides: { classificationThrottlePerHour: 1 },
      // Window opened 61 minutes ago — the count belongs to a window that
      // has already closed, so this attempt is allowed.
      entitlementOverrides: {
        classificationCountHour: 1,
        hourWindowStartedAt: new Date(Date.now() - 61 * 60 * 1000),
      },
    });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(enqueueSpy, 'no re-queue needed — the window cleared').not.toHaveBeenCalled();
    expect(aiService.analyzeConversation).toHaveBeenCalled();
    const after = await prisma.message.findUnique({ where: { id: message.id } });
    expect(after.aiStatus).toBe('completed');
  });

  it('gives up after the bounded number of re-queues instead of looping forever', async () => {
    const { message } = await seedTenant({
      planOverrides: { classificationThrottlePerHour: 1 },
      entitlementOverrides: { classificationCountHour: 1, hourWindowStartedAt: new Date() },
    });

    // Arrive already at the last permitted attempt.
    await processMessageAnalysis({ data: { messageId: message.id, throttleAttempt: 7 } });

    expect(enqueueSpy, 'the runway is spent — stop re-queueing').not.toHaveBeenCalled();
    const after = await prisma.message.findUnique({ where: { id: message.id } });
    expect(after.aiStatus).toBe('skipped');
  });
});

describe('Gate 4 — durable blocks do not re-queue', () => {
  it('not_entitled is skipped, never re-queued', async () => {
    const { user, message } = await seedTenant();
    // Expire it outright: past validUntil and past any grace.
    await prisma.entitlement.update({
      where: { userId: user.id },
      data: {
        validUntil: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        graceUntil: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(aiService.analyzeConversation).not.toHaveBeenCalled();
    const after = await prisma.message.findUnique({ where: { id: message.id } });
    expect(after.aiStatus).toBe('skipped');
  });

  it('a spent cycle cap is skipped, never re-queued', async () => {
    const { message } = await seedTenant({
      planOverrides: { classificationCapCycle: 1 },
      entitlementOverrides: { classificationCountCycle: 1 },
    });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(enqueueSpy, 'the cycle cap will not clear in ten minutes').not.toHaveBeenCalled();
    const after = await prisma.message.findUnique({ where: { id: message.id } });
    expect(after.aiStatus).toBe('skipped');
  });

  it('a user with NO entitlement row at all is skipped, and no row is created for them', async () => {
    const { user, message } = await seedTenant();
    await prisma.entitlement.delete({ where: { userId: user.id } });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(aiService.analyzeConversation).not.toHaveBeenCalled();
    expect(
      await prisma.entitlement.findUnique({ where: { userId: user.id } }),
      'the read path must never lazily create an entitlement'
    ).toBeNull();
  });
});

describe('Gate 4 — a reply credit is spent only on a delivered DM', () => {
  it('spends exactly one credit when the send succeeds', async () => {
    const { user, message } = await seedTenant();

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.replyCreditsCurrent).toBe(9);

    const spends = await prisma.creditLedger.findMany({ where: { tenantId: user.id, type: 'SPEND' } });
    expect(spends).toHaveLength(1);
    expect(spends[0].delta).toBe(-1);
  });

  it('spends NOTHING when the Instagram send fails', async () => {
    const { user, message } = await seedTenant();
    sendSpy.mockRejectedValue(new Error('Instagram is down'));

    await processMessageAnalysis({ data: { messageId: message.id } });

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.replyCreditsCurrent, 'a reply that never reached the customer is free').toBe(10);
    expect(await prisma.creditLedger.count({ where: { tenantId: user.id, type: 'SPEND' } })).toBe(0);
  });

  it('does not even attempt generation when the tenant is out of credits', async () => {
    const { user, message } = await seedTenant({
      entitlementOverrides: { replyCreditsCurrent: 0, replyCreditsBanked: 0 },
    });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(
      aiService.generateReply,
      'paying for a reply nobody can send is the waste this gate exists to stop'
    ).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();

    // Classification still ran — on exhaustion auto-reply stops, analysis does not.
    const after = await prisma.message.findUnique({ where: { id: message.id } });
    expect(after.aiStatus).toBe('completed');
    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.classificationCountCycle).toBe(1);
  });
});

describe('Gate 4 — classification counting', () => {
  it('counts once across a retry of the same message', async () => {
    const { user, message } = await seedTenant();

    await processMessageAnalysis({ data: { messageId: message.id } });
    // Force a genuine re-run of the same message, as a queue retry would.
    await prisma.message.update({ where: { id: message.id }, data: { aiStatus: 'pending' } });
    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(aiService.analyzeConversation, 'the provider really was called twice').toHaveBeenCalledTimes(2);

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.classificationCountCycle, 'but the tenant is charged once').toBe(1);
    expect(
      await prisma.creditLedger.count({ where: { tenantId: user.id, type: 'CLASSIFY' } })
    ).toBe(1);
  });

  it('does NOT count a keyword/textless short-circuit that never called a provider', async () => {
    const { user, message } = await seedTenant();
    aiService.analyzeConversation.mockResolvedValue({
      ...ELIGIBLE_ANALYSIS,
      model: 'keyword-engine',
      shouldAutoReply: false,
      billable: false,
    });

    await processMessageAnalysis({ data: { messageId: message.id } });

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(
      entitlement.classificationCountCycle,
      'the keyword pre-filter costs us nothing, so it costs the tenant nothing'
    ).toBe(0);
    expect(await prisma.creditLedger.count({ where: { tenantId: user.id, type: 'CLASSIFY' } })).toBe(0);
  });

  it('DOES count a provider call that returned unparseable output', async () => {
    const { user, message } = await seedTenant();
    aiService.analyzeConversation.mockResolvedValue({
      ...ELIGIBLE_ANALYSIS,
      model: null,
      failed: true,
      shouldAutoReply: false,
      // Providers were called and all failed — we were still billed.
      billable: true,
    });

    await processMessageAnalysis({ data: { messageId: message.id } });

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.classificationCountCycle, 'we paid for it, so it counts').toBe(1);
  });
});

describe('Gate 4 — everything stays inert while BILLING_ENABLED is off', () => {
  it('does not gate, count, or charge when the flag is unset', async () => {
    const { user, message } = await seedTenant({
      planOverrides: { classificationCapCycle: 1 },
      entitlementOverrides: { classificationCountCycle: 99, replyCreditsCurrent: 0, replyCreditsBanked: 0 },
    });

    // Over the cycle cap AND out of reply credits: with billing on, this
    // message would be skipped and no reply sent.
    delete process.env.BILLING_ENABLED;

    await processMessageAnalysis({ data: { messageId: message.id } });

    const after = await prisma.message.findUnique({ where: { id: message.id } });
    expect(after.aiStatus, 'classification runs as if billing did not exist').toBe('completed');
    expect(sendSpy, 'and the auto-reply still sends').toHaveBeenCalledTimes(1);

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.classificationCountCycle, 'nothing is counted').toBe(99);
    expect(entitlement.replyCreditsCurrent, 'nothing is charged').toBe(0);
  });
});
