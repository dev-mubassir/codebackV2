/**
 * Add-on checkout for a tenant with NO region lock (production bug, 2026-09-26).
 *
 * An admin-granted plan (adminBilling.grantPlanWithExpiry) deliberately sets no
 * region lock — there is no payment evidence. The add-on checkout used to
 * REQUIRE a lock, so every add-on was refused for those tenants with
 * "Add-ons require an active Starter or Pro plan." It now prices them like a
 * first plan purchase: locked region wins, else the hint (default IN), with
 * USD_PRICING_ENABLED still enforced.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser } from './helpers/db.js';

const require = createRequire(import.meta.url);
const axios = require('axios');
const adminBilling = require('../src/services/adminBilling.js');
const { fulfillPaidOrder } = require('../src/services/billingFulfillment.js');

const DAY = 24 * 60 * 60 * 1000;
let app;
let ipSeq = 0;
const nextIp = () => `10.91.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
const saved = {};

beforeAll(async () => {
  process.env.CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || 'test-cashfree-app';
  process.env.CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || 'test-cashfree-secret';
  saved.usd = process.env.USD_PRICING_ENABLED;
  app = buildTestApp({ mount: { '/api/billing': (await import('../src/routes/billing.js')).default } });
});

beforeEach(async () => {
  await resetDb();
  delete process.env.USD_PRICING_ENABLED;
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

async function adminGrantedStarter() {
  const s = await signedIn();
  await adminBilling.grantPlanWithExpiry(s.user.id, 'STARTER', new Date(Date.now() + 14 * DAY));
  const e = await prisma.entitlement.findUnique({ where: { userId: s.user.id } });
  expect(e).toMatchObject({ planCode: 'STARTER', status: 'ACTIVE', billingRegion: null });
  return s;
}

const packPrice = async (code, planCode, billingRegion) => {
  const pack = await prisma.addonPack.findUnique({ where: { code } });
  return prisma.addonPackPrice.findUnique({
    where: { addonPackId_planCode_billingRegion: { addonPackId: pack.id, planCode, billingRegion } },
  });
};

describe('add-on checkout with no region lock', () => {
  it('an admin-granted Starter (no region) can buy a draft pack, priced IN by default, and gets the credits', async () => {
    const { user, agent } = await adminGrantedStarter();
    const price = await packPrice('draft_credits_125', 'STARTER', 'IN');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { payment_session_id: 'sess_unlocked' } });

    const res = await agent.post('/api/billing/checkout/addon').send({ addonCode: 'draft_credits_125', customerPhone: '9999999999' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ amount: price.amount, currency: 'INR' });
    const [, body] = post.mock.calls[0];
    expect(body.order_currency).toBe('INR');

    const before = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    const payment = { cf_payment_id: 7700001, payment_group: 'upi', payment_currency: 'INR', payment_amount: price.amount / 100 };
    const out = await fulfillPaidOrder({ cashfreeOrderId: res.body.orderId, payment, rawPayload: '{}' });
    expect(out.outcome).not.toBe('already_processed');
    const after = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(after.draftCreditsCurrent + after.draftCreditsBanked).toBe(before.draftCreditsCurrent + before.draftCreditsBanked + 125);
    expect(after.planCode).toBe('STARTER');
    // An add-on never locks a region: the next purchase still prices by the hint.
    expect(after.billingRegion).toBeNull();
  });

  it('the INTL hint is still refused while USD_PRICING_ENABLED is off, with no order or Cashfree call', async () => {
    const { user, agent } = await adminGrantedStarter();
    const post = vi.spyOn(axios, 'post');
    const res = await agent.post('/api/billing/checkout/addon').send({ addonCode: 'draft_credits_125', billingRegionHint: 'INTL', customerPhone: '9999999999' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INTL_PRICING_DISABLED');
    expect(post).not.toHaveBeenCalled();
    expect(await prisma.order.count({ where: { tenantId: user.id } })).toBe(0);
  });

  it('a locked region wins over the hint', async () => {
    const { user, agent } = await adminGrantedStarter();
    await prisma.entitlement.update({ where: { userId: user.id }, data: { billingRegion: 'IN', currency: 'INR', regionSource: 'RAIL_INFERRED' } });
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { payment_session_id: 'sess_locked' } });
    const res = await agent.post('/api/billing/checkout/addon').send({ addonCode: 'draft_credits_125', billingRegionHint: 'INTL', customerPhone: '9999999999' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.currency).toBe('INR');
  });

  it('a trial tenant is still refused with the plan message', async () => {
    const { agent } = await signedIn();
    const res = await agent.post('/api/billing/checkout/addon').send({ addonCode: 'draft_credits_125', customerPhone: '9999999999' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Add-ons require an active Starter or Pro plan.');
  });
});
