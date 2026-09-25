/**
 * Gates 11b and 11c — refunds, and the revocation that keeps a refund from
 * being free service.
 *
 * What must hold:
 *   - refunds are admin-initiated; the policy is REPORTED with its numbers, and
 *     an ineligible refund needs overridePolicy + an override reason (stored)
 *   - status only ever comes from Cashfree; a refund that fails there never
 *     looks successful here, and terminal statuses never move
 *   - a full refund revokes the purchase exactly once, however the SUCCESS
 *     arrives (create response, webhook, replay, concurrent delivery, re-sync)
 *   - validity: restored when nothing stacked on top, shifted back when a later
 *     purchase stacked on it; status recomputed honestly
 *   - credits: removed but never below zero, shortfall recorded; ledger balanced
 *   - a partial refund revokes nothing and raises the CRITICAL alert
 *   - billing:doctor still passes after refunds
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAdmin, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const axios = require('axios');
const svc = require('../src/services/entitlementService.js');
const mailer = require('../src/lib/email/index.js');
const { fulfillPaidOrder } = require('../src/services/billingFulfillment.js');
const igIdentity = require('../src/lib/igIdentity.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..');
const SECRET = 'test-cashfree-secret-not-real';
const DAY_MS = 24 * 60 * 60 * 1000;

// Admin rebuild, Gate 1: the admin is an AdminUser (created per test, since
// resetDb clears admin_users), mutations need an allowlisted Origin, and
// initiating a refund needs a recent step-up. None of that changes refund
// behaviour, which is what this file tests.
const ORIGIN = 'https://app.test.local';

let app;
let paymentSeq = 50000;

async function catalogue() {
  const plans = {
    STARTER: ['Starter', 1, 500, 500, 10000, 500, 30, 49900],
    PRO: ['Pro', 2, 2000, 2000, 50000, 2000, 30, 149900],
  };
  for (const [code, [name, ig, rc, bank, cap, thr, days, price]] of Object.entries(plans)) {
    const data = { name, igAccountLimit: ig, autoReplyCreditsPerCycle: rc, autoReplyBankCap: bank, classificationCapCycle: cap, classificationThrottlePerHour: thr, cycleLengthDays: days, isActive: true };
    const plan = await prisma.plan.upsert({ where: { code }, update: data, create: { code, ...data } });
    await prisma.planPrice.upsert({
      where: { planId_billingRegion: { planId: plan.id, billingRegion: 'IN' } },
      update: { amount: price, currency: 'INR' },
      create: { planId: plan.id, billingRegion: 'IN', currency: 'INR', amount: price },
    });
  }
  await prisma.addonPack.upsert({
    where: { code: 'reply_credits_500' },
    update: { creditAmount: 500, isActive: true },
    create: { code: 'reply_credits_500', creditAmount: 500 },
  });
}

/** A PAID order, fulfilled through the real path so it carries a real grant snapshot. */
async function paidOrder(tenantId, { planCode = null, addonCode = null, amount = 49900 } = {}) {
  const order = await prisma.order.create({
    data: { cashfreeOrderId: `sfy_${uniq('ord')}`, tenantId, planCode, addonCode, amount, currency: 'INR' },
  });
  const result = await fulfillPaidOrder({
    cashfreeOrderId: order.cashfreeOrderId,
    payment: { cf_payment_id: paymentSeq++, payment_group: 'upi' },
    rawPayload: '{}',
  });
  expect(result.outcome).toBe('granted');
  return result.order;
}

/**
 * Spend `n` credits as a stated precondition: one SPEND row and the matching
 * balance change, so the ledger stays balanced without n round trips.
 */
async function spend(tenantId, n) {
  const e = await prisma.entitlement.findUnique({ where: { userId: tenantId } });
  const fromBanked = Math.min(n, e.replyCreditsBanked);
  const updated = await prisma.entitlement.update({
    where: { userId: tenantId },
    data: { replyCreditsBanked: { decrement: fromBanked }, replyCreditsCurrent: { decrement: n - fromBanked } },
  });
  await prisma.creditLedger.create({
    data: { tenantId, delta: -n, type: 'SPEND', source: 'auto_reply_spend', balanceAfter: updated.replyCreditsCurrent + updated.replyCreditsBanked },
  });
}

