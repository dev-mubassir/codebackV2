/**
 * S1 — a missing business profile must never resolve to an auto-sending mode.
 *
 * Both auto-reply gates in jobs/messageAnalysisJob.js used
 * `businessProfile?.autoReplyMode || 'smart'`. The database column defaults to
 * 'human_only' so that automatic sending is opt-in, but that fallback inverted
 * it for any user whose BusinessProfile row was missing or not yet saved —
 * precisely the state a brand-new signup or an App Review test account is in.
 *
 * The product states the opposite in three places a customer reads:
 *   - landing page:  "Nothing sends until you allow it"
 *   - dashboard:     "Codeback never sends anything. You write every reply yourself."
 *   - inbox:         "Suggested replies are never sent on their own. You send them."
 *
 * So this is a misrepresentation, not just a defect, and it is asserted here
 * both at the pure-function level and end to end through the real send path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { vi } from 'vitest';

import { prisma, resetDb, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const aiService = require('../src/services/aiService.js');
const instagram = require('../src/lib/instagram.js');
const {
  processMessageAnalysis,
  effectiveReplyMode,
  DEFAULT_REPLY_MODE,
} = require('../src/jobs/messageAnalysisJob.js');
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
  // Deliberately the most permissive analysis possible: if anything is going
  // to slip past the mode gate, this is what lets it.
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

// ---------------------------------------------------------------------------
// Pure gate
// ---------------------------------------------------------------------------
describe('effectiveReplyMode', () => {
  it('defaults to human_only, matching the database column default', () => {
    expect(DEFAULT_REPLY_MODE).toBe('human_only');
  });

  it.each([
    ['no profile at all', undefined],
    ['a null profile', null],
    ['a profile with no mode set', {}],
    ['an explicit null mode', { autoReplyMode: null }],
    ['an explicit undefined mode', { autoReplyMode: undefined }],
    ['an empty string', { autoReplyMode: '' }],
    ['whitespace only', { autoReplyMode: '   ' }],
  ])('never resolves to an auto-sending mode for %s', (_label, profile) => {
    const mode = effectiveReplyMode(profile);
    expect(mode).toBe('human_only');
    expect(mode).not.toBe('smart');
  });

  it('passes through a mode the tenant actually chose', () => {
    expect(effectiveReplyMode({ autoReplyMode: 'smart' })).toBe('smart');
    expect(effectiveReplyMode({ autoReplyMode: 'suggest_only' })).toBe('suggest_only');
    expect(effectiveReplyMode({ autoReplyMode: 'human_only' })).toBe('human_only');
  });

  it('fails closed on an unrecognised value rather than guessing', () => {
    // Only the literal 'smart' may send. Anything else is treated as no-send
    // by the caller, so a typo or a future mode cannot open the send path.
    expect(effectiveReplyMode({ autoReplyMode: 'SMART' })).not.toBe('smart');
    expect(effectiveReplyMode({ autoReplyMode: 'auto' })).not.toBe('smart');
  });
});

// ---------------------------------------------------------------------------
// End to end through the real analysis job
// ---------------------------------------------------------------------------
describe('auto-reply with no business profile', () => {
  beforeEach(async () => {
    await resetDb();

    vi.spyOn(aiService, 'analyzeConversation').mockResolvedValue({ ...ELIGIBLE_ANALYSIS });
    vi.spyOn(aiService, 'summarizeConversation').mockResolvedValue({
      summary: null, stage: null, failed: true,
    });
    vi.spyOn(aiService, 'generateReply').mockResolvedValue({
      text: 'Our packages start at INR 5,000.',
      model: 'test-model',
      provider: 'test',
      failed: false,
    });

    sendSpy = vi
      .spyOn(instagram, 'sendMessage')
      .mockResolvedValue({ message_id: uniq('mid') });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seedInboundMessage({ withProfile }) {
    // Built directly rather than via createUser(), because that helper always
    // creates a BusinessProfile — which is the exact row this test needs
    // absent. This is the state of a real signup who connected an account and
    // never finished setup.
    const bcrypt = (await import('bcryptjs')).default;
    const user = await prisma.user.create({
      data: {
        email: `${uniq('user')}@test.codeback`,
        name: 'Profileless Tenant',
        passwordHash: await bcrypt.hash('correct-horse-1', 4),
        onboardingCompleted: true,
        preferences: { create: {} },
        ...(withProfile
          ? { businessProfile: { create: { businessName: 'Test Co', autoReplyMode: 'smart' } } }
          : {}),
      },
    });

    if (!withProfile) {
      const profile = await prisma.businessProfile.findUnique({ where: { userId: user.id } });
      expect(profile).toBeNull();
    }

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
      data: {
        instagramAccountId: account.id,
        igsid: uniq('igsid'),
        username: uniq('customer'),
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        instagramAccountId: account.id,
        contactId: contact.id,
        lastMessageAt: new Date(),
        // Left null so the conversation inherits the tenant mode. A null
        // override must not be readable as "opted in".
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

    return { user, conversation, message };
  }

  it('sends nothing when the user has no business profile', async () => {
    const { message } = await seedInboundMessage({ withProfile: false });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('writes no auto_replied outbound message when the profile is missing', async () => {
    const { conversation, message } = await seedInboundMessage({ withProfile: false });

    await processMessageAnalysis({ data: { messageId: message.id } });

    const sent = await prisma.message.count({
      where: { conversationId: conversation.id, direction: 'outbound', aiStatus: 'auto_replied' },
    });
    expect(sent).toBe(0);
  });

  it('still analyses the message — only the send is withheld', async () => {
    const { message } = await seedInboundMessage({ withProfile: false });

    await processMessageAnalysis({ data: { messageId: message.id } });

    const analysed = await prisma.message.findUnique({ where: { id: message.id } });
    expect(analysed.aiStatus).toBe('completed');
    expect(aiService.analyzeConversation).toHaveBeenCalled();
  });

  it('does send when the tenant explicitly chose smart, proving the gate is not simply off', async () => {
    const { message } = await seedInboundMessage({ withProfile: true });

    await processMessageAnalysis({ data: { messageId: message.id } });

    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
