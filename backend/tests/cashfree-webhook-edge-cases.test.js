/**
 * Gate 9 — the Cashfree webhook when things go wrong.
 *
 * Already proven elsewhere (ENV-SETUP.md §4, by a self-signed request against
 * the real handler): signature rejection, duplicate replay, unknown event
 * types. This file covers the failure paths, every one driven through the real
 * route with a real HMAC over the exact bytes sent:
 *
 *   1. PAYMENT_FAILED_WEBHOOK
 *   2. an abandoned checkout, and how orders reach their terminal state
 *   3. a success webhook arriving AFTER reconciliation already healed the order
 *   4. malformed payloads carrying a valid signature
 *   5. a database failure between marking PAID and granting
 *   6. the same payload delivered 10 times concurrently
 *
 * ORDER STATE IS "HAS A SUCCESSFUL PAYMENT OR NOT". A failed or abandoned
 * attempt is a PaymentAttempt row and never changes the order; EXPIRED, the
 * only terminal state, comes only from expiry.
 *
 * The invariant checked throughout is the one that matters to a customer: a
 * payment is granted exactly once, and never marked PAID with nothing granted.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const axios = require('axios');
const svc = require('../src/services/entitlementService.js');
const mailer = require('../src/lib/email/index.js');
const cashfreeOrders = require('../src/lib/cashfreeOrders.js');
const { reconcileRecentOrders } = require('../src/jobs/billingReconciliationJob.js');

const SECRET = 'test-cashfree-secret-not-real';
const DAY_MS = 24 * 60 * 60 * 1000;

let app;

function sign(raw, timestamp) {
  return crypto.createHmac('sha256', SECRET).update(timestamp + raw).digest('base64');
}

/** POST raw bytes with a VALID signature over exactly those bytes. */
function deliver(bodyOrRaw) {
  const raw = typeof bodyOrRaw === 'string' ? bodyOrRaw : JSON.stringify(bodyOrRaw);
  const timestamp = String(Date.now());
  return request(app)
    .post('/webhooks/cashfree')
    .set('Content-Type', 'application/json')
    .set('x-webhook-timestamp', timestamp)
    .set('x-webhook-signature', sign(raw, timestamp))
    .send(raw);
}

let paymentSeq = 1000;

/** Cashfree's PG webhook shape (2023-08-01 and later). */
function paymentEvent(orderId, { type = 'PAYMENT_SUCCESS_WEBHOOK', paymentStatus = 'SUCCESS', payment = {} } = {}) {
  return {
    type,
    event_time: new Date().toISOString(),
    data: {
      order: { order_id: orderId, order_amount: 499, order_currency: 'INR', order_tags: null },
      payment: {
        cf_payment_id: paymentSeq++,
        payment_status: paymentStatus,
        payment_amount: 499,
        payment_currency: 'INR',
        payment_group: 'upi',
        payment_method: { upi: { channel: 'collect', upi_id: 'someone@okbank' } },
        ...payment,
      },
      customer_details: { customer_id: 'c1', customer_email: 'x@test.codeback', customer_phone: '9999999999' },
    },
  };
}

const failedEvent = (orderId) =>
  paymentEvent(orderId, { type: 'PAYMENT_FAILED_WEBHOOK', paymentStatus: 'FAILED', payment: { payment_message: 'Insufficient funds' } });

async function catalogue() {
  const plans = {
    STARTER: ['Starter', 1, 500, 500, 10000, 500, 30],
    PRO: ['Pro', 2, 2000, 2000, 50000, 2000, 30],
  };
  for (const [code, [name, ig, rc, bank, cap, thr, days]] of Object.entries(plans)) {
    const data = { name, igAccountLimit: ig, autoReplyCreditsPerCycle: rc, autoReplyBankCap: bank, classificationCapCycle: cap, classificationThrottlePerHour: thr, cycleLengthDays: days, isActive: true };
    await prisma.plan.upsert({ where: { code }, update: data, create: { code, ...data } });
  }
  await prisma.addonPack.upsert({
    where: { code: 'reply_credits_500' },
    update: { creditAmount: 500, isActive: true },
    create: { code: 'reply_credits_500', creditAmount: 500 },
  });
}

