/**
 * Draft credits — the manual "Draft AI reply" button's own credit pool.
 *
 * What this file pins, each with a positive control (the same setup with the
 * one thing that matters flipped, so an assertion cannot pass vacuously):
 *   - the catalogue: 1/4 of reply credits per plan, draft packs at the reply
 *     pack's per-credit price, and the migration's backfill;
 *   - a successful draft costs exactly 1 draft credit and 0 reply credits;
 *   - a failed AI call costs nothing; a double-submit charges once;
 *   - 0 credits blocks with billing on and does not with billing off;
 *   - auto-reply keeps spending reply credits only;
 *   - checkout -> Cashfree webhook grants draft credits; a refund revokes them;
 *   - admin edits need step-up + reason and are audited; non-admins get 404.
 *
 * Cashfree is mocked at the HTTP boundary (axios), the AI provider at
 * aiService.generateReply. Every ledger check is PER POOL.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAdmin, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const axios = require('axios');
const svc = require('../src/services/entitlementService.js');
const aiService = require('../src/services/aiService.js');
const mailer = require('../src/lib/email/index.js');
const igIdentity = require('../src/lib/igIdentity.js');

const SECRET = 'test-cashfree-secret-not-real';
const ORIGIN = 'https://app.test.local';
const REGION = { billingRegion: 'IN', currency: 'INR', regionSource: 'RAIL_INFERRED' };
const DAY = 24 * 60 * 60 * 1000;
const MIGRATION = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations', '20260927090000_draft_credits', 'migration.sql');

let app;
let ipSeq = 0;
const ip = () => `10.140.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
let paymentSeq = 50000;
const savedEnv = {};

beforeAll(async () => {
  savedEnv.secret = process.env.CASHFREE_SECRET_KEY;
  savedEnv.support = process.env.SUPPORT_EMAIL;
  process.env.CASHFREE_SECRET_KEY = SECRET;
  process.env.CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || 'test-cashfree-app';
  const adminRoutes = (await import('../src/routes/admin.js')).default;
  const apiRoutes = (await import('../src/routes/api.js')).default;
  const billingRoutes = (await import('../src/routes/billing.js')).default;
  const webhookRoutes = (await import('../src/routes/cashfreeWebhooks.js')).default;
  app = buildTestApp({
    admin: adminRoutes,
    mount: { '/api/billing': billingRoutes, '/webhooks/cashfree': webhookRoutes, '/api': apiRoutes },
  });
});

beforeEach(async () => {
  await resetDb();
  process.env.BILLING_ENABLED = 'true';
  process.env.SUPPORT_EMAIL = 'support@test.codeback';
  vi.spyOn(mailer, 'sendBillingOpsAlert').mockResolvedValue({ id: 'alert' });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.BILLING_ENABLED = 'true';
});

afterAll(async () => {
  if (savedEnv.secret === undefined) delete process.env.CASHFREE_SECRET_KEY;
  else process.env.CASHFREE_SECRET_KEY = savedEnv.secret;
  if (savedEnv.support === undefined) delete process.env.SUPPORT_EMAIL;
  else process.env.SUPPORT_EMAIL = savedEnv.support;
  await prisma.$disconnect();
});

// ---------------------------------------------------------------- helpers

async function balances(tenantId) {
  const e = await prisma.entitlement.findUnique({ where: { userId: tenantId } });
  return {
    reply: e ? e.replyCreditsCurrent + e.replyCreditsBanked : 0,
    draft: e ? e.draftCreditsCurrent + e.draftCreditsBanked : 0,
    e,
  };
}

/** THE invariant, both pools. */
async function expectBalanced(tenantId, after = '') {
  const { reply, draft, e } = await balances(tenantId);
  for (const [pool, held] of [['REPLY', reply], ['DRAFT', draft]]) {
    const sum = (await prisma.creditLedger.aggregate({ where: { tenantId, pool }, _sum: { delta: true } }))._sum.delta ?? 0;
    expect(sum, `${pool} ledger sum must equal the held balance ${after}`).toBe(held);
    expect(held, `${pool} balance never negative`).toBeGreaterThanOrEqual(0);
  }
  return e;
}

const draftSpends = (tenantId) => prisma.creditLedger.count({ where: { tenantId, pool: 'DRAFT', type: 'SPEND' } });

