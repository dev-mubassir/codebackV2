/**
 * C5 — concurrent analysis jobs must not double-send to a real customer.
 *
 * The auto-reply gate in jobs/messageAnalysisJob.js counts prior auto-replies,
 * then awaits an AI call, then sends. Nothing holds a lock across that gap,
 * so two jobs for the same conversation both read the pre-send counts and
 * both send. Worker concurrency is 3 on a single instance, so this fires
 * today — and every extra instance multiplies it.
 *
 * The setup puts the conversation exactly one reply below the daily cap:
 *
 *   - two auto-replies already sent today, so dailyAutoReplyCount === 2 with
 *     MAX_DAILY_AUTO_REPLIES === 3
 *   - a later MANUAL outbound reply, so the consecutive-auto-reply counter
 *     resets to 0 and the consecutive guard (max 2) is not what blocks us
 *
 * Run sequentially, that permits exactly one more auto-reply: the first job
 * sends and the second sees a count of 3 and stops. Run concurrently, both
 * read 2 and both send — the customer gets two DMs and the tenant's daily
 * cap is breached.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { vi } from 'vitest';

import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const aiService = require('../src/services/aiService.js');
const instagram = require('../src/lib/instagram.js');
const { processMessageAnalysis } = require('../src/jobs/messageAnalysisJob.js');
const { encrypt } = require('../src/lib/crypto.js');

let sendSpy;

const ELIGIBLE_ANALYSIS = {
  category: 'pricing_inquiry',
  intent: 'price_inquiry',
  customerType: 'lead',
  purchaseIntent: 70,
  leadQuality: 70,
  commercialRelevance: 70,
  urgency: 20,
  riskLevel: 'LOW',
  scamProbability: 0,
  sentiment: 'positive',
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
};

beforeAll(() => {
  // Never call a real provider or Meta from this suite.
});

beforeEach(async () => {
  await resetDb();

  vi.spyOn(aiService, 'analyzeConversation').mockResolvedValue({ ...ELIGIBLE_ANALYSIS });
  vi.spyOn(aiService, 'summarizeConversation').mockResolvedValue({ summary: null, stage: null, failed: true });

  // A deliberate delay so both jobs are guaranteed to be inside the gate at
  // the same time. The race does not depend on this — it is a read-then-act
  // gap across an await — but the delay makes the test deterministic.
  vi.spyOn(aiService, 'generateReply').mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 60));
    return { text: 'Our packages start at $50.', model: 'test-model', provider: 'test', failed: false };
  });

  sendSpy = vi
    .spyOn(instagram, 'sendMessage')
    .mockImplementation(async () => ({ message_id: `mid-${Math.random().toString(36).slice(2)}` }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Tenant on 'smart' auto-reply with a conversation sitting one reply below
 * the daily cap, plus two fresh inbound messages ready to be analyzed.
 */
async function seedConversationAtCapBoundary() {
  const { user } = await createUser({ name: 'Auto Tenant' });
  await prisma.businessProfile.update({
    where: { userId: user.id },
    data: { autoReplyMode: 'smart', businessName: 'Test Shop', pricingInfo: 'Packages from $50' },
  });

  const account = await prisma.instagramAccount.create({
    data: {
      userId: user.id,
      igUserId: uniq('ig-auto'),
      igUsername: 'auto_shop',
      accessToken: encrypt('token-auto'),
    },
  });

  const contact = await prisma.contact.create({
    data: { instagramAccountId: account.id, igsid: uniq('igsid-auto'), username: 'buyer' },
  });

  const conversation = await prisma.conversation.create({
    data: {
      instagramAccountId: account.id,
      contactId: contact.id,
      category: 'pricing_inquiry',
      lastMessage: 'how much?',
      lastMessageAt: new Date(),
    },
  });

  const t = (minutesAgo) => new Date(Date.now() - minutesAgo * 60 * 1000);

  // Two auto-replies already sent today -> dailyAutoReplyCount === 2.
  for (const [i, minutes] of [[0, 300], [1, 240]]) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'outbound',
        content: `earlier auto reply ${i}`,
        aiStatus: 'auto_replied',
        createdAt: t(minutes),
        igTimestamp: t(minutes),
      },
    });
  }

  // A later MANUAL reply so the consecutive-auto-reply counter resets to 0.
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'outbound',
      content: 'manual human reply',
      aiStatus: 'skipped',
      createdAt: t(180),
      igTimestamp: t(180),
    },
  });

  // Two inbound messages arriving at effectively the same moment.
  const inboundA = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'inbound',
      content: 'what does the pro package cost?',
      createdAt: t(2),
      igTimestamp: t(2),
    },
  });
  const inboundB = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'inbound',
      content: 'and do you ship internationally?',
      createdAt: t(1),
      igTimestamp: t(1),
    },
  });

  return { user, account, contact, conversation, inboundA, inboundB };
}