async function tenantWithOrder({ planCode = 'STARTER', addonCode = null, createdAt } = {}) {
  const { user } = await createUser({ withTrial: false });
  const order = await prisma.order.create({
    data: {
      cashfreeOrderId: `sfy_${uniq('ord')}`,
      tenantId: user.id,
      planCode: addonCode ? null : planCode,
      addonCode,
      amount: 49900,
      currency: 'INR',
      ...(createdAt ? { createdAt } : {}),
    },
  });
  return { tenantId: user.id, order };
}

const orderStatus = async (order) => (await prisma.order.findUnique({ where: { id: order.id } })).status;
const attemptsFor = (order) =>
  prisma.paymentAttempt.findMany({ where: { cashfreeOrderId: order.cashfreeOrderId }, orderBy: { createdAt: 'asc' } });
// Reply-pool rows only; every grant also writes a DRAFT-pool row (draft credits).
const grants = (tenantId) => prisma.creditLedger.findMany({ where: { tenantId, type: 'GRANT', pool: 'REPLY' } });
const ledgerCount = (tenantId) => prisma.creditLedger.count({ where: { tenantId, pool: 'REPLY' } });

async function expectBalanced(tenantId) {
  const e = await prisma.entitlement.findUnique({ where: { userId: tenantId } });
  const held = e ? e.replyCreditsCurrent + e.replyCreditsBanked : 0;
  const sum = (await prisma.creditLedger.aggregate({ where: { tenantId, pool: 'REPLY' }, _sum: { delta: true } }))._sum.delta ?? 0;
  expect(sum, 'ledger sum must equal the held balance').toBe(held);
  const draftHeld = e ? e.draftCreditsCurrent + e.draftCreditsBanked : 0;
  const draftSum = (await prisma.creditLedger.aggregate({ where: { tenantId, pool: 'DRAFT' }, _sum: { delta: true } }))._sum.delta ?? 0;
  expect(draftSum, 'DRAFT ledger sum must equal the held draft balance').toBe(draftHeld);
  return e;
}

/** Mock Cashfree's order/payment reads for the reconciliation job. */
function cashfreeReports(orderStatusAtCashfree) {
  return vi.spyOn(axios, 'get').mockImplementation(async (url) => {
    if (url.endsWith('/payments')) {
      return { data: [{ cf_payment_id: 777, payment_status: 'SUCCESS', payment_group: 'upi', payment_method: { upi: {} } }] };
    }
    return { data: { order_status: orderStatusAtCashfree } };
  });
}

let savedSecret;
let savedSupport;
beforeAll(async () => {
  savedSecret = process.env.CASHFREE_SECRET_KEY;
  process.env.CASHFREE_SECRET_KEY = SECRET;
  process.env.CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || 'test-cashfree-app';
  const routes = (await import('../src/routes/cashfreeWebhooks.js')).default;
  app = buildTestApp({ mount: { '/webhooks/cashfree': routes } });
});

beforeEach(async () => {
  await resetDb();
  await catalogue();
  savedSupport = process.env.SUPPORT_EMAIL;
  process.env.SUPPORT_EMAIL = 'support@test.codeback';
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedSupport === undefined) delete process.env.SUPPORT_EMAIL;
  else process.env.SUPPORT_EMAIL = savedSupport;
});

afterAll(async () => {
  if (savedSecret === undefined) delete process.env.CASHFREE_SECRET_KEY;
  else process.env.CASHFREE_SECRET_KEY = savedSecret;
  await prisma.$disconnect();
});