/** A customer on STARTER (125 drafts, 500 replies) with a conversation, logged in. */
async function customer({ plan = 'STARTER' } = {}) {
  const { user, password } = await createUser({ withTrial: false });
  const account = await createAccount({ userId: user.id, withConversation: true });
  const conversation = await prisma.conversation.findFirst({ where: { instagramAccountId: account.id } });
  if (plan) await svc.grantPlan(user.id, plan, REGION);
  const agent = request.agent(app).set('Origin', ORIGIN);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', ip()).send({ email: user.email, password });
  expect(res.status).toBe(200);
  return { user, agent, conversation };
}

const draft = (agent, conversation, key) => {
  const r = agent.post(`/api/conversations/${conversation.id}/generate-reply`).send({});
  return key ? r.set('Idempotency-Key', key) : r;
};

const aiOk = (text = 'Thanks for asking! Rates are in your inbox.') =>
  vi.spyOn(aiService, 'generateReply').mockResolvedValue({ text, model: 'test-model' });

const newKey = () => `k_${crypto.randomUUID().replace(/-/g, '')}`;

async function adminAgent({ stepUp = true } = {}) {
  const { admin, password } = await createAdmin();
  const agent = request.agent(app).set('Origin', ORIGIN).set('X-Forwarded-For', ip());
  expect((await agent.post('/api/admin/login').send({ email: admin.email, password })).status).toBe(200);
  if (stepUp) expect((await agent.post('/api/admin/step-up').send({ password })).status).toBe(200);
  return agent;
}

function deliverWebhook(body) {
  const raw = JSON.stringify(body);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac('sha256', SECRET).update(timestamp + raw).digest('base64');
  return request(app)
    .post('/webhooks/cashfree')
    .set('Content-Type', 'application/json')
    .set('x-webhook-timestamp', timestamp)
    .set('x-webhook-signature', signature)
    .send(raw);
}

const paymentSuccess = (orderId, amountMinor) => ({
  type: 'PAYMENT_SUCCESS_WEBHOOK',
  event_time: new Date().toISOString(),
  data: {
    order: { order_id: orderId, order_amount: amountMinor / 100, order_currency: 'INR', order_tags: null },
    payment: {
      cf_payment_id: paymentSeq++,
      payment_status: 'SUCCESS',
      payment_amount: amountMinor / 100,
      payment_currency: 'INR',
      payment_group: 'upi',
      payment_method: { upi: { channel: 'collect', upi_id: 'someone@okbank' } },
    },
    customer_details: { customer_id: 'c1', customer_email: 'x@test.codeback', customer_phone: '9999999999' },
  },
});

