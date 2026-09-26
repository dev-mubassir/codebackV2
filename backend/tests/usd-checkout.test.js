/**
 * International (USD / INTL) checkout — Gate 3c.
 *
 *   - USD_PRICING_ENABLED is ENFORCED at checkout: with it off, an INTL order
 *     is refused (crafted hint, or a region locked INTL) and nothing is created
 *   - with it on, the Cashfree order is created in USD for exactly the seeded
 *     USD plan price
 *   - a USD payment is fulfilled exactly once even if the webhook repeats
 *
 * Cashfree itself is mocked here (axios). Whether USD orders are enabled on the
 * live merchant account is an ACCOUNT setting this suite cannot see — see the
 * Gate 3c report.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser } from './helpers/db.js';

const require = createRequire(import.meta.url);
const axios = require('axios');
const { fulfillPaidOrder } = require('../src/services/billingFulfillment.js');

let app;
let ipSeq = 0;
const nextIp = () => `10.89.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
const saved = {};

beforeAll(async () => {
  process.env.CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || 'test-cashfree-app';
  process.env.CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || 'test-cashfree-secret';
  saved.usd = process.env.USD_PRICING_ENABLED;
  app = buildTestApp({ mount: { '/api/billing': (await import('../src/routes/billing.js')).default } });
});

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (saved.usd === undefined) delete process.env.USD_PRICING_ENABLED;
  else process.env.USD_PRICING_ENABLED = saved.usd;
});

afterAll(async () => prisma.$disconnect());

async function signedIn() {
  const { user, password } = await createUser({});
  const agent = request.agent(app);
  const login = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password });
  expect(login.status).toBe(200);
  return { user, agent };
}

const seededUsdPrice = async (code) => {
  const plan = await prisma.plan.findUnique({ where: { code }, include: { prices: true } });
  return plan.prices.find((p) => p.billingRegion === 'INTL');
};

describe('USD_PRICING_ENABLED is enforced at checkout', () => {
  it('flag off: an INTL hint is refused with INTL_PRICING_DISABLED and no order or Cashfree call is made', async () => {
    delete process.env.USD_PRICING_ENABLED;
    const { user, agent } = await signedIn();
    const post = vi.spyOn(axios, 'post');
    const res = await agent.post('/api/billing/checkout/plan').send({ planCode: 'PRO', billingRegionHint: 'INTL', customerPhone: '9999999999' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INTL_PRICING_DISABLED');
    expect(post).not.toHaveBeenCalled();
    expect(await prisma.order.count({ where: { tenantId: user.id } })).toBe(0);
  });

  it('flag off: a tenant whose region is locked INTL is refused too', async () => {
    delete process.env.USD_PRICING_ENABLED;
    const { user, agent } = await signedIn();
    await prisma.entitlement.update({ where: { userId: user.id }, data: { billingRegion: 'INTL', currency: 'USD' } });
    const res = await agent.post('/api/billing/checkout/plan').send({ planCode: 'PRO', customerPhone: '9999999999' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INTL_PRICING_DISABLED');
  });

  it('flag off: an INR checkout is unaffected', async () => {
    delete process.env.USD_PRICING_ENABLED;
    const { agent } = await signedIn();
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { payment_session_id: 'session_inr' } });
    const res = await agent.post('/api/billing/checkout/plan').send({ planCode: 'PRO', customerPhone: '9999999999' });
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('INR');
  });

  it('flag on: the Cashfree order is created in USD for exactly the seeded USD price', async () => {
    process.env.USD_PRICING_ENABLED = 'true';
    const { user, agent } = await signedIn();
    const price = await seededUsdPrice('PRO');
    expect(price.currency).toBe('USD');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { payment_session_id: 'session_usd' } });

    const res = await agent.post('/api/billing/checkout/plan').send({ planCode: 'PRO', billingRegionHint: 'INTL', customerPhone: '9999999999' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currency: 'USD', amount: price.amount });

    const [, body] = post.mock.calls[0];
    expect(body.order_currency).toBe('USD');
    expect(body.order_amount).toBe(price.amount / 100); // cents -> dollars, 2 decimals
    const order = await prisma.order.findFirst({ where: { tenantId: user.id } });
    expect(order).toMatchObject({ currency: 'USD', amount: price.amount, status: 'CREATED' });
  });
});

describe('a USD payment is fulfilled exactly once', () => {
  it('the webhook repeated three times grants the plan once (one PAID transition)', async () => {
    const { user } = await createUser({ withTrial: false });
    const price = await seededUsdPrice('PRO');
    const order = await prisma.order.create({
      data: { cashfreeOrderId: 'sfy_usd_once_1', tenantId: user.id, planCode: 'PRO', amount: price.amount, currency: 'USD' },
    });
    const payment = { cf_payment_id: 987654321, payment_group: 'paypal', payment_currency: 'USD', payment_amount: price.amount / 100 };

    const outcomes = [];
    for (let i = 0; i < 3; i += 1) {
      outcomes.push((await fulfillPaidOrder({ cashfreeOrderId: order.cashfreeOrderId, payment, rawPayload: '{}' })).outcome);
    }
    expect(outcomes.filter((o) => o !== 'already_processed')).toHaveLength(1);
    const after = await prisma.order.findUnique({ where: { id: order.id } });
    expect(after.status).toBe('PAID');
    const e = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(e.planCode).toBe('PRO');
    const grants = await prisma.creditLedger.count({ where: { tenantId: user.id, type: 'GRANT' } });
    expect(grants).toBeGreaterThanOrEqual(1);
    const grantsAfterReplay = await prisma.creditLedger.count({ where: { tenantId: user.id, type: 'GRANT' } });
    expect(grantsAfterReplay).toBe(grants);
  });
});