describe('Gate 9.1 — PAYMENT_FAILED_WEBHOOK', () => {
  it('records a FAILED attempt, leaves the order CREATED, grants nothing, writes no ledger row', async () => {
    const { tenantId, order } = await tenantWithOrder();

    const res = await deliver(failedEvent(order.cashfreeOrderId));

    expect(res.status).toBe(200);
    expect(await orderStatus(order), 'a failed attempt is not an order state').toBe('CREATED');
    const [attempt] = await attemptsFor(order);
    expect([attempt.status, attempt.eventType, attempt.failureReason]).toEqual(['FAILED', 'PAYMENT_FAILED_WEBHOOK', 'Insufficient funds']);
    expect(await prisma.entitlement.findUnique({ where: { userId: tenantId } })).toBeNull();
    expect(await ledgerCount(tenantId)).toBe(0);
  });

  it('a replayed FAILED webhook records the attempt once', async () => {
    const { order } = await tenantWithOrder();
    const raw = JSON.stringify(failedEvent(order.cashfreeOrderId));

    await deliver(raw);
    await deliver(raw);

    expect(await attemptsFor(order)).toHaveLength(1);
  });

  it('a later successful attempt on the SAME order grants, and both attempts are kept', async () => {
    const { tenantId, order } = await tenantWithOrder();
    await deliver(failedEvent(order.cashfreeOrderId));

    const res = await deliver(paymentEvent(order.cashfreeOrderId));

    expect(res.status).toBe(200);
    expect(await orderStatus(order)).toBe('PAID');
    expect((await attemptsFor(order)).map((a) => a.status)).toEqual(['FAILED', 'SUCCESS']);
    expect(await grants(tenantId)).toHaveLength(1);
    await expectBalanced(tenantId);
  });

  it('a late FAILED webhook for an order already PAID changes nothing but the attempt log', async () => {
    const { tenantId, order } = await tenantWithOrder();
    await deliver(paymentEvent(order.cashfreeOrderId));

    await deliver(failedEvent(order.cashfreeOrderId));

    expect(await orderStatus(order)).toBe('PAID');
    expect(await grants(tenantId)).toHaveLength(1);
  });
});

