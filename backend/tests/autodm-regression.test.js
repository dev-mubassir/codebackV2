/**
 * REGRESSION — Rule #1: a normal DM is classified and auto-replied exactly
 * the same with AUTODM_ENABLED off and on, through the real pipeline:
 * signed webhook -> durable inbox -> DM stored -> queue -> analysis job ->
 * auto-reply send. Only the AI provider and Meta's send call are stubbed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb, createUser, createAccount, grantReplyCredits, prisma, uniq } from './helpers/db.js';
import { saveFlags, setRolloutMode, postWebhook, waitFor, dmWebhook, createAutomation } from './helpers/autodm.js';

const require = createRequire(import.meta.url);
const aiService = require('../src/services/aiService.js');
const instagram = require('../src/lib/instagram.js');

let app;
let restoreFlags;
let sendSpy;

const ANALYSIS = {
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
  summary: 'Asks the price.',
  reason: 'Pricing question.',
  recommendedAction: 'ANSWER_PRICING',
  brandDeal: null,
  model: 'test-model',
  priorityScore: 50,
  priority: 'normal',
  failed: false,
  billable: false,
};

beforeAll(async () => {
  const webhookRoutes = (await import('../src/routes/webhook.js')).default;
  app = buildTestApp({ mount: { '/webhooks/instagram': webhookRoutes } });
});

beforeEach(async () => {
  await resetDb();
  restoreFlags = saveFlags();
  vi.spyOn(aiService, 'analyzeConversation').mockResolvedValue({ ...ANALYSIS });
  vi.spyOn(aiService, 'summarizeConversation').mockResolvedValue({ summary: null, stage: null, failed: true });
  vi.spyOn(aiService, 'generateReply').mockResolvedValue({ text: 'One reel edit is INR 2,000.', model: 'test-model', provider: 'test', failed: false });
  vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
  sendSpy = vi.spyOn(instagram, 'sendMessage').mockImplementation(async () => ({ message_id: uniq('out') }));
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreFlags();
});

/** A smart-mode tenant with credits; optionally a live Auto DM setup on the same account. */
async function tenant({ withAutoDm }) {
  const { user } = await createUser({});
  await prisma.businessProfile.update({ where: { userId: user.id }, data: { autoReplyMode: 'smart' } });
  await grantReplyCredits(user.id);
  const igUserId = uniq('ig');
  const account = await createAccount({ userId: user.id, igUserId });
  if (withAutoDm) {
    await setRolloutMode('BETA');
    process.env.AUTODM_SCOPE_ALLOWLIST = user.email;
    await prisma.autoDmAccountState.create({ data: { instagramAccountId: account.id, userId: user.id, commentsGranted: true } });
    const automation = await createAutomation({ user, account }, { triggerType: 'ANY_COMMENT', keywords: [] });
    // Someone ELSE is mid-flow with an open run on this account.
    await prisma.autoDmRun.create({
      data: {
        id: crypto.randomUUID(), userId: user.id, instagramAccountId: account.id, automationId: automation.id,
        commentId: uniq('c'), commenterId: 'mid-flow-fan', igsid: 'mid-flow-fan', status: 'OPENER_SENT',
        openerSentAt: new Date(), commentCreatedAt: new Date(),
      },
    });
  }
  return { user, account, igUserId };
}

/** Send one DM and return a comparable summary of everything the pipeline did with it. */
async function runDm(t, { sender, text }) {
  sendSpy.mockClear(); // each scenario counts only its own sends
  const mid = uniq('mid');
  expect((await postWebhook(app, dmWebhook(t.igUserId, sender, { text, mid }))).status).toBe(200);
  const inbound = await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the inbound DM');
  const outbound = await waitFor(
    () => prisma.message.findFirst({ where: { conversationId: inbound.conversationId, direction: 'outbound', aiStatus: 'auto_replied' } }),
    'the auto-reply',
    10000
  );
  const final = await prisma.message.findUnique({ where: { id: inbound.id } });
  const conversation = await prisma.conversation.findUnique({ where: { id: inbound.conversationId } });
  const sends = sendSpy.mock.calls.filter((c) => c[0] === sender).map((c) => [c[0], c[1]]);
  return {
    inbound: { content: final.content, aiStatus: final.aiStatus, category: final.category },
    conversation: { category: conversation.category, priority: conversation.priority },
    outbound: { content: outbound.content, aiStatus: outbound.aiStatus },
    sends,
    analyses: await prisma.aIAnalysis.count({ where: { triggerMessageId: inbound.id } }),
  };
}

describe('a normal DM behaves identically with Auto DM off and on', () => {
  it('classification + auto-reply outcome is the same', async () => {
    const dm = { sender: 'buyer-1', text: 'Hi, what is the price for one reel edit?' };

    const off = await runDm(await tenant({ withAutoDm: false }), dm);

    process.env.AUTODM_ENABLED = 'true';
    const on = await runDm(await tenant({ withAutoDm: true }), dm);

    expect(off).toEqual({
      inbound: { content: dm.text, aiStatus: 'completed', category: 'pricing_inquiry' },
      conversation: { category: 'pricing_inquiry', priority: 'normal' },
      outbound: { content: 'One reel edit is INR 2,000.', aiStatus: 'auto_replied' },
      sends: [['buyer-1', 'One reel edit is INR 2,000.']],
      analyses: 1,
    });
    expect(on).toEqual(off);
  });

  it('the outcome is identical in every rollout mode (OFF, BETA with a grant, EVERYONE)', async () => {
    const dm = { sender: 'buyer-2', text: 'How much for a 30-second reel?' };
    const baseline = await runDm(await tenant({ withAutoDm: false }), dm);
    process.env.AUTODM_ENABLED = 'true';
    for (const mode of ['OFF', 'BETA', 'EVERYONE']) {
      const t = await tenant({ withAutoDm: true });
      await prisma.autoDmAccess.create({ data: { userId: t.user.id, note: 'regression' } });
      await setRolloutMode(mode);
      expect(await runDm(t, dm), `mode ${mode}`).toEqual(baseline);
    }
  });

  // Gate 9A changed this rule: a DM from someone with Auto DM activity in the
  // last 24 hours is Auto DM's conversation, not sorted (autodm-window.test.js
  // covers it). 24 hours after the run's last activity they are sorted again.
  it('with Auto DM on, a commenter whose run went quiet 24+ hours ago is classified and auto-replied', async () => {
    process.env.AUTODM_ENABLED = 'true';
    const t = await tenant({ withAutoDm: true });
    await prisma.$executeRaw`UPDATE "autodm_runs" SET "updated_at" = (NOW() AT TIME ZONE 'UTC') - INTERVAL '25 hours' WHERE "igsid" = 'mid-flow-fan'`;
    const out = await runDm(t, { sender: 'mid-flow-fan', text: 'Also, do you edit wedding reels?' });
    expect(out.inbound.aiStatus).toBe('completed');
    expect(out.sends).toHaveLength(1);
  });

  it("with Auto DM on, 'LINK' from someone with no run is an ordinary DM (classified, auto-reply rules apply)", async () => {
    process.env.AUTODM_ENABLED = 'true';
    const t = await tenant({ withAutoDm: true });
    const out = await runDm(t, { sender: 'random-person', text: 'LINK' });
    expect(out.inbound.aiStatus).toBe('completed');
  });
});
