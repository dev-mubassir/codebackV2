/**
 * Seed one throwaway tenant with enough data to render every dashboard and
 * inbox card, so the UI can be exercised against real queries rather than
 * empty state.
 *
 * The email is under @test.codeback, which no real account can use and which
 * scripts/cleanup-test-data.js already targets — so this is removable with:
 *
 *   node scripts/cleanup-test-data.js --confirm
 *
 * Reply mode is left at the schema default (human_only) on purpose: that is
 * the state the dashboard's reply-mode banner and "Replies sent" card are
 * meant to describe.
 */

const prisma = require('../src/lib/prisma');
const bcrypt = require('bcryptjs');
const { encrypt } = require('../src/lib/crypto');

const EMAIL = 'review-walkthrough@test.codeback';
const PASSWORD = process.env.SEED_PASSWORD || 'walkthrough-only-1';

const CONTACTS = [
  { username: 'priya_films', name: 'Priya', category: 'hot_lead', customerType: 'hot_lead',
    purchaseIntent: 92, leadQuality: 88, priority: 'critical', priorityScore: 95,
    needsAttention: true, needsHuman: true, unread: true,
    intent: 'price_inquiry_reel_bundle', recommendedAction: 'ANSWER_PRICING',
    summary: 'Wants a ten-reel monthly pack and asked for a price today.',
    text: 'Hey! How much for 10 reels a month?' },
  { username: 'northwind_brand', name: 'Northwind', category: 'brand_deal', customerType: 'collaborator',
    purchaseIntent: 70, leadQuality: 80, priority: 'high', priorityScore: 82,
    needsAttention: true, needsHuman: false, unread: true,
    intent: 'sponsorship_offer', recommendedAction: 'HUMAN_ESCALATION',
    summary: 'Offering a paid campaign for a March launch.',
    text: 'We would like to sponsor a reel for our March launch.' },
  { username: 'sam_orders', name: 'Sam', category: 'pricing_inquiry', customerType: 'lead',
    purchaseIntent: 65, leadQuality: 60, priority: 'high', priorityScore: 70,
    needsAttention: false, needsHuman: false, unread: false,
    intent: 'rate_question', recommendedAction: 'ANSWER_PRICING',
    summary: 'Asked what a single reel costs.',
    text: 'What do you charge for one reel?' },
  { username: 'delivery_q', name: 'Ana', category: 'delivery_inquiry', customerType: 'potential_buyer',
    purchaseIntent: 40, leadQuality: 45, priority: 'normal', priorityScore: 50,
    needsAttention: false, needsHuman: false, unread: false,
    intent: 'turnaround_question', recommendedAction: 'REVIEW_CONVERSATION',
    summary: 'Asked how long an edit takes.',
    text: 'How long does an edit usually take?' },
  { username: 'support_case', name: 'Ravi', category: 'support_request', customerType: 'existing_customer',
    purchaseIntent: 10, leadQuality: 30, priority: 'normal', priorityScore: 45,
    needsAttention: true, needsHuman: true, unread: true,
    intent: 'revision_request', recommendedAction: 'HUMAN_ESCALATION',
    summary: 'Wants one more revision on last week’s edit.',
    text: 'Can I get one more revision on the last edit?' },
  { username: 'crypto_bot_99', name: null, category: 'spam', customerType: 'spammer',
    purchaseIntent: 0, leadQuality: 0, priority: 'low', priorityScore: 0,
    needsAttention: false, needsHuman: false, unread: false,
    intent: 'unsolicited_spam', recommendedAction: 'IGNORE_SPAM',
    summary: 'Unsolicited promotion. Safe to ignore.',
    text: 'Grow your account — buy followers now!' },
  { username: 'otp_phish', name: null, category: 'scam', customerType: 'scammer',
    purchaseIntent: 0, leadQuality: 0, priority: 'low', priorityScore: 5,
    needsAttention: false, needsHuman: false, unread: false,
    intent: 'scam_or_phishing_attempt', recommendedAction: 'BLOCK_OR_WARN_USER',
    summary: 'This looks like a scam. Do not share codes, passwords, or payment details.',
    text: 'Send otp to verify your account' },
  { username: 'fan_person', name: 'Dee', category: 'fan', customerType: 'casual_fan',
    purchaseIntent: 5, leadQuality: 5, priority: 'low', priorityScore: 20,
    needsAttention: false, needsHuman: false, unread: false,
    intent: 'casual_greeting_or_compliment', recommendedAction: 'AWAIT_CUSTOMER_INQUIRY',
    summary: 'A friendly hello with no question in it.',
    text: 'Love your edits!' },
];