describe('Gate 9.2 — abandoned checkout and terminal states', () => {
  it('USER_DROPPED records an attempt and leaves the order CREATED', async () => {
    const { order } = await tenantWithOrder();

    const res = await deliver(paymentEvent(order.cashfreeOrderId, { type: 'PAYMENT_USER_DROPPED_WEBHOOK', paymentStatus: 'USER_DROPPED' }));

    expect(res.status).toBe(200);
    expect(await orderStatus(order)).toBe('CREATED');
    expect((await attemptsFor(order)).map((a) => a.status)).toEqual(['USER_DROPPED']);
  });

  it('orders are created at Cashfree with a 60-minute order_expiry_time', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { payment_session_id: 'sess' } });
    const before = Date.now();

    await cashfreeOrders.createOrder({
      orderId: 'sfy_expiry_test',
      amountInPaise: 49900,
      currency: 'INR',
      customerId: 'c1',
      customerEmail: 'x@test.codeback',
      customerPhone: '9999999999',
      returnUrl: 'https://app.test.local/billing',
    });

    const body = post.mock.calls[0][1];
    expect(body.order_expiry_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/);
    const expiresAt = new Date(body.order_expiry_time).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 59 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 61 * 60 * 1000);
  });

  it('reconciliation expires an order Cashfree reports EXPIRED, and a late success never grants', async () => {
    const { tenantId, order } = await tenantWithOrder();
    cashfreeReports('EXPIRED');

    const run = await reconcileRecentOrders();

    expect(run.expiredAtCashfree).toBe(1);
    expect(await orderStatus(order)).toBe('EXPIRED');

    vi.restoreAllMocks();
    const alert = vi.spyOn(mailer, 'sendBillingOpsAlert').mockResolvedValue({ id: 'x' });
    const late = await deliver(paymentEvent(order.cashfreeOrderId));
    expect(late.status, 'acknowledged, so Cashfree stops retrying').toBe(200);
    expect(await orderStatus(order)).toBe('EXPIRED');
    expect(await ledgerCount(tenantId)).toBe(0);
    expect(alert.mock.calls.map((c) => c[1].kind), 'money taken with nothing granted reaches a human').toEqual(['paidAfterExpiry']);
  });

  it('reconciliation expires an order Cashfree has no record of (checkout failed before creating it)', async () => {
    const { order } = await tenantWithOrder();
    vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('not found'), { response: { status: 404, data: {} } }));

    const run = await reconcileRecentOrders();

    expect([run.expiredAtCashfree, run.checkFailures]).toEqual([1, 0]);
    expect(await orderStatus(order)).toBe('EXPIRED');
  });

  it('an order still ACTIVE at Cashfree is left CREATED', async () => {
    const { order } = await tenantWithOrder();
    cashfreeReports('ACTIVE');

    await reconcileRecentOrders();

    expect(await orderStatus(order)).toBe('CREATED');
  });

  it('the 7-day safety net retires an unresolved order WITHOUT asking Cashfree, and alerts', async () => {
    const { tenantId, order } = await tenantWithOrder({ createdAt: new Date(Date.now() - 8 * DAY_MS) });
    const get = vi.spyOn(axios, 'get');
    const alert = vi.spyOn(mailer, 'sendBillingOpsAlert').mockResolvedValue({ id: 'x' });

    const run = await reconcileRecentOrders();

    expect(run.expired).toBe(1);
    expect(get, 'an order past the window is never re-fetched').not.toHaveBeenCalled();
    expect(await orderStatus(order)).toBe('EXPIRED');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][1].kind).toBe('staleOrdersExpired');
    expect(alert.mock.calls[0][1].details.orders[0]).toContain(order.cashfreeOrderId);
    expect(await ledgerCount(tenantId)).toBe(0);
  });

  it('the safety net sends nothing when it has nothing to retire', async () => {
    const alert = vi.spyOn(mailer, 'sendBillingOpsAlert');
    await reconcileRecentOrders();
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('Gate 9.3 — out-of-order delivery', () => {
  it('a success webhook after reconciliation healed the order grants nothing more', async () => {
    const { tenantId, order } = await tenantWithOrder();
    vi.spyOn(mailer, 'sendBillingReconciliationMismatch').mockResolvedValue({ id: 'x' });
    cashfreeReports('PAID');

    const run = await reconcileRecentOrders();
    expect(run.healed).toBe(1);
    const healed = await prisma.entitlement.findUnique({ where: { userId: tenantId } });

    const res = await deliver(paymentEvent(order.cashfreeOrderId));

    expect(res.status).toBe(200);
    expect(await grants(tenantId)).toHaveLength(1);
    const after = await expectBalanced(tenantId);
    expect(after.validUntil.getTime(), 'validity is not extended a second time').toBe(healed.validUntil.getTime());
  });

  it('a heal records its attempt and the grant snapshot', async () => {
    const { order } = await tenantWithOrder();
    vi.spyOn(mailer, 'sendBillingReconciliationMismatch').mockResolvedValue({ id: 'x' });
    cashfreeReports('PAID');

    await reconcileRecentOrders();

    const [attempt] = await attemptsFor(order);
    expect([attempt.status, attempt.eventType]).toEqual(['SUCCESS', 'RECONCILIATION']);
    const paid = await prisma.order.findUnique({ where: { id: order.id } });
    expect(paid.grantSnapshot).toMatchObject({ priorPlanCode: null, grantedCredits: 500, grantedDays: 30 });
  });
});

describe('Gate 9.4 — malformed payloads with a valid signature', () => {
  const cases = [
    ['missing order_id', (id) => { const e = paymentEvent(id); delete e.data.order.order_id; return e; }],
    ['missing data.order entirely', (id) => { const e = paymentEvent(id); delete e.data.order; return e; }],
    ['missing data entirely', () => ({ type: 'PAYMENT_SUCCESS_WEBHOOK' })],
    ['missing type', (id) => { const e = paymentEvent(id); delete e.type; return e; }],
    ['order_id is an object', (id) => { const e = paymentEvent(id); e.data.order.order_id = { $ne: null }; return e; }],
    ['order_id is a number', (id) => { const e = paymentEvent(id); e.data.order.order_id = 12345; return e; }],
    ['data.order is a string', () => ({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: 'sfy_x', payment: 'SUCCESS' } })],
    ['body is a JSON array', () => '[1,2,3]'],
    ['FAILED webhook with an object order_id', (id) => { const e = failedEvent(id); e.data.order.order_id = { id }; return e; }],
  ];

  for (const [label, build] of cases) {
    it(`${label}: a deliberate 2xx/4xx, logged, nothing granted`, async () => {
      const { tenantId, order } = await tenantWithOrder();
      const warn = vi.spyOn(console, 'warn');
      const error = vi.spyOn(console, 'error');
      const log = vi.spyOn(console, 'log');

      const res = await deliver(build(order.cashfreeOrderId));

      expect(res.status, 'never a 5xx: that is an infinite Cashfree retry for a payload that can never succeed').toBeLessThan(500);
      expect(warn.mock.calls.length + error.mock.calls.length + log.mock.calls.length, 'the rejection is logged').toBeGreaterThan(0);
      expect(await orderStatus(order)).toBe('CREATED');
      expect(await ledgerCount(tenantId)).toBe(0);
    });
  }

  it('missing payment_method still grants, with UNVERIFIED region evidence', async () => {
    const { tenantId, order } = await tenantWithOrder();
    const event = paymentEvent(order.cashfreeOrderId);
    delete event.data.payment.payment_method;
    delete event.data.payment.payment_group;

    const res = await deliver(event);

    expect(res.status).toBe(200);
    const paid = await prisma.order.findUnique({ where: { id: order.id } });
    expect([paid.status, paid.regionSource]).toEqual(['PAID', 'UNVERIFIED']);
    const e = await expectBalanced(tenantId);
    expect(e.billingRegion, 'no evidence, no lock').toBeNull();
  });

  it('unexpected nesting inside payment_method (card_country as an object) does not crash the route', async () => {
    const { tenantId, order } = await tenantWithOrder();
    const event = paymentEvent(order.cashfreeOrderId, {
      payment: { payment_group: ['card'], payment_method: { card: { card_country: { code: 'IN' } } }, cf_payment_id: { nested: true } },
    });

    const res = await deliver(event);

    expect(res.status).toBe(200);
    const paid = await prisma.order.findUnique({ where: { id: order.id } });
    expect([paid.status, paid.regionSource, paid.paymentCountry]).toEqual(['PAID', 'UNVERIFIED', null]);
    expect(await grants(tenantId)).toHaveLength(1);
  });
});

describe('Gate 9.5 — database failure mid-fulfilment', () => {
  it('a throw between marking PAID and granting rolls back wholly, returns 500, and the retry grants once', async () => {
    const { tenantId, order } = await tenantWithOrder();
    vi.spyOn(svc, 'grantPlan').mockRejectedValueOnce(new Error('simulated: connection lost before grant'));

    const first = await deliver(paymentEvent(order.cashfreeOrderId));

    expect(first.status, '500 so Cashfree retries').toBe(500);
    expect(await orderStatus(order), 'PAID must roll back with the failed grant').toBe('CREATED');
    expect(await attemptsFor(order), 'the attempt row rolls back too').toHaveLength(0);
    expect(await prisma.entitlement.findUnique({ where: { userId: tenantId } })).toBeNull();
    expect(await ledgerCount(tenantId)).toBe(0);

    const retry = await deliver(paymentEvent(order.cashfreeOrderId));

    expect(retry.status).toBe(200);
    expect(await orderStatus(order)).toBe('PAID');
    expect(await grants(tenantId)).toHaveLength(1);
    await expectBalanced(tenantId);
  });

  it('a throw AFTER the grant wrote its rows still rolls back the grant, the ledger row, and PAID', async () => {
    const { tenantId, order } = await tenantWithOrder();
    const realGrantPlan = svc.grantPlan;
    vi.spyOn(svc, 'grantPlan').mockImplementationOnce(async (...args) => {
      await realGrantPlan(...args);
      throw new Error('simulated: failure after the grant wrote');
    });

    const first = await deliver(paymentEvent(order.cashfreeOrderId));

    expect(first.status).toBe(500);
    expect(await orderStatus(order)).toBe('CREATED');
    expect(await prisma.entitlement.findUnique({ where: { userId: tenantId } }), 'no half-granted entitlement').toBeNull();
    expect(await ledgerCount(tenantId), 'no orphan ledger row').toBe(0);

    const retry = await deliver(paymentEvent(order.cashfreeOrderId));
    expect(retry.status).toBe(200);
    expect(await grants(tenantId)).toHaveLength(1);
    await expectBalanced(tenantId);
  });

  it('the same holds for an add-on order', async () => {
    const { tenantId } = await tenantWithOrder();
    await svc.grantPlan(tenantId, 'STARTER', { billingRegion: 'IN', currency: 'INR', regionSource: 'RAIL_INFERRED' });
    const addon = await prisma.order.create({
      data: { cashfreeOrderId: `sfy_${uniq('addon')}`, tenantId, addonCode: 'reply_credits_500', amount: 19900, currency: 'INR' },
    });
    const before = await prisma.entitlement.findUnique({ where: { userId: tenantId } });
    const realGrantAddon = svc.grantAddon;
    vi.spyOn(svc, 'grantAddon').mockImplementationOnce(async (...args) => {
      await realGrantAddon(...args);
      throw new Error('simulated: failure after the add-on grant wrote');
    });

    const first = await deliver(paymentEvent(addon.cashfreeOrderId));
    expect(first.status).toBe(500);
    expect(await orderStatus(addon)).toBe('CREATED');
    const unchanged = await expectBalanced(tenantId);
    expect(unchanged.replyCreditsCurrent).toBe(before.replyCreditsCurrent);

    const retry = await deliver(paymentEvent(addon.cashfreeOrderId));
    expect(retry.status).toBe(200);
    const after = await expectBalanced(tenantId);
    expect(after.replyCreditsCurrent).toBe(before.replyCreditsCurrent + 500);
  });
});

describe('Gate 9.6 — retry storm', () => {
  it('the same valid payload delivered 10 times concurrently grants once', async () => {
    const { tenantId, order } = await tenantWithOrder();
    const raw = JSON.stringify(paymentEvent(order.cashfreeOrderId));

    const responses = await Promise.all(Array.from({ length: 10 }, () => deliver(raw)));

    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 200), `every delivery acknowledged, got ${statuses.join(',')}`).toBe(true);
    expect(await orderStatus(order)).toBe('PAID');
    expect(await attemptsFor(order), 'one attempt row for one attempt').toHaveLength(1);
    const rows = await prisma.creditLedger.findMany({ where: { tenantId, pool: 'REPLY' } });
    expect(rows, 'exactly one ledger row').toHaveLength(1);
    expect(rows[0].type).toBe('GRANT');
    const e = await expectBalanced(tenantId);
    expect(e.validUntil.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS + 60_000);
  });
});

