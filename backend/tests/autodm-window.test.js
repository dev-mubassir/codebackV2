/**
 * Gate 9A — the Auto DM conversation window. A DM from someone who has an
 * Auto DM run on this account with activity in the last 24 hours is stored
 * and shown as today, but gets aiStatus 'autodm': no classification, no
 * auto-reply, no AI credits. Everyone else — and everyone, while the kill
 * switch is off, the mode is OFF or the owner has no access — is sorted
 * exactly as before. Real pipeline: signed webhook -> durable inbox -> DM
 * stored -> seam -> queue -> analysis job -> auto-reply. Only the AI provider
 * and Meta's send are stubbed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb, createUser, createAccount, grantReplyCredits, prisma, uniq } from './helpers/db.js';
import { saveFlags, setRolloutMode, postWebhook, waitFor, dmWebhook, createAutomation } from './helpers/autodm.js';

const require = createRequire(import.meta.url);
const aiService = require('../src/services/aiService.js');
const instagram = require('../src/lib/instagram.js');
const jobs = require('../src/jobs/index.js');

let app;
let restoreFlags;
let sendSpy;
let ipSeq = 0;

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
  const apiRoutes = (await import('../src/routes/api.js')).default;
  app = buildTestApp({ mount: { '/webhooks/instagram': webhookRoutes, '/api': apiRoutes } });
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

const FAN = 'fan-igsid-1';

/**
 * A smart-mode tenant with credits. With `autodm`, Auto DM is live for it
 * (BETA + allowlist) and FAN has a run in `status`, last active `hoursAgo`.
 */
async function tenant({ autodm = true, status = 'DELIVERED', hoursAgo = 0, grant = 'allowlist' } = {}) {
  const { user, password } = await createUser({});
  await prisma.businessProfile.update({ where: { userId: user.id }, data: { autoReplyMode: 'smart' } });
  await grantReplyCredits(user.id);
  const igUserId = uniq('ig');
  const account = await createAccount({ userId: user.id, igUserId });
  if (autodm) {
    await setRolloutMode('BETA');
    if (grant === 'allowlist') process.env.AUTODM_SCOPE_ALLOWLIST = user.email;
    if (grant === 'row') await prisma.autoDmAccess.create({ data: { userId: user.id, note: 'window test' } });
    await prisma.autoDmAccountState.create({ data: { instagramAccountId: account.id, userId: user.id, commentsGranted: true } });
    const automation = await createAutomation({ user, account }, { triggerType: 'ANY_COMMENT', keywords: [] });
    const run = await prisma.autoDmRun.create({
      data: {
        id: crypto.randomUUID(), userId: user.id, instagramAccountId: account.id, automationId: automation.id,
        commentId: uniq('c'), commenterId: FAN, igsid: status === 'QUEUED' || status === 'WAITING_QUOTA' ? null : FAN,
        status, openerSentAt: new Date(), commentCreatedAt: new Date(),
      },
    });
    if (hoursAgo) {
      await prisma.$executeRaw`UPDATE "autodm_runs" SET "updated_at" = (NOW() AT TIME ZONE 'UTC') - (${hoursAgo}::int * INTERVAL '1 hour') WHERE "id" = ${run.id}`;
    }
    return { user, password, account, igUserId, run };
  }
  return { user, password, account, igUserId };
}

async function settled() {
  await waitFor(
    async () => (await prisma.webhookDelivery.count({ where: { processedAt: null, payload: { not: null } } })) === 0,
    'the delivery to be processed'
  );
}

async function billingState(userId) {
  const e = await prisma.entitlement.findUnique({ where: { userId } });
  return {
    replyCreditsCurrent: e.replyCreditsCurrent,
    replyCreditsBanked: e.replyCreditsBanked,
    classificationCountCycle: e.classificationCountCycle,
    classificationCountHour: e.classificationCountHour,
    ledgerRows: await prisma.creditLedger.count({ where: { tenantId: userId } }),
  };
}