/** Checkout an add-on through the API with Cashfree's create-order mocked, then deliver its success webhook. */
async function buyAddon(agent, addonCode) {
  vi.spyOn(axios, 'post').mockResolvedValue({ data: { payment_session_id: 'sess_test', order_status: 'ACTIVE' } });
  const res = await agent.post('/api/billing/checkout/addon').send({ addonCode, customerPhone: '9999999999' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  vi.mocked(axios.post).mockRestore();
  const hook = await deliverWebhook(paymentSuccess(res.body.orderId, res.body.amount));
  expect(hook.status).toBe(200);
  return prisma.order.findUnique({ where: { cashfreeOrderId: res.body.orderId } });
}

// ------------------------------------------------------ 1. plan terms / seed

describe('the catalogue — the 1/4 rule and the draft packs', () => {
  it('every seeded plan has draft credits = floor(reply credits / 4); ENTERPRISE is unlimited', async () => {
    const plans = await prisma.plan.findMany({ where: { code: { in: ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'] } } });
    const by = Object.fromEntries(plans.map((p) => [p.code, p]));
    expect([by.TRIAL.draftCreditsPerCycle, by.STARTER.draftCreditsPerCycle, by.PRO.draftCreditsPerCycle]).toEqual([6, 125, 500]);
    expect(by.ENTERPRISE.draftCreditsPerCycle).toBeNull();
    for (const p of plans.filter((x) => x.autoReplyCreditsPerCycle != null)) {
      expect(p.draftCreditsPerCycle, p.code).toBe(Math.floor(p.autoReplyCreditsPerCycle / 4));
      expect(p.draftBankCap, p.code).toBe(Math.floor(p.autoReplyBankCap / 4));
    }
  });

  it('draft packs cost exactly the reply pack price per credit, per tier and region — and are invisible to pre-draft code', async () => {
    const reply = await prisma.addonPack.findUnique({ where: { code: 'reply_credits_500' }, include: { prices: true } });
    const drafts = await prisma.addonPack.findMany({ where: { pool: 'DRAFT' }, include: { prices: true } });
    expect(drafts.map((d) => [d.code, d.creditAmount]).sort()).toEqual([['draft_credits_125', 125], ['draft_credits_500', 500]]);
    for (const d of drafts) {
      expect(d.isActive, 'legacy is_active stays false: old code reads it').toBe(false);
      expect(d.isListed).toBe(true);
      expect(d.prices).toHaveLength(4);
      for (const p of d.prices) {
        const rp = reply.prices.find((x) => x.planCode === p.planCode && x.billingRegion === p.billingRegion);
        // amount / credits equal, cross-multiplied so no rounding hides a mismatch
        expect(p.amount * reply.creditAmount, `${d.code} ${p.planCode} ${p.billingRegion}`).toBe(rp.amount * d.creditAmount);
        expect(p.currency).toBe(rp.currency);
      }
    }
    // Positive control: the reply pack itself is still listed AND active.
    expect([reply.isActive, reply.isListed, reply.pool]).toEqual([true, true, 'REPLY']);
  });

  it('GET /api/billing/plans lists draft packs apart from reply packs, with each plan\'s draft credits', async () => {
    const res = await request(app).get('/api/billing/plans');
    expect(res.status).toBe(200);
    const starter = res.body.plans.find((p) => p.code === 'STARTER');
    expect(starter.draftCreditsPerCycle).toBe(125);
    expect(starter.addons.replyCredits.map((p) => p.code)).toEqual(['reply_credits_500']);
    expect(starter.addons.draftCredits.map((p) => [p.code, p.prices[0].amount])).toEqual([
      ['draft_credits_125', 7475],
      ['draft_credits_500', 29900],
    ]);
    expect(res.body.plans.find((p) => p.code === 'ENTERPRISE').draftCreditsPerCycle).toBeNull();
  });

  it('the migration is additive: no DROP, no DELETE, no destructive ALTER', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    // Every NOT NULL column it adds carries a default, so old-code inserts still work.
    for (const m of sql.matchAll(/ADD COLUMN "[a-z_]+" [^,;]*NOT NULL[^,;]*/g)) expect(m[0]).toMatch(/DEFAULT/);
  });

  it('the backfill gives live entitlements one cycle of drafts with a ledger row, terms to all planned rows, and is idempotent', async () => {
    const live = (await createUser({ withTrial: false })).user;
    const expired = (await createUser({ withTrial: false })).user;
    const none = (await createUser({ withTrial: false })).user;
    const now = Date.now();
    // Rows as the pre-draft code left them: no draft terms, no draft balance.
    await prisma.entitlement.create({ data: { userId: live.id, planCode: 'STARTER', status: 'ACTIVE', validUntil: new Date(now + 10 * DAY), graceUntil: new Date(now + 13 * DAY) } });
    await prisma.entitlement.create({ data: { userId: expired.id, planCode: 'PRO', status: 'EXPIRED', validUntil: new Date(now - 10 * DAY), graceUntil: new Date(now - 7 * DAY) } });
    await prisma.entitlement.create({ data: { userId: none.id, status: 'NONE' } });

    const sql = fs.readFileSync(MIGRATION, 'utf8');
    const backfill = sql.slice(sql.indexOf('-- Backfill: draft terms'));
    const statements = backfill.split(/;\s*\n/).map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean);
    expect(statements).toHaveLength(2);
    for (const s of statements) await prisma.$executeRawUnsafe(s);
    for (const s of statements) await prisma.$executeRawUnsafe(s); // re-run: no double grant

    const l = await prisma.entitlement.findUnique({ where: { userId: live.id } });
    expect([l.termDraftCreditsPerCycle, l.termDraftBankCap, l.draftCreditsCurrent]).toEqual([125, 125, 125]);
    expect(l.draftTermsAt).not.toBeNull();
    expect(await prisma.creditLedger.count({ where: { tenantId: live.id, pool: 'DRAFT', source: 'draft:backfill' } })).toBe(1);
    await expectBalanced(live.id, 'backfill');

    const x = await prisma.entitlement.findUnique({ where: { userId: expired.id } });
    expect([x.termDraftCreditsPerCycle, x.draftCreditsCurrent], 'expired: terms, no balance').toEqual([500, 0]);
    await expectBalanced(expired.id, 'backfill expired');

    const n = await prisma.entitlement.findUnique({ where: { userId: none.id } });
    expect([n.draftTermsAt, n.draftCreditsCurrent], 'no plan: untouched').toEqual([null, 0]);
  });
});

// --------------------------------------------------------- 2. grants & cycle

describe('grants and the cycle — reply rules, second pool', () => {
  it('trial, plan grant, add-on and cycle roll keep BOTH pools balanced; renewal banks drafts at the draft cap', async () => {
    const { user } = await createUser({ withTrial: false });
    const t = user.id;
    const claim = await igIdentity.claimInstagramIdentity({ userId: t, igUserId: uniq('ig-draft'), emailVerified: true });
    expect(claim.trialOutcome).toBe('TRIAL_GRANTED');
    let e = await expectBalanced(t, 'trial');
    expect([e.draftCreditsCurrent, e.termDraftCreditsPerCycle]).toEqual([6, 6]);

    await svc.grantPlan(t, 'STARTER', REGION);
    e = await expectBalanced(t, 'starter');
    expect([e.draftCreditsCurrent, e.draftCreditsBanked], 'trial drafts carried into the bank').toEqual([125, 6]);
    expect([e.replyCreditsCurrent, e.replyCreditsBanked], 'reply pool unaffected by drafts').toEqual([500, 25]);

    await svc.grantAddon(t, 'draft_credits_500');
    e = await expectBalanced(t, 'draft pack');
    expect([e.draftCreditsCurrent, e.replyCreditsCurrent]).toEqual([625, 500]);

    await svc.grantPlan(t, 'STARTER', REGION); // renewal: 631 held, draft bank cap 125
    e = await expectBalanced(t, 'renewal');
    expect([e.draftCreditsCurrent, e.draftCreditsBanked]).toEqual([125, 125]);
    const expired = await prisma.creditLedger.findFirst({ where: { tenantId: t, pool: 'DRAFT', type: 'EXPIRE' } });
    expect([expired.delta, expired.source]).toEqual([-506, 'draft:expire:renewal_bank_cap']);

    await svc.rollCycle(t);
    e = await expectBalanced(t, 'roll');
    expect([e.draftCreditsCurrent, e.draftCreditsBanked]).toEqual([0, 125]);
  });

  it('ENTERPRISE is unlimited: drafts reserve nothing and write no ledger row', async () => {
    const { user } = await createUser({ withTrial: false });
    await svc.grantPlan(user.id, 'ENTERPRISE', REGION);
    expect((await svc.draftCreditStatus(user.id)).unlimited).toBe(true);
    expect((await svc.reserveDraftCredit(user.id, newKey())).outcome).toBe('unlimited');
    expect(await draftSpends(user.id)).toBe(0);
    await expectBalanced(user.id);
  });
});

// ---------------------------------------------------------- 3. the draft route

describe('POST /api/conversations/:id/generate-reply — billing on', () => {
  it('a successful draft consumes exactly 1 draft credit and 0 reply credits', async () => {
    const { user, agent, conversation } = await customer();
    const ai = aiOk();
    const before = await balances(user.id);
    const replyRowsBefore = await prisma.creditLedger.count({ where: { tenantId: user.id, pool: 'REPLY' } });

    const res = await draft(agent, conversation, newKey());

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.text).toMatch(/Thanks/);
    expect(res.body.draftCredits).toMatchObject({ remaining: 124, unlimited: false });
    expect(ai).toHaveBeenCalledTimes(1);
    const after = await balances(user.id);
    expect(after.draft).toBe(before.draft - 1);
    expect(after.reply, 'reply credits untouched').toBe(before.reply);
    expect(await prisma.creditLedger.count({ where: { tenantId: user.id, pool: 'REPLY' } })).toBe(replyRowsBefore);
    expect(await draftSpends(user.id)).toBe(1);
    await expectBalanced(user.id, 'draft');
  });

  it('a failed AI call consumes nothing (reserved, then refunded in the ledger)', async () => {
    const { user, agent, conversation } = await customer();
    vi.spyOn(aiService, 'generateReply').mockResolvedValue({ failed: true, errorMessage: 'provider down' });

    const res = await draft(agent, conversation, newKey());

    expect(res.status).toBe(502);
    expect(res.body.draftCredits.remaining).toBe(125);
    expect((await balances(user.id)).draft).toBe(125);
    expect(await prisma.creditLedger.count({ where: { tenantId: user.id, source: 'draft:refund:ai_failed' } })).toBe(1);
    await expectBalanced(user.id, 'failed draft');

    // A throw (not a failed result) is refunded too.
    vi.spyOn(aiService, 'generateReply').mockRejectedValue(new Error('socket hang up'));
    expect((await draft(agent, conversation, newKey())).status).toBe(500);
    expect((await balances(user.id)).draft).toBe(125);
    expect(await prisma.creditLedger.count({ where: { tenantId: user.id, source: 'draft:refund:not_delivered' } })).toBe(1);
    await expectBalanced(user.id, 'thrown draft');

    // Positive control: the same request with a working AI does charge.
    aiOk();
    expect((await draft(agent, conversation, newKey())).status).toBe(200);
    expect((await balances(user.id)).draft).toBe(124);
  });

  it('a double-submit charges once — sequential retry and concurrent double-click', async () => {
    const { user, agent, conversation } = await customer();
    const ai = aiOk();
    const key = newKey();

    const first = await draft(agent, conversation, key);
    const retry = await draft(agent, conversation, key);
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(retry.body).toMatchObject({ id: first.body.id, duplicate: true });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(await draftSpends(user.id)).toBe(1);

    // Concurrent: the AI is slow, both clicks land while the first is running.
    ai.mockImplementation(() => new Promise((r) => setTimeout(() => r({ text: 'slow draft', model: 'm' }), 300)));
    const key2 = newKey();
    const [a, b] = await Promise.all([draft(agent, conversation, key2), draft(agent, conversation, key2)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await draftSpends(user.id)).toBe(2);
    expect((await balances(user.id)).draft).toBe(123);
    await expectBalanced(user.id, 'double submit');

    // Positive control: two DIFFERENT keys are two drafts.
    ai.mockResolvedValue({ text: 'x', model: 'm' });
    await draft(agent, conversation, newKey());
    await draft(agent, conversation, newKey());
    expect(await draftSpends(user.id)).toBe(4);
  });

  it('two different clicks at a balance of 1 cannot both spend it', async () => {
    const { user, agent, conversation } = await customer();
    await prisma.creditLedger.create({ data: { tenantId: user.id, delta: -124, type: 'EXPIRE', pool: 'DRAFT', source: 'draft:test_setup', balanceAfter: 1 } });
    await prisma.entitlement.update({ where: { userId: user.id }, data: { draftCreditsCurrent: 1 } });
    aiOk().mockImplementation(() => new Promise((r) => setTimeout(() => r({ text: 'y', model: 'm' }), 200)));

    const results = await Promise.all([draft(agent, conversation, newKey()), draft(agent, conversation, newKey()), draft(agent, conversation, newKey())]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 402, 402]);
    expect((await balances(user.id)).draft).toBe(0);
    await expectBalanced(user.id, 'race at 1');
  });

  it('0 draft credits blocks the draft (402) and never calls the AI; reply credits cannot be used instead', async () => {
    const { user, agent, conversation } = await customer();
    await prisma.creditLedger.create({ data: { tenantId: user.id, delta: -125, type: 'EXPIRE', pool: 'DRAFT', source: 'draft:test_setup', balanceAfter: 0 } });
    await prisma.entitlement.update({ where: { userId: user.id }, data: { draftCreditsCurrent: 0 } });
    const ai = aiOk();

    const res = await draft(agent, conversation, newKey());

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ code: 'DRAFT_CREDITS_EXHAUSTED', draftCredits: { remaining: 0, allowed: false } });
    expect(ai).not.toHaveBeenCalled();
    expect((await balances(user.id)).reply, '500 reply credits still there, and not spent').toBe(500);
    const counter = await agent.get('/api/billing/draft-credits');
    expect(counter.body).toMatchObject({ remaining: 0, allowed: false, reason: 'exhausted' });
  });

  it('an expired plan or no plan is DRAFT_NOT_ENTITLED', async () => {
    const { user, agent, conversation } = await customer();
    await prisma.entitlement.update({ where: { userId: user.id }, data: { validUntil: new Date(Date.now() - 5 * DAY), graceUntil: new Date(Date.now() - DAY) } });
    const ai = aiOk();
    const res = await draft(agent, conversation, newKey());
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('DRAFT_NOT_ENTITLED');
    expect(ai).not.toHaveBeenCalled();
  });
});

describe('billing OFF — drafts work freely, exactly as before', () => {
  it('0 credits does not block, nothing is written to the ledger, and there is no counter', async () => {
    const { user, agent, conversation } = await customer({ plan: null }); // no entitlement at all
    const ai = aiOk();
    delete process.env.BILLING_ENABLED;

    const res = await draft(agent, conversation, newKey());
    expect(res.status).toBe(200);
    expect(res.body.draftCredits).toBeNull();
    expect(ai).toHaveBeenCalledTimes(1);
    expect(await prisma.creditLedger.count({ where: { tenantId: user.id } })).toBe(0);
    expect((await agent.get('/api/billing/draft-credits')).status).toBe(404);

    // Positive control: the same tenant with billing on is refused.
    process.env.BILLING_ENABLED = 'true';
    expect((await draft(agent, conversation, newKey())).status).toBe(402);
  });
});

describe('auto-reply is unaffected — the pools never mix', () => {
  it('spendReplyCredit moves only reply credits; drafts do not keep auto-reply alive, and vice versa', async () => {
    const { user } = await createUser({ withTrial: false });
    await svc.grantPlan(user.id, 'STARTER', REGION);
    await svc.spendReplyCredit(user.id);
    let b = await balances(user.id);
    expect([b.reply, b.draft]).toEqual([499, 125]);

    // No reply credits but plenty of drafts: auto-reply stops.
    await prisma.creditLedger.create({ data: { tenantId: user.id, delta: -499, type: 'EXPIRE', source: 'test_setup', balanceAfter: 0 } });
    await prisma.entitlement.update({ where: { userId: user.id }, data: { replyCreditsCurrent: 0 } });
    expect(await svc.canAutoReply(user.id)).toBe(false);
    expect((await svc.draftCreditStatus(user.id)).allowed).toBe(true);
    expect((await svc.spendReplyCredit(user.id)).ok).toBe(false);
    b = await balances(user.id);
    expect(b.draft, 'a failed reply spend never falls back to drafts').toBe(125);
    await expectBalanced(user.id, 'mixed');

    // Positive control: with reply credits back, auto-reply runs again.
    await prisma.creditLedger.create({ data: { tenantId: user.id, delta: 3, type: 'GRANT', source: 'test_setup', balanceAfter: 3 } });
    await prisma.entitlement.update({ where: { userId: user.id }, data: { replyCreditsCurrent: 3 } });
    expect(await svc.canAutoReply(user.id)).toBe(true);
  });
});

// ------------------------------------------------------ 4. purchase and refund

describe('draft packs through the existing add-on checkout, webhook and refunds', () => {
  it('checkout -> Cashfree webhook grants draft credits (once), never reply credits', async () => {
    const { user, agent } = await customer();
    const before = await balances(user.id);

    const order = await buyAddon(agent, 'draft_credits_125');

    expect(order.status).toBe('PAID');
    expect(order.amount).toBe(7475);
    expect(order.grantSnapshot).toMatchObject({ pool: 'DRAFT', grantedCredits: 125, creditsAheadAtGrant: 125 });
    const after = await balances(user.id);
    expect(after.draft).toBe(before.draft + 125);
    expect(after.reply).toBe(before.reply);
    await expectBalanced(user.id, 'draft pack bought');

    // A replayed webhook grants nothing more.
    await deliverWebhook(paymentSuccess(order.cashfreeOrderId, order.amount));
    expect((await balances(user.id)).draft).toBe(before.draft + 125);

    // The summary shows both pools and does not count the draft pack as a reply pack.
    const summary = await agent.get('/api/billing/summary');
    expect(summary.body.draftCredits).toMatchObject({ remaining: 250, unlimited: false, perCycle: 125 });
    expect(summary.body.replyCreditPacksThisCycle).toBe(0);
  });

  it('a hidden (unlisted) draft pack cannot be bought', async () => {
    const { agent } = await customer();
    await prisma.addonPack.update({ where: { code: 'draft_credits_500' }, data: { isListed: false } });
    const res = await agent.post('/api/billing/checkout/addon').send({ addonCode: 'draft_credits_500', customerPhone: '9999999999' });
    expect(res.status).toBe(404);
    await prisma.addonPack.update({ where: { code: 'draft_credits_500' }, data: { isListed: true } });
  });

  it('a full refund of an unused draft pack revokes its draft credits and nothing else', async () => {
    const { user, agent } = await customer();
    const order = await buyAddon(agent, 'draft_credits_500');
    const admin = await adminAgent();
    const eligibility = await admin.get(`/api/admin/billing/orders/${order.cashfreeOrderId}/refund-eligibility`);
    expect(eligibility.body.policy).toMatchObject({ eligible: true, kind: 'draft_pack', creditPool: 'DRAFT', creditsGranted: 500 });

    vi.spyOn(axios, 'post').mockImplementation(async (url, body) => ({
      data: { cf_refund_id: String(paymentSeq++), refund_id: body.refund_id, refund_status: 'SUCCESS', refund_amount: body.refund_amount },
    }));
    const res = await admin.post(`/api/admin/billing/orders/${order.cashfreeOrderId}/refunds`).send({ reason: 'Customer asked within the window' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.revocation.credits).toMatchObject({ pool: 'DRAFT', granted: 500, removed: 500 });

    const b = await balances(user.id);
    expect([b.draft, b.reply]).toEqual([125, 500]);
    await expectBalanced(user.id, 'draft pack refunded');
  });

  it('a draft pack with credits used is outside the policy; a plan refund also takes back its draft credits', async () => {
    const { user, agent, conversation } = await customer({ plan: null });
    // A paid STARTER order through fulfilment, so the snapshot records its drafts.
    const { fulfillPaidOrder } = require('../src/services/billingFulfillment.js');
    const planOrder = await prisma.order.create({ data: { cashfreeOrderId: `sfy_${uniq('ord')}`, tenantId: user.id, planCode: 'STARTER', amount: 49900, currency: 'INR' } });
    await fulfillPaidOrder({ cashfreeOrderId: planOrder.cashfreeOrderId, payment: { cf_payment_id: paymentSeq++, payment_group: 'upi' }, rawPayload: '{}' });
    const packOrder = await buyAddon(agent, 'draft_credits_125');
    aiOk();
    // 126 drafts: the plan's 125 first (FIFO), then 1 from the pack.
    for (let i = 0; i < 126; i++) await svc.reserveDraftCredit(user.id, newKey());
    await expectBalanced(user.id, '126 drafts');

    const admin = await adminAgent();
    const pack = await admin.get(`/api/admin/billing/orders/${packOrder.cashfreeOrderId}/refund-eligibility`);
    expect(pack.body.policy).toMatchObject({ eligible: false, kind: 'draft_pack', creditsUsedFromPurchase: 1 });

    const plan = await admin.get(`/api/admin/billing/orders/${planOrder.cashfreeOrderId}/refund-eligibility`);
    expect(plan.body.policy.kind).toBe('plan');
    vi.spyOn(axios, 'post').mockImplementation(async (url, body) => ({
      data: { cf_refund_id: String(paymentSeq++), refund_id: body.refund_id, refund_status: 'SUCCESS', refund_amount: body.refund_amount },
    }));
    const res = await admin.post(`/api/admin/billing/orders/${planOrder.cashfreeOrderId}/refunds`).send({ reason: 'Goodwill refund', overridePolicy: true, overrideReason: 'test' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.revocation.draftCredits).toMatchObject({ pool: 'DRAFT', granted: 125, usedFromOrder: 125, removed: 0, shortfall: 125 });
    await expectBalanced(user.id, 'plan refunded');
    expect(conversation).toBeTruthy();
  });
});

// ------------------------------------------------------------- 5. admin

describe('admin — plans, packs, customer, bonus, payments, metrics', () => {
  it('non-admins get 404 on every new admin route', async () => {
    const anon = request(app);
    for (const [m, url] of [['get', '/api/admin/addon-packs'], ['post', '/api/admin/addon-packs'], ['put', '/api/admin/addon-packs/draft_credits_125']]) {
      const res = await anon[m](url).set('Origin', ORIGIN).send({});
      expect(res.status, `${m} ${url}`).toBe(404);
    }
    // A logged-in CUSTOMER is not an admin either.
    const { agent } = await customer();
    expect((await agent.get('/api/admin/addon-packs')).status).toBe(404);
  });

  it('plan editor: draft credits need step-up + reason and are audited; new plans default to the 1/4 rule', async () => {
    const noStep = await adminAgent({ stepUp: false });
    expect((await noStep.put('/api/admin/plans/STARTER').send({ draftCreditsPerCycle: 130, reason: 'more drafts' })).status).toBe(403);
    const admin = await adminAgent();
    expect((await admin.put('/api/admin/plans/STARTER').send({ draftCreditsPerCycle: 130 })).status).toBe(400);
    const res = await admin.put('/api/admin/plans/STARTER').send({ draftCreditsPerCycle: 130, reason: 'more drafts' });
    expect(res.status).toBe(200);
    expect(res.body.draftCreditsPerCycle).toBe(130);
    expect(await prisma.adminAuditLog.count({ where: { action: 'PLAN_UPDATE', targetId: 'STARTER', reason: 'more drafts' } })).toBe(1);

    const created = await admin.post('/api/admin/plans').send({ code: 'DRAFTTEST_X', name: 'Draft test', autoReplyCreditsPerCycle: 101, autoReplyBankCap: 50, reason: 'test plan' });
    expect(created.status).toBe(201);
    expect([created.body.draftCreditsPerCycle, created.body.draftBankCap]).toEqual([25, 12]);

    await prisma.plan.update({ where: { code: 'STARTER' }, data: { draftCreditsPerCycle: 125 } });
    await prisma.plan.delete({ where: { code: 'DRAFTTEST_X' } });
  });

  it('pack editor: create/edit a draft pack with step-up + reason + audit; draft packs never become legacy-active', async () => {
    const noStep = await adminAgent({ stepUp: false });
    const body = { code: 'draft_credits_test', pool: 'DRAFT', creditAmount: 50, isListed: true, prices: [{ planCode: 'STARTER', billingRegion: 'IN', amount: 2990 }], reason: 'new pack' };
    expect((await noStep.post('/api/admin/addon-packs').send(body)).status).toBe(403);
    const admin = await adminAgent();
    expect((await admin.post('/api/admin/addon-packs').send({ ...body, reason: undefined })).status).toBe(400);
    expect((await admin.post('/api/admin/addon-packs').send({ ...body, pool: 'OTHER' })).status).toBe(400);

    const created = await admin.post('/api/admin/addon-packs').send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect([created.body.pool, created.body.isListed, created.body.isActive]).toEqual(['DRAFT', true, false]);

    const hidden = await admin.put('/api/admin/addon-packs/draft_credits_test').send({ isListed: false, prices: [{ planCode: 'PRO', billingRegion: 'IN', amount: 1490 }], reason: 'hide it' });
    expect(hidden.status).toBe(200);
    expect(hidden.body.isListed).toBe(false);
    expect(hidden.body.prices).toEqual([{ planCode: 'PRO', billingRegion: 'IN', currency: 'INR', amount: 1490 }]);
    expect(await prisma.adminAuditLog.count({ where: { action: { in: ['ADDON_PACK_CREATE', 'ADDON_PACK_UPDATE'] }, targetId: 'draft_credits_test' } })).toBe(2);

    // Positive control: a REPLY pack's legacy column follows isListed.
    const reply = await admin.post('/api/admin/addon-packs').send({ ...body, code: 'reply_credits_test', pool: 'REPLY' });
    expect([reply.body.isListed, reply.body.isActive]).toEqual([true, true]);

    const list = await admin.get('/api/admin/addon-packs');
    expect(list.body.map((p) => p.code)).toEqual(expect.arrayContaining(['draft_credits_125', 'draft_credits_500', 'reply_credits_500']));
    await prisma.addonPack.deleteMany({ where: { code: { in: ['draft_credits_test', 'reply_credits_test'] } } });
  });

  it('bonus quota grants bonus draft credits through the ledger, audited; customer detail, payments and metrics show drafts', async () => {
    const { user, agent, conversation } = await customer();
    aiOk();
    await draft(agent, conversation, newKey());
    const order = await buyAddon(agent, 'draft_credits_125');

    const noStep = await adminAgent({ stepUp: false });
    expect((await noStep.post(`/api/admin/users/${user.id}/billing/bonus-quota`).send({ draftCredits: 20, reason: 'goodwill' })).status).toBe(403);
    const admin = await adminAgent();
    expect((await admin.post(`/api/admin/users/${user.id}/billing/bonus-quota`).send({ draftCredits: 20 })).status).toBe(400);
    const res = await admin.post(`/api/admin/users/${user.id}/billing/bonus-quota`).send({ draftCredits: 20, reason: 'goodwill' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.after.draftCredits - res.body.before.draftCredits).toBe(20);
    expect(await prisma.creditLedger.count({ where: { tenantId: user.id, source: 'draft:admin_bonus', delta: 20 } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { action: 'QUOTA_BONUS', targetId: user.id, reason: 'goodwill' } })).toBe(1);
    await expectBalanced(user.id, 'bonus');

    const detail = await admin.get(`/api/admin/users/${user.id}`);
    expect(detail.body.quota).toMatchObject({ draftCreditsCurrent: 124 + 125 + 20, draftCreditsBanked: 0, draftCreditsPerCycle: 125 });

    const payments = await admin.get(`/api/admin/payments?userId=${user.id}`);
    expect(payments.body.payments.find((p) => p.cashfreeOrderId === order.cashfreeOrderId).itemKind).toBe('draft_pack');

    const metrics = await admin.get('/api/admin/metrics?days=7');
    expect(metrics.body.draftsPerDay.reduce((s, d) => s + d.count, 0)).toBe(1);
  });
});