describe('Gate 9.7 — Cashfree ids larger than a JavaScript number', () => {
  // From the real sandbox run on 15 September 2026: this payment was recorded as
  // two attempts, 1453353814355098112 and 1453353814355098000, because a JSON
  // number above Number.MAX_SAFE_INTEGER is rounded by JSON.parse.
  const BIG_ID = '1453353814355098112';
  const { parseCashfreeJson } = require('../src/lib/cashfree.js');

  it('parseCashfreeJson keeps every digit of cf_*_id numbers, and leaves other numbers alone', () => {
    const parsed = parseCashfreeJson(`{"cf_payment_id":${BIG_ID},"cf_refund_id": 42,"payment_amount":499.5,"note":"cf_payment_id: 1"}`);
    expect(parsed).toEqual({ cf_payment_id: BIG_ID, cf_refund_id: '42', payment_amount: 499.5, note: 'cf_payment_id: 1' });
    expect(String(JSON.parse(`{"id":${BIG_ID}}`).id), 'plain JSON.parse loses the last digits').toBe('1453353814355098000');
  });

  it('a success webhook with the id as a JSON number, then replayed with it as a string, is ONE attempt with the exact id', async () => {
    const { tenantId, order } = await tenantWithOrder();
    const event = paymentEvent(order.cashfreeOrderId);
    const asString = JSON.stringify({ ...event, data: { ...event.data, payment: { ...event.data.payment, cf_payment_id: BIG_ID } } });
    const asNumber = asString.replace(`"${BIG_ID}"`, BIG_ID);
    expect(asNumber).toContain(`"cf_payment_id":${BIG_ID}`);

    expect((await deliver(asNumber)).status).toBe(200);
    expect((await deliver(asString)).status).toBe(200);

    expect((await attemptsFor(order)).map((a) => a.cfPaymentId)).toEqual([BIG_ID]);
    expect(await grants(tenantId)).toHaveLength(1);
  });

  it('every Cashfree API call parses its response with the id-safe parser', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: [] });
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    const body = `[{"cf_payment_id":${BIG_ID}}]`;

    await cashfreeOrders.getOrder('sfy_x');
    await cashfreeOrders.getPaymentsForOrder('sfy_x');
    await cashfreeOrders.getRefund('sfy_x', 'rf_x');
    await cashfreeOrders.createRefund({ orderId: 'sfy_x', refundId: 'rf_x', amountInPaise: 100, note: 'n' });
    await cashfreeOrders.createOrder({ orderId: 'sfy_x', amountInPaise: 100, currency: 'INR', customerId: 'c', customerPhone: '9999999999', returnUrl: 'https://x.test' });

    const configs = [...get.mock.calls.map((c) => c[1]), ...post.mock.calls.map((c) => c[2])];
    expect(configs).toHaveLength(5);
    for (const config of configs) {
      expect(config.transformResponse[0](body)[0].cf_payment_id).toBe(BIG_ID);
    }
  });
});