describe('C5 — concurrent auto-reply must not double-send', () => {
  it('sends at most one auto-reply when two jobs race on one conversation', async () => {
    const { inboundA, inboundB, conversation } = await seedConversationAtCapBoundary();

    await Promise.all([
      processMessageAnalysis({ data: { messageId: inboundA.id } }),
      processMessageAnalysis({ data: { messageId: inboundB.id } }),
    ]);

    expect(
      sendSpy.mock.calls.length,
      'two racing jobs must not both send to the customer'
    ).toBe(1);

    const autoReplies = await prisma.message.count({
      where: { conversationId: conversation.id, direction: 'outbound', aiStatus: 'auto_replied' },
    });
    expect(autoReplies, 'daily auto-reply cap of 3 must not be breached').toBe(3);
  });

  it('still sends normally when a single job runs alone', async () => {
    const { inboundA } = await seedConversationAtCapBoundary();

    await processMessageAnalysis({ data: { messageId: inboundA.id } });

    expect(sendSpy.mock.calls.length, 'the guard must not block legitimate replies').toBe(1);
  });
});

describe('H6 — analysis writes are atomic', () => {
  it('leaves no half-written analysis when the conversation update fails', async () => {
    const { inboundA, conversation } = await seedConversationAtCapBoundary();
    const categoryBefore = conversation.category;

    // Fail the pipeline strictly BETWEEN the AIAnalysis insert and the
    // conversation update, using a real schema constraint rather than a spy:
    // AIAnalysis.riskLevel is String? and accepts null, while
    // Conversation.riskLevel is a required String and rejects it.
    //
    // (Spying on prisma.conversation.update does NOT work here — $transaction
    // passes the callback its own client instance, so the outer spy is never
    // consulted and the pipeline just succeeds.)
    aiService.analyzeConversation.mockResolvedValue({ ...ELIGIBLE_ANALYSIS, riskLevel: null });

    await expect(processMessageAnalysis({ data: { messageId: inboundA.id } })).rejects.toThrow();

    const analyses = await prisma.aIAnalysis.count({ where: { conversationId: conversation.id } });
    expect(analyses, 'a failed pipeline must not leave an orphan AIAnalysis row').toBe(0);

    const after = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(after.category, 'the conversation must be untouched by a failed pipeline').toBe(
      categoryBefore
    );
  });
});

describe('M4 — messages stranded in processing are recoverable', () => {
  it('exposes a sweeper that resets stale processing messages', async () => {
    const { inboundA } = await seedConversationAtCapBoundary();

    await prisma.message.update({
      where: { id: inboundA.id },
      data: { aiStatus: 'processing', createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const { sweepStalledAnalyses } = require('../src/jobs/messageAnalysisJob.js');
    expect(typeof sweepStalledAnalyses, 'a stale-processing sweeper must exist').toBe('function');

    const swept = await sweepStalledAnalyses({ olderThanMs: 10 * 60 * 1000 });
    expect(swept, 'the stalled message must be reclaimed').toBeGreaterThanOrEqual(1);

    const after = await prisma.message.findUnique({ where: { id: inboundA.id } });
    expect(after.aiStatus, 'a stalled message must not stay in processing forever').not.toBe('processing');
  });
});
