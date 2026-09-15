/**
 * Downgrades wait for the paid period to end — enforced by the checkout API,
 * not just the UI.
 *
 * While a paid plan is ACTIVE, POST /api/billing/checkout/plan refuses a lower
 * tier with 409 PLAN_DOWNGRADE_BLOCKED and a message naming the date the
 * switch opens. No order is created, so nothing can be paid for that would
 * cut short time already bought. Upgrades, same-plan renewals, and any change
 * once the paid period is over (grace, or a trial) go through.
 *
 * GET /api/billing/summary reports the same answer (planChange) so the page
 * can show it before anyone reaches checkout.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser } from './helpers/db.js';
import { installMetaStubs, restoreMetaStubs } from './helpers/fake-meta.js';

const require = createRequire(import.meta.url);
const billingRoutes = require('../src/routes/billing.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const PHONE = '9876543210';

let app;
let ipCounter = 0;
const nextIp = () => `10.88.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

const indiaDate = (d) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d);

beforeAll(() => {
  app = buildTestApp({ mount: { '/api/billing': billingRoutes } });
});

beforeEach(async () => {
  await resetDb();
  for (const [code, name, tier] of [['STARTER', 'Starter', 49900], ['PRO', 'Pro', 129900]]) {
    const plan = await prisma.plan.upsert({
      where: { code },
      update: { isActive: true },
      create: { code, name, igAccountLimit: 1, autoReplyCreditsPerCycle: 500, autoReplyBankCap: 500, cycleLengthDays: 30 },
    });
    await prisma.planPrice.upsert({
      where: { planId_billingRegion: { planId: plan.id, billingRegion: 'IN' } },
      update: {},
      create: { planId: plan.id, billingRegion: 'IN', currency: 'INR', amount: tier },
    });
  }
  // An allowed checkout reaches Cashfree order creation; the network boundary
  // is stubbed, and dummy credentials let it get that far.
  process.env.CASHFREE_APP_ID = 'test-app-id';
  process.env.CASHFREE_SECRET_KEY = 'test-secret-not-real';
  installMetaStubs();
});

afterEach(() => {
  restoreMetaStubs();
  delete process.env.CASHFREE_APP_ID;
  delete process.env.CASHFREE_SECRET_KEY;
});

async function tenantOn(planCode, { status = 'ACTIVE', validUntil = new Date(Date.now() + 12 * DAY_MS), graceUntil } = {}) {
  const { user, password } = await createUser();
  await prisma.entitlement.update({
    where: { userId: user.id },
    data: { planCode, status, validUntil, graceUntil: graceUntil ?? new Date(validUntil.getTime() + 3 * DAY_MS) },
  });
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password });
  expect(res.status).toBe(200);
  return { user, agent, validUntil };
}

const buy = (agent, planCode) => agent.post('/api/billing/checkout/plan').send({ planCode, customerPhone: PHONE });

describe('POST /api/billing/checkout/plan — downgrade block', () => {
  it('refuses a downgrade while a paid plan is active, naming the date, and creates no order', async () => {
    const { user, agent, validUntil } = await tenantOn('PRO');

    const res = await buy(agent, 'STARTER');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_DOWNGRADE_BLOCKED');
    expect(res.body.currentPlanCode).toBe('PRO');
    expect(res.body.requestedPlanCode).toBe('STARTER');
    expect(new Date(res.body.availableFrom).getTime()).toBe(validUntil.getTime());
    expect(res.body.error).toContain(indiaDate(validUntil));
    expect(await prisma.order.count({ where: { tenantId: user.id } }), 'nothing to pay for').toBe(0);
  });

  it('allows an upgrade', async () => {
    const { user, agent } = await tenantOn('STARTER');
    const res = await buy(agent, 'PRO');
    expect(res.status).toBe(200);
    expect(await prisma.order.count({ where: { tenantId: user.id, planCode: 'PRO' } })).toBe(1);
  });

  it('allows a same-plan renewal', async () => {
    const { agent } = await tenantOn('PRO');
    expect((await buy(agent, 'PRO')).status).toBe(200);
  });

  it('allows the lower tier once the paid period is over (grace)', async () => {
    const { agent } = await tenantOn('PRO', {
      validUntil: new Date(Date.now() - DAY_MS),
      graceUntil: new Date(Date.now() + 2 * DAY_MS),
    });
    expect((await buy(agent, 'STARTER')).status).toBe(200);
  });

  it('does not treat a trial as a paid plan to protect', async () => {
    const { agent } = await tenantOn('TRIAL', { status: 'TRIALING', validUntil: new Date(Date.now() + 2 * DAY_MS), graceUntil: null });
    expect((await buy(agent, 'STARTER')).status).toBe(200);
  });
});

describe('GET /api/billing/summary — planChange', () => {
  it('reports the blocked lower tier and the date it opens', async () => {
    const { agent, validUntil } = await tenantOn('PRO');
    const res = await agent.get('/api/billing/summary');
    expect(res.body.planChange.blockedPlanCodes).toEqual(['STARTER']);
    expect(new Date(res.body.planChange.availableFrom).getTime()).toBe(validUntil.getTime());
  });

  it('reports nothing blocked for the lowest tier', async () => {
    const { agent } = await tenantOn('STARTER');
    const res = await agent.get('/api/billing/summary');
    expect(res.body.planChange).toEqual({ blockedPlanCodes: [], availableFrom: null });
  });
});