async function expectBalanced(tenantId, after = '') {
  const e = await prisma.entitlement.findUnique({ where: { userId: tenantId } });
  const held = e ? e.replyCreditsCurrent + e.replyCreditsBanked : 0;
  const sum = (await prisma.creditLedger.aggregate({ where: { tenantId }, _sum: { delta: true } }))._sum.delta ?? 0;
  expect(sum, `ledger sum must equal the held balance ${after}`).toBe(held);
  expect(held, 'a balance is never negative').toBeGreaterThanOrEqual(0);
  return e;
}

const refundExpires = (tenantId) =>
  prisma.creditLedger.findMany({ where: { tenantId, type: 'EXPIRE', source: 'expire:refund' }, orderBy: { createdAt: 'asc' } });

/** Cashfree accepting a refund: PENDING, echoing what was asked. */
function cashfreeAcceptsRefunds() {
  return vi.spyOn(axios, 'post').mockImplementation(async (url, body) => ({
    data: { cf_refund_id: String(paymentSeq++), refund_id: body.refund_id, refund_status: 'PENDING', refund_amount: body.refund_amount },
  }));
}

function deliverRefundWebhook({ orderId, refundId, status, amountMinor, cfRefundId = 991 }) {
  const raw = JSON.stringify({
    type: 'REFUND_STATUS_WEBHOOK',
    event_time: new Date().toISOString(),
    data: {
      refund: {
        cf_refund_id: cfRefundId,
        refund_id: refundId,
        order_id: orderId,
        refund_amount: amountMinor / 100,
        refund_currency: 'INR',
        refund_status: status,
        refund_arn: status === 'SUCCESS' ? 'ARN123' : null,
        status_description: `status ${status}`,
        processed_at: new Date().toISOString(),
      },
    },
  });
  const timestamp = String(Date.now());
  return request(app)
    .post('/webhooks/cashfree')
    .set('Content-Type', 'application/json')
    .set('x-webhook-timestamp', timestamp)
    .set('x-webhook-signature', crypto.createHmac('sha256', SECRET).update(timestamp + raw).digest('base64'))
    .send(raw);
}

let ipSeq = 0;
/**
 * A logged-in, stepped-up admin, from its own address (the admin limiters are
 * per IP). Origin and address are agent defaults, so every call below carries
 * them without repeating them.
 */