/** One DM through the whole pipeline, waiting for the auto-reply: the comparable summary. */
async function sortedDm(t, { sender, text }) {
  sendSpy.mockClear();
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
  return {
    inbound: { content: final.content, aiStatus: final.aiStatus, category: final.category },
    conversation: { category: conversation.category, priority: conversation.priority },
    outbound: { content: outbound.content, aiStatus: outbound.aiStatus },
    sends: sendSpy.mock.calls.filter((c) => c[0] === sender).map((c) => [c[0], c[1]]),
    analyses: await prisma.aIAnalysis.count({ where: { triggerMessageId: inbound.id } }),
  };
}

/** One DM, stopping once the delivery is processed. Says whether it went to sorting. */
async function oneDm(t, { sender = FAN, text = 'Hi, what is the price for one reel edit?', attachments } = {}) {
  const enqueue = vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue(undefined);
  const mid = uniq('mid');
  const hook = dmWebhook(t.igUserId, sender, { text, mid });
  if (attachments) hook.entry[0].messaging[0].message.attachments = attachments;
  expect((await postWebhook(app, hook)).status).toBe(200);
  await settled();
  const message = await prisma.message.findFirst({ where: { igMessageId: mid } });
  const queued = enqueue.mock.calls.some((c) => c[0] === message.id);
  enqueue.mockRestore();
  return { message, queued };
}

async function login(t) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', `10.91.0.${++ipSeq}`).send({ email: t.user.email, password: t.password });
  expect(res.status).toBe(200);
  return agent;
}

describe('inside the 24-hour window', () => {
  it('a reply is stored and shown, but not sorted: no AI call, no credit, no auto-reply', async () => {
    process.env.AUTODM_ENABLED = 'true';
    const t = await tenant({ status: 'DELIVERED' });
    const before = await billingState(t.user.id);

    const { message, queued } = await oneDm(t, { text: 'Thanks! Also, do you edit wedding reels?' });

    expect(message.content).toBe('Thanks! Also, do you edit wedding reels?');
    expect(message.direction).toBe('inbound');
    expect(message.aiStatus).toBe('autodm');
    expect(queued).toBe(false);
    expect(aiService.analyzeConversation).not.toHaveBeenCalled();
    expect(aiService.generateReply).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await billingState(t.user.id)).toEqual(before);
    expect(await prisma.aIAnalysis.count({ where: { triggerMessageId: message.id } })).toBe(0);

    // The inbox gets the Auto DM label instead of a category.
    const agent = await login(t);
    const list = await agent.get('/api/conversations');
    expect(list.status).toBe(200);
    const row = list.body.find((c) => c.id === message.conversationId);
    expect(row.autoDm).toBe(true);
    // The DM itself never extends the window.
    const run = await prisma.autoDmRun.findUnique({ where: { id: t.run.id } });
    expect(run.updatedAt.getTime()).toBe(t.run.updatedAt.getTime());
  });

  it('every post-send status opens the window; QUEUED and WAITING_QUOTA do not', async () => {
    process.env.AUTODM_ENABLED = 'true';
    for (const status of ['OPENER_SENT', 'AWAITING_FOLLOW', 'OPENER_UNCONFIRMED', 'DELIVERED', 'NOT_FOLLOWING', 'FAILED', 'EXPIRED']) {
      const t = await tenant({ status });
      const { message, queued } = await oneDm(t);
      expect(message.aiStatus, status).toBe('autodm');
      expect(queued, status).toBe(false);
    }
    for (const status of ['QUEUED', 'WAITING_QUOTA']) {
      const t = await tenant({ status });
      const { message, queued } = await oneDm(t);
      expect(message.aiStatus, status).toBe('pending');
      expect(queued, status).toBe(true);
    }
  });

  it('a photo or sticker in the window is Auto DM\'s too', async () => {
    process.env.AUTODM_ENABLED = 'true';
    const t = await tenant({ status: 'OPENER_SENT' });
    const { message, queued } = await oneDm(t, { text: null, attachments: [{ type: 'image', payload: { url: 'https://example.com/a.jpg' } }] });
    expect(message.aiStatus).toBe('autodm');
    expect(queued).toBe(false);
  });

  it("another account's run never opens this account's window (tenant isolation)", async () => {
    process.env.AUTODM_ENABLED = 'true';
    const withRun = await tenant({ status: 'DELIVERED' });
    const other = await tenant({ autodm: false });
    process.env.AUTODM_SCOPE_ALLOWLIST = `${withRun.user.email},${other.user.email}`;
    const { message, queued } = await oneDm(other);
    expect(message.aiStatus).toBe('pending');
    expect(queued).toBe(true);
    // Same owner, second account: still per account.
    const second = await createAccount({ userId: withRun.user.id, igUserId: uniq('ig') });
    const res = await oneDm({ igUserId: second.igUserId });
    expect(res.message.aiStatus).toBe('pending');
    expect(res.queued).toBe(true);
  });
});

