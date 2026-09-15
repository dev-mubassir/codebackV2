/**
 * Gate 9 — the Cashfree webhook when things go wrong.
 *
 * Already proven elsewhere (ENV-SETUP.md §4, by a self-signed request against
 * the real handler): signature rejection, duplicate replay, unknown event
 * types. This file covers the failure paths, every one driven through the real
 * route with a real HMAC over the exact bytes sent:
 *
 *   1. PAYMENT_FAILED_WEBHOOK
 *   2. an abandoned checkout, retired by the reconciliation job's 7-day rule
 *   3. a success webhook arriving AFTER reconciliation already healed the order
 *   4. malformed payloads carrying a valid signature
 *   5. a database failure between marking PAID and granting
 *   6. the same payload delivered 10 times concurrently
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

/** Cashfree's PG webhook shape (2023-08-01 and later). */
function paymentEvent(orderId, { type = 'PAYMENT_SUCCESS_WEBHOOK', paymentStatus = 'SUCCESS', payment = {} } = {}) {
  return {
    type,
    event_time: new Date().toISOString(),
    data: {
      order: { order_id: orderId, order_amount: 499, order_currency: 'INR', order_tags: null },
      payment: {
        cf_payment_id: Math.floor(Math.random() * 1e9),
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
const grants = (tenantId) => prisma.creditLedger.findMany({ where: { tenantId, type: 'GRANT' } });
const ledgerCount = (tenantId) => prisma.creditLedger.count({ where: { tenantId } });

async function expectBalanced(tenantId) {
  const e = await prisma.entitlement.findUnique({ where: { userId: tenantId } });
  const held = e ? e.replyCreditsCurrent + e.replyCreditsBanked : 0;
  const sum = (await prisma.creditLedger.aggregate({ where: { tenantId }, _sum: { delta: true } }))._sum.delta ?? 0;
  expect(sum, 'ledger sum must equal the held balance').toBe(held);
  return e;
}

let savedSecret;
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (savedSecret === undefined) delete process.env.CASHFREE_SECRET_KEY;
  else process.env.CASHFREE_SECRET_KEY = savedSecret;
  await prisma.$disconnect();
});

describe('Gate 9.1 — PAYMENT_FAILED_WEBHOOK', () => {
  it('grants nothing, writes no ledger row, and records the order as FAILED', async () => {
    const { tenantId, order } = await tenantWithOrder();

    const res = await deliver(paymentEvent(order.cashfreeOrderId, { type: 'PAYMENT_FAILED_WEBHOOK', paymentStatus: 'FAILED' }));

    expect(res.status).toBe(200);
    expect(await orderStatus(order), 'a failed payment is recorded, not left looking pending').toBe('FAILED');
    expect(await prisma.entitlement.findUnique({ where: { userId: tenantId } })).toBeNull();
    expect(await ledgerCount(tenantId)).toBe(0);
  });

  it('a later successful attempt on the SAME order still grants — FAILED records an attempt, not the order', async () => {
    // Cashfree lets a customer retry payment on one order after a failed
    // attempt. If FAILED were terminal for fulfilment, that retry would take
    // money and grant nothing.
    const { tenantId, order } = await tenantWithOrder();
    await deliver(paymentEvent(order.cashfreeOrderId, { type: 'PAYMENT_FAILED_WEBHOOK', paymentStatus: 'FAILED' }));

    const res = await deliver(paymentEvent(order.cashfreeOrderId));

    expect(res.status).toBe(200);
    expect(await orderStatus(order)).toBe('PAID');
    expect(await grants(tenantId)).toHaveLength(1);
    await expectBalanced(tenantId);
  });

  it('a late FAILED webhook never downgrades an order that is already PAID', async () => {
    const { tenantId, order } = await tenantWithOrder();
    await deliver(paymentEvent(order.cashfreeOrderId));

    await deliver(paymentEvent(order.cashfreeOrderId, { type: 'PAYMENT_FAILED_WEBHOOK', paymentStatus: 'FAILED' }));

    expect(await orderStatus(order)).toBe('PAID');
    expect(await grants(tenantId)).toHaveLength(1);
  });
});

describe('Gate 9.2 — abandoned checkout', () => {
  it('USER_DROPPED leaves the order CREATED; the 7-day rule retires it; a late success never grants', async () => {
    const { tenantId, order } = await tenantWithOrder();

    const dropped = await deliver(
      paymentEvent(order.cashfreeOrderId, { type: 'PAYMENT_USER_DROPPED_WEBHOOK', paymentStatus: 'USER_DROPPED' })
    );
    expect(dropped.status).toBe(200);
    expect(await orderStatus(order)).toBe('CREATED');

    // Age it past the rule. The job must retire it WITHOUT asking Cashfree.
    await prisma.order.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - 8 * DAY_MS) } });
    const get = vi.spyOn(axios, 'get');
    const run = await reconcileRecentOrders();
    expect(run.expired).toBe(1);
    expect(get, 'an order past the window is never re-fetched').not.toHaveBeenCalled();
    expect(await orderStatus(order)).toBe('EXPIRED');

    const late = await deliver(paymentEvent(order.cashfreeOrderId));
    expect(late.status, 'acknowledged, so Cashfree stops retrying').toBe(200);
    expect(await orderStatus(order)).toBe('EXPIRED');
    expect(await prisma.entitlement.findUnique({ where: { userId: tenantId } })).toBeNull();
    expect(await ledgerCount(tenantId)).toBe(0);
  });
});