async function adminAgent() {
  const { admin, password } = await createAdmin();
  const ip = `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  const agent = request.agent(app).set('Origin', ORIGIN).set('X-Forwarded-For', ip);
  const res = await agent.post('/api/admin/login').send({ email: admin.email, password });
  expect(res.status).toBe(200);
  expect((await agent.post('/api/admin/step-up').send({ password })).status).toBe(200);
  return agent;
}

/** Admin initiates a refund; returns the created refund row. */
async function refund(agent, order, body = {}) {
  const res = await agent.post(`/api/admin/billing/orders/${order.cashfreeOrderId}/refunds`).send({ reason: 'Customer asked within the window', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.refund;
}

let saved = {};
beforeAll(async () => {
  saved = { secret: process.env.CASHFREE_SECRET_KEY, support: process.env.SUPPORT_EMAIL };
  process.env.CASHFREE_SECRET_KEY = SECRET;
  process.env.CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || 'test-cashfree-app';
  const adminRoutes = (await import('../src/routes/admin.js')).default;
  const webhookRoutes = (await import('../src/routes/cashfreeWebhooks.js')).default;
  app = buildTestApp({ admin: adminRoutes, mount: { '/webhooks/cashfree': webhookRoutes } });
});

let alert;
beforeEach(async () => {
  await resetDb();
  await catalogue();
  process.env.SUPPORT_EMAIL = 'support@test.codeback';
  alert = vi.spyOn(mailer, 'sendBillingOpsAlert').mockResolvedValue({ id: 'alert' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (saved.secret === undefined) delete process.env.CASHFREE_SECRET_KEY;
  else process.env.CASHFREE_SECRET_KEY = saved.secret;
  if (saved.support === undefined) delete process.env.SUPPORT_EMAIL;
  else process.env.SUPPORT_EMAIL = saved.support;
  await prisma.$disconnect();
});

const alertKinds = () => alert.mock.calls.map((c) => c[1].kind);

describe('11b — the admin endpoint and the refund policy', () => {
  it('requires an admin session', async () => {
    // 404, not 401: the admin API answers every non-admin exactly like an
    // unknown URL (admin rebuild, Gate 1).
    const res = await request(app).post('/api/admin/billing/orders/sfy_x/refunds').set('Origin', ORIGIN).send({ reason: 'x' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found.' });
  });

  it('reports eligibility with the usage numbers it decided on', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    await spend(user.id, 40);
    const agent = await adminAgent();

    const res = await agent.get(`/api/admin/billing/orders/${order.cashfreeOrderId}/refund-eligibility`);

    expect(res.status).toBe(200);
    expect(res.body.refundableAmount).toBe(49900);
    expect(res.body.policy).toMatchObject({
      eligible: true,
      kind: 'plan',
      windowDays: 7,
      creditsGranted: 500,
      creditsAheadAtGrant: 0,
      creditsSpentSincePayment: 40,
      creditsUsedFromPurchase: 40,
      usageMeasure: 'fifo_from_purchase',
      usedPercent: 8,
      usageLimitPercent: 20,
    });
  });

  it('20% used: 409 with the numbers until overridePolicy and an overrideReason are sent — then both are stored', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    await spend(user.id, 100);
    const post = cashfreeAcceptsRefunds();
    const agent = await adminAgent();
    const url = `/api/admin/billing/orders/${order.cashfreeOrderId}/refunds`;

    const refused = await agent.post(url).send({ reason: 'asked' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('REFUND_POLICY_INELIGIBLE');
    expect(refused.body.policy).toMatchObject({ eligible: false, usedPercent: 20, creditsUsedFromPurchase: 100 });

    expect((await agent.post(url).send({ reason: 'asked', overridePolicy: true })).status, 'override needs its reason').toBe(400);
    expect(post, 'nothing reached Cashfree while refused').not.toHaveBeenCalled();

    const ok = await agent.post(url).send({ reason: 'asked', overridePolicy: true, overrideReason: 'Service outage on our side' });
    expect(ok.status).toBe(201);
    const row = await prisma.refund.findUnique({ where: { refundId: ok.body.refund.refundId } });
    expect(row).toMatchObject({ status: 'PENDING', overridePolicy: true, overrideReason: 'Service outage on our side' });
    expect(row.initiatedBy, 'the admin who issued it').toBeTruthy();
    expect(row.initiatedBy).not.toBe('cashfree:external');
    expect(row.policyCheck).toMatchObject({ eligible: false, usedPercent: 20 });
  });

  it('a reason is always required', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    const agent = await adminAgent();
    const res = await agent.post(`/api/admin/billing/orders/${order.cashfreeOrderId}/refunds`).send({ reason: '  ' });
    expect(res.status).toBe(400);
  });

  it('outside the 7-day window is ineligible', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    await prisma.order.update({ where: { id: order.id }, data: { paidAt: new Date(Date.now() - 8 * DAY_MS) } });
    const agent = await adminAgent();

    const res = await agent.get(`/api/admin/billing/orders/${order.cashfreeOrderId}/refund-eligibility`);

    expect(res.body.policy.eligible).toBe(false);
    expect(res.body.policy.reasons.join(' ')).toMatch(/window is 7 days/);
  });

  it('a top-up is eligible only while none of ITS credits are used — credits already held spend first', async () => {
    const { user } = await createUser({ withTrial: false });
    await paidOrder(user.id, { planCode: 'STARTER' });
    const pack = await paidOrder(user.id, { addonCode: 'reply_credits_500', amount: 19900 });
    const agent = await adminAgent();
    const url = `/api/admin/billing/orders/${pack.cashfreeOrderId}/refund-eligibility`;

    expect((await agent.get(url)).body.policy).toMatchObject({ eligible: true, kind: 'reply_pack', creditsAheadAtGrant: 500 });
    await spend(user.id, 500);
    expect((await agent.get(url)).body.policy, 'the 500 plan credits ahead of it went first').toMatchObject({
      eligible: true,
      creditsUsedFromPurchase: 0,
    });
    await spend(user.id, 1);
    expect((await agent.get(url)).body.policy).toMatchObject({ eligible: false, creditsUsedFromPurchase: 1 });
  });

  it('refuses an amount above what is still refundable', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    const agent = await adminAgent();
    const res = await agent.post(`/api/admin/billing/orders/${order.cashfreeOrderId}/refunds`).send({ reason: 'x', amount: 50000 });
    expect(res.status).toBe(409);
  });
});

describe('11b — status comes only from Cashfree', () => {
  it('Cashfree refusing the refund (4xx): FAILED, 502, nothing revoked', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    vi.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('bad'), { response: { status: 400, data: { message: 'refund amount invalid' } } }));
    const agent = await adminAgent();

    const res = await agent.post(`/api/admin/billing/orders/${order.cashfreeOrderId}/refunds`).send({ reason: 'x' });

    expect(res.status).toBe(502);
    const [row] = await prisma.refund.findMany({ where: { cashfreeOrderId: order.cashfreeOrderId } });
    expect([row.status, row.revokedAt]).toEqual(['FAILED', null]);
    const e = await expectBalanced(user.id);
    expect([e.status, e.replyCreditsCurrent]).toEqual(['ACTIVE', 500]);
  });

  it('no answer from Cashfree: stays REQUESTED (never assumed), and a re-sync applies what Cashfree says', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('socket hang up'));
    const agent = await adminAgent();

    const res = await agent.post(`/api/admin/billing/orders/${order.cashfreeOrderId}/refunds`).send({ reason: 'x' });
    expect(res.status).toBe(502);
    const [row] = await prisma.refund.findMany({ where: { cashfreeOrderId: order.cashfreeOrderId } });
    expect(row.status).toBe('REQUESTED');
    expect((await prisma.entitlement.findUnique({ where: { userId: user.id } })).status).toBe('ACTIVE');

    vi.spyOn(axios, 'get').mockResolvedValue({ data: { refund_id: row.refundId, refund_status: 'SUCCESS', refund_amount: 499, cf_refund_id: 5 } });
    const sync = await agent.post(`/api/admin/billing/refunds/${row.refundId}/sync`);

    expect(sync.status).toBe(200);
    expect((await prisma.refund.findUnique({ where: { refundId: row.refundId } })).status).toBe('SUCCESS');
    expect(await refundExpires(user.id)).toHaveLength(1);
  });

  it('FAILED at Cashfree is terminal: nothing revoked, and a later SUCCESS for it is ignored', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    cashfreeAcceptsRefunds();
    const agent = await adminAgent();
    const row = await refund(agent, order);

    await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: row.refundId, status: 'FAILED', amountMinor: 49900 });
    await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 49900 });

    expect((await prisma.refund.findUnique({ where: { refundId: row.refundId } })).status).toBe('FAILED');
    expect(await refundExpires(user.id)).toHaveLength(0);
    expect((await prisma.entitlement.findUnique({ where: { userId: user.id } })).status).toBe('ACTIVE');
  });

  it('a malformed but signed refund webhook is acknowledged and changes nothing', async () => {
    const raw = JSON.stringify({ type: 'REFUND_STATUS_WEBHOOK', data: { refund: { refund_id: { x: 1 }, order_id: 7 } } });
    const timestamp = String(Date.now());
    const res = await request(app)
      .post('/webhooks/cashfree')
      .set('Content-Type', 'application/json')
      .set('x-webhook-timestamp', timestamp)
      .set('x-webhook-signature', crypto.createHmac('sha256', SECRET).update(timestamp + raw).digest('base64'))
      .send(raw);
    expect(res.status).toBe(200);
    expect(await prisma.refund.count()).toBe(0);
  });

  it('a forged refund webhook (bad signature) is rejected', async () => {
    const res = await request(app)
      .post('/webhooks/cashfree')
      .set('Content-Type', 'application/json')
      .set('x-webhook-timestamp', String(Date.now()))
      .set('x-webhook-signature', 'forged')
      .send(JSON.stringify({ type: 'REFUND_STATUS_WEBHOOK', data: { refund: { refund_id: 'rf_x', order_id: 'sfy_x', refund_status: 'SUCCESS' } } }));
    expect(res.status).toBe(401);
  });
});

describe('11c — a full refund revokes the purchase, exactly once', () => {
  it('cold-start plan: restored to no entitlement; credits removed with an expire:refund row; PENDING revokes nothing', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    cashfreeAcceptsRefunds();
    const agent = await adminAgent();

    const row = await refund(agent, order);
    expect(row.status).toBe('PENDING');
    expect((await prisma.entitlement.findUnique({ where: { userId: user.id } })).status, 'PENDING revokes nothing').toBe('ACTIVE');

    const res = await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 49900 });
    expect(res.status).toBe(200);

    const e = await expectBalanced(user.id, 'after revocation');
    expect([e.status, e.planCode, e.validUntil, e.graceUntil]).toEqual(['NONE', null, null, null]);
    expect(e.replyCreditsCurrent + e.replyCreditsBanked).toBe(0);
    const [expire] = await refundExpires(user.id);
    expect(expire.delta).toBe(-500);
    expect(expire.note).toContain('granted 500, used 0, removed 500');
    const stored = await prisma.refund.findUnique({ where: { refundId: row.refundId } });
    expect(stored.revokedAt).not.toBeNull();
    expect(stored.revocation).toMatchObject({ validity: { mode: 'restored_prior' }, credits: { granted: 500, removed: 500, shortfall: 0 } });
    expect(alertKinds()).toEqual([]);
  });

  it('a replayed SUCCESS revokes nothing more', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    cashfreeAcceptsRefunds();
    const row = await refund(await adminAgent(), order);
    const success = { orderId: order.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 49900 };

    await deliverRefundWebhook(success);
    await deliverRefundWebhook(success);
    await deliverRefundWebhook({ ...success, status: 'PENDING' });

    expect(await refundExpires(user.id)).toHaveLength(1);
    expect((await prisma.refund.findUnique({ where: { refundId: row.refundId } })).status).toBe('SUCCESS');
    await expectBalanced(user.id);
  });

  it('five concurrent SUCCESS deliveries revoke once', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    cashfreeAcceptsRefunds();
    const row = await refund(await adminAgent(), order);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 49900 })
      )
    );

    expect(results.map((r) => r.status).every((s) => s === 200)).toBe(true);
    expect(await refundExpires(user.id)).toHaveLength(1);
    await expectBalanced(user.id);
  });

  it('credits already spent: balance clamped at zero, the shortfall recorded', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    await spend(user.id, 450);
    cashfreeAcceptsRefunds();
    const row = await refund(await adminAgent(), order, { overridePolicy: true, overrideReason: 'Goodwill' });

    await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 49900 });

    const e = await expectBalanced(user.id);
    expect(e.replyCreditsCurrent + e.replyCreditsBanked).toBe(0);
    const [expire] = await refundExpires(user.id);
    expect(expire.delta).toBe(-50);
    expect(expire.note).toMatch(/granted 500, used 450, removed 50, shortfall 450/);
  });

  it('an upgrade refunded with nothing after it: back to the previous plan and its dates', async () => {
    const { user } = await createUser({ withTrial: false });
    const starter = await paidOrder(user.id, { planCode: 'STARTER' });
    const pro = await paidOrder(user.id, { planCode: 'PRO', amount: 149900 });
    cashfreeAcceptsRefunds();
    const row = await refund(await adminAgent(), pro);

    await deliverRefundWebhook({ orderId: pro.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 149900 });

    const e = await expectBalanced(user.id);
    expect(e.planCode).toBe('STARTER');
    expect(e.status).toBe('ACTIVE');
    expect(e.validUntil.toISOString()).toBe(starter.grantSnapshot.grantedValidUntil);
    expect(e.replyCreditsCurrent + e.replyCreditsBanked, 'Pro credits removed, the carried Starter credits kept').toBe(500);
  });

  it('an earlier order under a later stacked purchase: validity shifts back one cycle, the current plan stays', async () => {
    const { user } = await createUser({ withTrial: false });
    const starter = await paidOrder(user.id, { planCode: 'STARTER' });
    await paidOrder(user.id, { planCode: 'PRO', amount: 149900 });
    const before = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    cashfreeAcceptsRefunds();
    const row = await refund(await adminAgent(), starter);

    await deliverRefundWebhook({ orderId: starter.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 49900 });

    const e = await expectBalanced(user.id);
    expect(e.planCode).toBe('PRO');
    expect(e.validUntil.getTime()).toBe(before.validUntil.getTime() - 30 * DAY_MS);
    expect(e.graceUntil.getTime()).toBe(before.graceUntil.getTime() - 30 * DAY_MS);
    const stored = await prisma.refund.findUnique({ where: { refundId: row.refundId } });
    expect(stored.revocation.validity.mode).toBe('shifted_back');
  });

  it('a plan bought on top of a live trial: refund restores the trial, honestly TRIALING', async () => {
    const { user } = await createUser({ withTrial: true });
    const trial = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    cashfreeAcceptsRefunds();
    const row = await refund(await adminAgent(), order);

    await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 49900 });

    const e = await expectBalanced(user.id);
    expect([e.planCode, e.status]).toEqual(['TRIAL', 'TRIALING']);
    expect(e.validUntil.getTime()).toBe(trial.validUntil.getTime());
  });

  it('never leaves ACTIVE with no paid time behind it: a refund onto a lapsed plan is EXPIRED', async () => {
    const { user } = await createUser({ withTrial: false });
    await prisma.entitlement.create({
      data: {
        userId: user.id,
        planCode: 'STARTER',
        status: 'EXPIRED',
        validUntil: new Date(Date.now() - 20 * DAY_MS),
        graceUntil: new Date(Date.now() - 17 * DAY_MS),
      },
    });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    cashfreeAcceptsRefunds();
    const row = await refund(await adminAgent(), order);

    await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 49900 });

    const e = await expectBalanced(user.id);
    expect([e.planCode, e.status]).toEqual(['STARTER', 'EXPIRED']);
    expect(svc.effectiveStatus(e)).toBe('EXPIRED');
  });

  it('a reply pack: its credits removed, scoped to that pack', async () => {
    const { user } = await createUser({ withTrial: false });
    await paidOrder(user.id, { planCode: 'STARTER' });
    const pack = await paidOrder(user.id, { addonCode: 'reply_credits_500', amount: 19900 });
    cashfreeAcceptsRefunds();
    const row = await refund(await adminAgent(), pack);

    await deliverRefundWebhook({ orderId: pack.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 19900 });

    const e = await expectBalanced(user.id);
    expect([e.planCode, e.status, e.replyCreditsCurrent + e.replyCreditsBanked]).toEqual(['STARTER', 'ACTIVE', 500]);
  });

  it('the extra Instagram account add-on: one slot removed, no credit row', async () => {
    const { user } = await createUser({ withTrial: false });
    await paidOrder(user.id, { planCode: 'STARTER' });
    const slot = await paidOrder(user.id, { addonCode: 'extra_ig_account', amount: 9900 });
    expect((await prisma.entitlement.findUnique({ where: { userId: user.id } })).extraIgAccounts).toBe(1);
    cashfreeAcceptsRefunds();
    const row = await refund(await adminAgent(), slot);

    await deliverRefundWebhook({ orderId: slot.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 9900 });

    const e = await expectBalanced(user.id);
    expect(e.extraIgAccounts).toBe(0);
    expect(await refundExpires(user.id)).toHaveLength(0);
  });
});

describe('11c — partial refunds and refunds issued outside Siffty', () => {
  it('a partial refund revokes nothing and alerts; the refund completing the total then revokes once', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    cashfreeAcceptsRefunds();
    const agent = await adminAgent();

    const first = await refund(agent, order, { amount: 20000 });
    await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: first.refundId, status: 'SUCCESS', amountMinor: 20000 });

    let e = await expectBalanced(user.id);
    expect([e.status, e.replyCreditsCurrent]).toEqual(['ACTIVE', 500]);
    expect(alertKinds()).toEqual(['partialRefund']);
    expect(alert.mock.calls[0][1].details).toMatchObject({ refundedThisTime: 20000, refundedTotal: 20000, orderAmount: 49900 });

    const rest = await refund(agent, order);
    expect(rest.amount, 'defaults to what is still refundable').toBe(29900);
    await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: rest.refundId, status: 'SUCCESS', amountMinor: 29900 });

    e = await expectBalanced(user.id);
    expect(e.status).toBe('NONE');
    expect(await refundExpires(user.id)).toHaveLength(1);
    expect(alertKinds(), 'the completing refund is not partial').toEqual(['partialRefund']);
  });

  it('a refund issued outside Siffty is recorded, revokes when full, and alerts', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });

    const res = await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: 'dashboard_refund_1', status: 'SUCCESS', amountMinor: 49900 });

    expect(res.status).toBe(200);
    const row = await prisma.refund.findUnique({ where: { refundId: 'dashboard_refund_1' } });
    expect(row).toMatchObject({ initiatedBy: 'cashfree:external', amount: 49900, status: 'SUCCESS' });
    expect(row.revokedAt).not.toBeNull();
    expect((await expectBalanced(user.id)).status).toBe('NONE');
    expect(alertKinds()).toEqual(['refundOutsideSiffty']);
  });

  it('an order paid before grant snapshots existed: revoked by estimate, and a human is told', async () => {
    const { user } = await createUser({ withTrial: false });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    await prisma.$executeRaw`UPDATE orders SET grant_snapshot = NULL WHERE cashfree_order_id = ${order.cashfreeOrderId}`;
    const before = await prisma.entitlement.findUnique({ where: { userId: user.id } });

    await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: 'legacy_refund_1', status: 'SUCCESS', amountMinor: 49900 });

    const e = await expectBalanced(user.id);
    expect(e.validUntil.getTime()).toBe(before.validUntil.getTime() - 30 * DAY_MS);
    expect(alertKinds()).toEqual(['refundOutsideSiffty', 'refundSnapshotMissing']);
  });
});

describe('Usage is measured on the purchase’s own credits (FIFO)', () => {
  it('an early renewer is not charged for spending the credits they carried over', async () => {
    const { user } = await createUser({ withTrial: false });
    await paidOrder(user.id, { planCode: 'STARTER' });
    await spend(user.id, 300); // 200 left
    const renewal = await paidOrder(user.id, { planCode: 'STARTER' });
    const agent = await adminAgent();
    const url = `/api/admin/billing/orders/${renewal.cashfreeOrderId}/refund-eligibility`;

    await spend(user.id, 150); // all from the carried 200
    expect((await agent.get(url)).body.policy).toMatchObject({
      eligible: true,
      creditsAheadAtGrant: 200,
      creditsSpentSincePayment: 150,
      creditsUsedFromPurchase: 0,
      usedPercent: 0,
    });

    await spend(user.id, 60); // 50 more carried, then 10 of the renewal's own
    expect((await agent.get(url)).body.policy).toMatchObject({ eligible: true, creditsUsedFromPurchase: 10, usedPercent: 2 });
  });

  it('refunding a plan takes back only what is left of ITS credits — a top-up behind it stays whole', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await paidOrder(user.id, { planCode: 'STARTER' });
    await paidOrder(user.id, { addonCode: 'reply_credits_500', amount: 19900 });
    await spend(user.id, 100); // from the plan's 500, which is ahead of the top-up
    cashfreeAcceptsRefunds();
    const row = await refund(await adminAgent(), plan, { overridePolicy: true, overrideReason: 'Goodwill' });

    await deliverRefundWebhook({ orderId: plan.cashfreeOrderId, refundId: row.refundId, status: 'SUCCESS', amountMinor: 49900 });

    const e = await expectBalanced(user.id);
    expect(e.replyCreditsCurrent + e.replyCreditsBanked, 'the top-up’s 500 untouched').toBe(500);
    const [expire] = await refundExpires(user.id);
    expect(expire.note).toMatch(/granted 500, used 100, removed 400, shortfall 100/);
  });
});

describe('Extra Instagram account slots', () => {
  const eligibility = async (agent, order) =>
    (await agent.get(`/api/admin/billing/orders/${order.cashfreeOrderId}/refund-eligibility`)).body.policy;

  it('refundable while no account was ever connected using the slot; a connect closes it for good', async () => {
    const { user } = await createUser({ withTrial: false });
    await paidOrder(user.id, { planCode: 'STARTER' }); // includes 1 account
    await createAccount({ userId: user.id });
    const slot = await paidOrder(user.id, { addonCode: 'extra_ig_account', amount: 9900 });
    const agent = await adminAgent();

    expect(await eligibility(agent, slot)).toMatchObject({ eligible: true, kind: 'extra_ig_account', slotUsedAt: null });

    const second = await createAccount({ userId: user.id });
    await svc.recordInstagramSlotUsage(user.id); // what the connect callback calls
    let policy = await eligibility(agent, slot);
    expect(policy.eligible).toBe(false);
    expect(policy.reasons.join(' ')).toMatch(/connected using this slot/);

    await prisma.instagramAccount.update({ where: { id: second.id }, data: { connectionStatus: 'DISCONNECTED' } });
    await svc.recordInstagramSlotUsage(user.id);
    policy = await eligibility(agent, slot);
    expect(policy.eligible, '"ever connected" survives a disconnect').toBe(false);
  });

  it('a slot bought while already over the included count is used at once', async () => {
    const { user } = await createUser({ withTrial: false });
    await paidOrder(user.id, { planCode: 'STARTER' });
    await createAccount({ userId: user.id });
    await createAccount({ userId: user.id });
    const slot = await paidOrder(user.id, { addonCode: 'extra_ig_account', amount: 9900 });

    expect((await prisma.order.findUnique({ where: { id: slot.id } })).slotUsedAt).not.toBeNull();
  });

  it('both connect branches of the Instagram callback record slot usage', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(join(BACKEND_ROOT, 'src', 'routes', 'auth.js'), 'utf8');
    expect(src.match(/await recordInstagramSlotUsage\(/g)).toHaveLength(2);
  });
});

describe('A trial after a refund', () => {
  it('a refund that restores "no plan" lets that account claim its trial', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const order = await paidOrder(user.id, { planCode: 'STARTER' });
    const igUserId = uniq('ig-after-refund');
    await createAccount({ userId: user.id, igUserId });
    const connect = await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId, emailVerified: true });
    expect(connect.trialOutcome, 'already on a paid plan at connect: no trial, and no stamp').toBe('ALREADY_ENTITLED');

    await deliverRefundWebhook({ orderId: order.cashfreeOrderId, refundId: 'rf_then_trial', status: 'SUCCESS', amountMinor: 49900 });
    expect((await expectBalanced(user.id)).status).toBe('NONE');

    const claim = await igIdentity.claimTrialForUser({ userId: user.id });
    expect(claim).toMatchObject({ trialGranted: true, trialOutcome: 'TRIAL_GRANTED' });
    const e = await expectBalanced(user.id, 'trial after refund');
    expect([e.status, e.planCode]).toEqual(['TRIALING', 'TRIAL']);

    const again = await igIdentity.claimTrialForUser({ userId: user.id });
    expect(again.trialGranted, 'trialConsumedAt still governs: one trial per identity').toBe(false);
  });
});

describe('11c — billing:doctor after refunds', () => {
  it('passes, and reports the refund checks', async () => {
    const { user } = await createUser({ withTrial: false });
    const full = await paidOrder(user.id, { planCode: 'STARTER' });
    const { user: other } = await createUser({ withTrial: false });
    const partial = await paidOrder(other.id, { planCode: 'STARTER' });
    await deliverRefundWebhook({ orderId: full.cashfreeOrderId, refundId: 'doc_full', status: 'SUCCESS', amountMinor: 49900 });
    await deliverRefundWebhook({ orderId: partial.cashfreeOrderId, refundId: 'doc_partial', status: 'SUCCESS', amountMinor: 10000 });

    let output;
    try {
      output = execFileSync(process.execPath, ['scripts/billing-doctor.js'], {
        cwd: BACKEND_ROOT,
        env: { ...process.env, BILLING_ENABLED: 'true', CASHFREE_APP_ID: 'x', CASHFREE_SECRET_KEY: 'y' },
        encoding: 'utf8',
      });
    } catch (err) {
      throw new Error(`billing:doctor exited ${err.status}:\n${err.stdout}\n${err.stderr}`);
    }
    expect(output).toMatch(/OK\s+Refund revocation/);
    expect(output).toMatch(/OK\s+Ledger invariant/);
    expect(output).toMatch(/WARN\s+Partial refunds/);
  });
});