describe('outside the window, and everyone else, is sorted exactly as before', () => {
  it('24 hours after the last Auto DM activity, the next DM is sorted', async () => {
    process.env.AUTODM_ENABLED = 'true';
    const t = await tenant({ status: 'DELIVERED', hoursAgo: 25 });
    const out = await sortedDm(t, { sender: FAN, text: 'Hi, what is the price for one reel edit?' });
    expect(out.inbound.aiStatus).toBe('completed');
    expect(out.analyses).toBe(1);
    expect(out.sends).toHaveLength(1);

    const agent = await login(t);
    const list = await agent.get('/api/conversations');
    expect(list.body[0].autoDm).toBe(false);
  });

  it('someone who never commented is sorted identically to a tenant without Auto DM', async () => {
    const dm = { sender: 'never-commented', text: 'Hi, what is the price for one reel edit?' };
    const baseline = await sortedDm(await tenant({ autodm: false }), dm);
    process.env.AUTODM_ENABLED = 'true';
    const on = await sortedDm(await tenant({ status: 'DELIVERED' }), dm);
    expect(on).toEqual(baseline);
    expect(baseline.inbound.aiStatus).toBe('completed');
  });

  it('kill switch off, mode OFF, no access, or a revoked grant: the commenter is sorted byte-identically', async () => {
    const dm = { sender: FAN, text: 'How much for a 30-second reel?' };
    const baseline = await sortedDm(await tenant({ autodm: false }), dm);

    // Kill switch off (the run exists and is fresh).
    delete process.env.AUTODM_ENABLED;
    expect(await sortedDm(await tenant({ status: 'DELIVERED' }), dm), 'kill switch off').toEqual(baseline);

    process.env.AUTODM_ENABLED = 'true';
    // Mode OFF.
    const off = await tenant({ status: 'DELIVERED', grant: 'row' });
    await setRolloutMode('OFF');
    expect(await sortedDm(off, dm), 'mode OFF').toEqual(baseline);

    // BETA, but this owner has no grant and is not on the env list.
    const none = await tenant({ status: 'DELIVERED', grant: 'none' });
    process.env.AUTODM_SCOPE_ALLOWLIST = '';
    expect(await sortedDm(none, dm), 'no access').toEqual(baseline);

    // BETA, grant revoked.
    const revoked = await tenant({ status: 'DELIVERED', grant: 'row' });
    await prisma.autoDmAccess.deleteMany({ where: { userId: revoked.user.id } });
    expect(await sortedDm(revoked, dm), 'revoked').toEqual(baseline);
  });

  it('a failing window check sends the DM to normal sorting (fail-safe)', async () => {
    process.env.AUTODM_ENABLED = 'true';
    const t = await tenant({ status: 'DELIVERED' });
    const boom = vi.spyOn(prisma.autoDmRun, 'findFirst').mockRejectedValue(Object.assign(new Error('db down'), { code: 'P1001' }));
    const { message, queued } = await oneDm(t);
    boom.mockRestore();
    expect(message.aiStatus).toBe('pending');
    expect(queued).toBe(true);
  });
});