describe('Gate 9.1/9.2 — reconciliation around failed and expired orders', () => {
  const paidAtCashfree = (orderId) =>
    vi.spyOn(axios, 'get').mockImplementation(async (url) => {
      if (url.endsWith('/payments')) {
        return { data: [{ payment_status: 'SUCCESS', payment_group: 'upi', payment_method: { upi: {} } }] };
      }
      return { data: { order_id: orderId, order_status: 'PAID' } };
    });

  it('heals a FAILED attempt whose successful retry webhook was dropped', async () => {
    const { tenantId, order } = await tenantWithOrder();
    await deliver(paymentEvent(order.cashfreeOrderId, { type: 'PAYMENT_FAILED_WEBHOOK', paymentStatus: 'FAILED' }));
    paidAtCashfree(order.cashfreeOrderId);

    const run = await reconcileRecentOrders();

    expect(run.healed).toBe(1);
    expect(await orderStatus(order)).toBe('PAID');
    expect(await grants(tenantId)).toHaveLength(1);
  });

  it('never asks Cashfree about a FAILED order that never reached Cashfree (no payload)', async () => {
    const { order } = await tenantWithOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED' } }); // as routes/billing.js writes it
    const get = paidAtCashfree(order.cashfreeOrderId);

    const run = await reconcileRecentOrders();

    expect(run.checked).toBe(0);
    expect(get).not.toHaveBeenCalled();
    expect(await orderStatus(order)).toBe('FAILED');
  });

  it('a confirmed payment on an EXPIRED order grants nothing but is logged for manual action', async () => {
    const { tenantId, order } = await tenantWithOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: 'EXPIRED' } });
    const error = vi.spyOn(console, 'error');

    const res = await deliver(paymentEvent(order.cashfreeOrderId));

    expect(res.status).toBe(200);
    expect(await ledgerCount(tenantId)).toBe(0);
    expect(error.mock.calls.some((c) => String(c[0]).includes('PAID AFTER EXPIRY'))).toBe(true);
  });
});

describe('Gate 9.3 — out-of-order delivery', () => {
  it('a success webhook after reconciliation healed the order grants nothing more', async () => {
    const { tenantId, order } = await tenantWithOrder();

    vi.spyOn(axios, 'get').mockImplementation(async (url) => {
      if (url.endsWith('/payments')) {
        return { data: [{ payment_status: 'SUCCESS', payment_group: 'upi', payment_method: { upi: {} } }] };
      }
      return { data: { order_id: order.cashfreeOrderId, order_status: 'PAID' } };
    });
    const run = await reconcileRecentOrders();
    expect(run.healed).toBe(1);
    const healed = await prisma.entitlement.findUnique({ where: { userId: tenantId } });

    const res = await deliver(paymentEvent(order.cashfreeOrderId));

    expect(res.status).toBe(200);
    expect(await grants(tenantId)).toHaveLength(1);
    const after = await expectBalanced(tenantId);
    expect(after.validUntil.getTime(), 'validity is not extended a second time').toBe(healed.validUntil.getTime());
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
      payment: { payment_group: ['card'], payment_method: { card: { card_country: { code: 'IN' } } } },
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
    const rows = await prisma.creditLedger.findMany({ where: { tenantId } });
    expect(rows, 'exactly one ledger row').toHaveLength(1);
    expect(rows[0].type).toBe('GRANT');
    const e = await expectBalanced(tenantId);
    expect(e.validUntil.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS + 60_000);
  });
});