const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000);

(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });

  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      name: 'Walkthrough Tenant',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      onboardingCompleted: true,
      // lastSeenAt in the past so "Since your last visit" has something to show.
      lastSeenAt: hoursAgo(6),
      businessProfile: {
        create: {
          businessName: 'Apex Visuals',
          primaryCategory: 'video_editor',
          businessTypes: JSON.stringify(['video_editor']),
          description: 'Video editor producing short-form reels for creators and brands.',
          productsServices: 'Short-form reel\nMonthly reel pack\nLong-form edit',
          pricingInfo: 'Short-form reel: INR 1,000 each',
          policies: 'Delivered in 48 hours. Two rounds of revisions included.',
          paymentMethods: 'UPI, bank transfer',
          // Left at the schema default so the dashboard banner reads "Manual".
        },
      },
      preferences: { create: {} },
    },
  });

  const account = await prisma.instagramAccount.create({
    data: {
      userId: user.id,
      igUserId: `ig_walkthrough_${Date.now()}`,
      igUsername: 'apexvisuals',
      igName: 'Apex Visuals',
      accessToken: encrypt('walkthrough-token'),
      tokenStatus: 'VALID',
      connectionStatus: 'CONNECTED',
      tokenExpiresAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      lastWebhookAt: hoursAgo(1),
    },
  });

  let idx = 0;
  for (const c of CONTACTS) {
    idx += 1;
    const when = hoursAgo(idx);

    const contact = await prisma.contact.create({
      data: {
        instagramAccountId: account.id,
        igsid: `igsid_walkthrough_${idx}_${Date.now()}`,
        username: c.username,
        name: c.name,
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        instagramAccountId: account.id,
        contactId: contact.id,
        category: c.category,
        intent: c.intent,
        customerType: c.customerType,
        purchaseIntent: c.purchaseIntent,
        leadQuality: c.leadQuality,
        priority: c.priority,
        priorityScore: c.priorityScore,
        needsAttention: c.needsAttention,
        needsHuman: c.needsHuman,
        unread: c.unread,
        recommendedAction: c.recommendedAction,
        aiExplanation: c.summary,
        riskLevel: c.category === 'scam' ? 'CRITICAL' : 'LOW',
        scamProbability: c.category === 'scam' ? 100 : 0,
        lastMessage: c.text,
        lastMessageAt: when,
      },
    });

    await prisma.conversationSummary.create({
      data: {
        conversationId: conversation.id,
        summary: c.summary,
        stage: c.needsHuman ? 'Needs your answer' : 'No action needed',
        messageCountAtSummary: 3,
      },
    });

    // Spread inbound messages across the last 24 hours so the sparkline has
    // more than one bucket to draw.
    for (let n = 0; n < 3; n += 1) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'inbound',
          content: n === 0 ? c.text : `${c.text} (follow-up ${n})`,
          messageType: 'text',
          aiStatus: 'completed',
          category: c.category,
          createdAt: hoursAgo(idx + n * 2),
          igTimestamp: hoursAgo(idx + n * 2),
        },
      });
    }

    if (c.category === 'brand_deal') {
      await prisma.brandDeal.create({
        data: {
          conversationId: conversation.id,
          instagramAccountId: account.id,
          userId: user.id,
          brandName: 'Northwind',
          campaign: 'March launch',
          budgetAmount: 30000,
          budgetCurrency: 'INR',
          deliverables: 'One reel, two stories',
          deadline: '15 Mar 2026',
          status: 'new',
          confidence: 0.9,
        },
      });
    }
  }

  await prisma.notification.createMany({
    data: [
      { userId: user.id, type: 'new_brand_deal', title: 'New brand deal from Northwind',
        body: 'Northwind got in touch about working together.', isRead: false },
      { userId: user.id, type: 'high_priority_conversation', title: 'A conversation needs your reply',
        body: '@priya_films sent something worth answering yourself.', isRead: false },
    ],
  });

  const counts = {
    conversations: await prisma.conversation.count({ where: { instagramAccountId: account.id } }),
    messages: await prisma.message.count({ where: { conversation: { instagramAccountId: account.id } } }),
  };

  console.log(JSON.stringify({ email: EMAIL, password: PASSWORD, userId: user.id, ...counts }, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
