/**
 * Gate 5 contract — GET /api/billing/summary.
 *
 * This is the endpoint the in-app billing page renders from, and it returns
 * the three things most worth getting wrong: someone's plan, their credit
 * balance, and their payment history. So the properties pinned here are the
 * ones that would be expensive to discover in production:
 *
 *   - It is TENANT-SCOPED to the session, with no client-supplied id
 *     anywhere in its surface. The isolation block below proves it by
 *     seeding two tenants with deliberately distinguishable data and
 *     checking that neither can see a single field of the other's.
 *   - It never leaks the classification cap/throttle, for the same reason
 *     /plans doesn't: they are an internal ceiling, never advertised.
 *   - Its renewal preview anchors on validUntil, not today — the page states
 *     that date as a promise, so the arithmetic has to be the server's and
 *     it has to match grantPlan's.
 *   - It is behind BILLING_ENABLED like every other billing route.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';

import { prisma, resetDb, createUser, uniq } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';

const require = createRequire(import.meta.url);
const billingRoutes = require('../src/routes/billing.js');

const app = buildTestApp({ mount: { '/api/billing': billingRoutes } });

const DAY_MS = 24 * 60 * 60 * 1000;

let ipCounter = 0;
const nextIp = () => `10.55.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

async function loginAgent(email, password) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password });
  expect(res.status, `login should succeed, got ${res.status}`).toBe(200);
  return agent;
}

/**
 * resetDb() clears tenant data but not the financial tables (Order,
 * CreditLedger) — they are deliberately not user-cascading, so nothing else
 * wipes them. Clearing them here keeps each case independent without
 * changing a helper other suites share.
 */
async function resetBillingDb() {
  await prisma.creditLedger.deleteMany({});
  await prisma.order.deleteMany({});
  await resetDb();
}

/** The catalogue the seed migration installs; re-seeded only if an earlier file cleared it. */
async function ensureCatalogue() {
  if ((await prisma.plan.count({ where: { code: 'STARTER' } })) > 0) return;
  const starter = await prisma.plan.create({
    data: {
      code: 'STARTER',
      name: 'Starter',
      igAccountLimit: 1,
      autoReplyCreditsPerCycle: 500,
      autoReplyBankCap: 500,
      classificationCapCycle: 10000,
      classificationThrottlePerHour: 500,
      cycleLengthDays: 30,
    },
  });
  await prisma.planPrice.create({
    data: { planId: starter.id, billingRegion: 'IN', currency: 'INR', amount: 49900 },
  });
}

/** Put a tenant on a paid plan with a known cycle position and credit split. */
async function putOnStarter(
  userId,
  { daysLeft = 12, current = 300, banked = 100, classifications = 0, cycleStartedAt = new Date() } = {}
) {
  const validUntil = new Date(Date.now() + daysLeft * DAY_MS);
  return prisma.entitlement.upsert({
    where: { userId },
    create: {
      userId,
      planCode: 'STARTER',
      status: 'ACTIVE',
      billingRegion: 'IN',
      currency: 'INR',
      regionSource: 'RAIL_INFERRED',
      validUntil,
      graceUntil: new Date(validUntil.getTime() + 3 * DAY_MS),
      cycleStartedAt,
      replyCreditsCurrent: current,
      replyCreditsBanked: banked,
      classificationCountCycle: classifications,
    },
    update: {
      planCode: 'STARTER',
      status: 'ACTIVE',
      billingRegion: 'IN',
      currency: 'INR',
      regionSource: 'RAIL_INFERRED',
      validUntil,
      graceUntil: new Date(validUntil.getTime() + 3 * DAY_MS),
      cycleStartedAt,
      replyCreditsCurrent: current,
      replyCreditsBanked: banked,
      classificationCountCycle: classifications,
    },
  });
}

/** `count` SPEND rows for a tenant, i.e. `count` auto-replies actually sent. */
async function recordSpends(tenantId, count, when = new Date()) {
  for (let i = 0; i < count; i += 1) {
    await prisma.creditLedger.create({
      data: { tenantId, delta: -1, type: 'SPEND', source: 'auto_reply_spend', balanceAfter: 0, createdAt: when },
    });
  }
}

beforeEach(async () => {
  await resetBillingDb();
  await ensureCatalogue();
  process.env.BILLING_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.BILLING_ENABLED;
});

describe('GET /api/billing/summary — access control', () => {
  it('404s while BILLING_ENABLED is off, even for a logged-in tenant', async () => {
    const { user, password } = await createUser();
    const agent = await loginAgent(user.email, password);

    delete process.env.BILLING_ENABLED;
    const res = await agent.get('/api/billing/summary');
    // 404, never 403 — a disabled feature must not confirm it exists.
    expect(res.status).toBe(404);
  });

  it('401s with no session — unlike /plans, this one is per-tenant data', async () => {
    const res = await request(app).get('/api/billing/summary');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/billing/summary — tenant isolation', () => {
  it('returns the caller\'s own entitlement, never another tenant\'s', async () => {
    const a = await createUser({ name: 'Tenant A' });
    const b = await createUser({ name: 'Tenant B' });

    // Deliberately distinguishable: A is a paying Starter with a big
    // balance, B has nothing but the trial the fixture gives them.
    await putOnStarter(a.user.id, { current: 411, banked: 89, classifications: 777 });

    const agentB = await loginAgent(b.user.email, b.password);
    const res = await agentB.get('/api/billing/summary');

    expect(res.status).toBe(200);
    expect(res.body.plan?.code).not.toBe('STARTER');
    expect(res.body.credits.current).toBe(0);
    expect(res.body.credits.banked).toBe(0);
    expect(res.body.usage.classificationsThisCycle).toBe(0);
    // Non-vacuous: A's numbers really are in the database right now.
    const aRow = await prisma.entitlement.findUnique({ where: { userId: a.user.id } });
    expect(aRow.replyCreditsCurrent).toBe(411);
  });

  it('returns only the caller\'s orders, with another tenant\'s orders present in the table', async () => {
    const a = await createUser({ name: 'Tenant A' });
    const b = await createUser({ name: 'Tenant B' });

    await prisma.order.create({
      data: {
        cashfreeOrderId: uniq('sfy-a'),
        tenantId: a.user.id,
        planCode: 'STARTER',
        amount: 49900,
        currency: 'INR',
        status: 'PAID',
        paidAt: new Date(),
      },
    });
    await prisma.order.create({
      data: {
        cashfreeOrderId: uniq('sfy-b'),
        tenantId: b.user.id,
        addonCode: 'reply_credits_500',
        amount: 24900,
        currency: 'INR',
        status: 'PAID',
        paidAt: new Date(),
      },
    });

    const agentB = await loginAgent(b.user.email, b.password);
    const res = await agentB.get('/api/billing/summary');

    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].addonCode).toBe('reply_credits_500');
    // And the unscoped view really does contain two rows, so the assertion
    // above is filtering something rather than reading an empty table.
    expect(await prisma.order.count()).toBe(2);
  });

  it('ignores a client-supplied tenant id entirely — identity comes only from the session', async () => {
    const a = await createUser({ name: 'Tenant A' });
    const b = await createUser({ name: 'Tenant B' });
    await putOnStarter(a.user.id, { current: 411, banked: 89 });

    const agentB = await loginAgent(b.user.email, b.password);
    const res = await agentB
      .get(`/api/billing/summary?tenantId=${a.user.id}&userId=${a.user.id}`)
      .set('X-User-Id', a.user.id);

    expect(res.status).toBe(200);
    expect(res.body.credits.current).toBe(0);
    expect(res.body.orders).toEqual([]);
  });
});

describe('GET /api/billing/summary — what it exposes', () => {
  it('NEVER exposes the classification cap or throttle', async () => {
    const { user, password } = await createUser();
    await putOnStarter(user.id, { classifications: 812 });
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/api/billing/summary');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('classificationCapCycle');
    expect(serialized).not.toContain('classificationThrottlePerHour');
    // The customer's OWN usage is fine to show — it's the ceiling that isn't.
    expect(res.body.usage.classificationsThisCycle).toBe(812);
  });

  it('never ships an order\'s raw webhook payload or region provenance', async () => {
    const { user, password } = await createUser();
    await prisma.order.create({
      data: {
        cashfreeOrderId: uniq('sfy'),
        tenantId: user.id,
        planCode: 'STARTER',
        amount: 49900,
        currency: 'INR',
        status: 'PAID',
        paidAt: new Date(),
        paymentCountry: 'IN',
        regionSource: 'RAIL_INFERRED',
        rawPayload: '{"secret":"WEBHOOK-BODY-NOT-FOR-THE-CLIENT"}',
      },
    });

    const agent = await loginAgent(user.email, password);
    const res = await agent.get('/api/billing/summary');

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('WEBHOOK-BODY-NOT-FOR-THE-CLIENT');
    expect(serialized).not.toContain('rawPayload');
    expect(serialized).not.toContain('regionSource');
    expect(res.body.orders[0].amount).toBe(49900);
  });

  it('reports credits as current + banked, and days remaining from validUntil', async () => {
    const { user, password } = await createUser();
    await putOnStarter(user.id, { daysLeft: 12, current: 300, banked: 100 });

    const agent = await loginAgent(user.email, password);
    const res = await agent.get('/api/billing/summary');

    expect(res.body.plan.code).toBe('STARTER');
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.credits.current).toBe(300);
    expect(res.body.credits.banked).toBe(100);
    expect(res.body.credits.remaining).toBe(400);
    expect(res.body.daysRemaining).toBe(12);
  });

  it('derives usage this cycle from the ledger, counting only spends inside the cycle', async () => {
    const { user, password } = await createUser();
    const cycleStartedAt = new Date(Date.now() - 5 * DAY_MS);
    await putOnStarter(user.id, { current: 200, banked: 0, cycleStartedAt });

    await recordSpends(user.id, 3, new Date(Date.now() - 10 * DAY_MS)); // LAST cycle
    await recordSpends(user.id, 8, new Date(Date.now() - 1 * DAY_MS)); // this cycle

    const agent = await loginAgent(user.email, password);
    const res = await agent.get('/api/billing/summary');

    expect(res.body.credits.spentThisCycle).toBe(8);
    expect(res.body.usage.autoRepliesThisCycle).toBe(8);
    // Pool = what's left plus what's gone: 200 + 8.
    expect(res.body.credits.cyclePool).toBe(208);
    expect(res.body.credits.usedPercent).toBe(Math.round((8 / 208) * 100));
  });

  it('reports a used percentage that crosses 80% only when it really has', async () => {
    const { user, password } = await createUser();
    await putOnStarter(user.id, { current: 100, banked: 0 });
    await recordSpends(user.id, 400); // 400 of 500 spent

    const agent = await loginAgent(user.email, password);
    const res = await agent.get('/api/billing/summary');

    expect(res.body.credits.usedPercent).toBe(80);
  });

  it('counts a mid-cycle top-up into the denominator, so a top-up clears the 80% warning', async () => {
    const { user, password } = await createUser();
    // Same 400 spent, but a 500-pack has since landed in replyCreditsCurrent.
    await putOnStarter(user.id, { current: 600, banked: 0 });
    await recordSpends(user.id, 400);

    const agent = await loginAgent(user.email, password);
    const res = await agent.get('/api/billing/summary');

    expect(res.body.credits.cyclePool).toBe(1000);
    expect(res.body.credits.usedPercent).toBe(40);
  });
});

describe('GET /api/billing/summary — renewal preview', () => {
  it('anchors an ACTIVE tenant\'s next expiry on validUntil, not today', async () => {
    const { user, password } = await createUser();
    const entitlement = await putOnStarter(user.id, { daysLeft: 12 });

    const agent = await loginAgent(user.email, password);
    const res = await agent.get('/api/billing/summary');

    expect(res.body.renewal.extendsFromValidUntil).toBe(true);
    expect(new Date(res.body.renewal.anchor).getTime()).toBe(entitlement.validUntil.getTime());

    // 12 days left + a 30-day cycle = 42 days out. Renewing early loses none
    // of the 12.
    const preview = new Date(res.body.renewal.validUntilByPlan.STARTER).getTime();
    expect(preview).toBe(entitlement.validUntil.getTime() + 30 * DAY_MS);
    expect(preview - Date.now()).toBeGreaterThan(41 * DAY_MS);
  });

  it('still anchors on validUntil during GRACE — a grace renewal loses nothing either', async () => {
    const { user, password } = await createUser();
    const validUntil = new Date(Date.now() - 1 * DAY_MS); // expired yesterday
    await prisma.entitlement.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        planCode: 'STARTER',
        status: 'ACTIVE',
        validUntil,
        graceUntil: new Date(validUntil.getTime() + 3 * DAY_MS),
        cycleStartedAt: new Date(Date.now() - 31 * DAY_MS),
      },
      update: {
        planCode: 'STARTER',
        status: 'ACTIVE',
        validUntil,
        graceUntil: new Date(validUntil.getTime() + 3 * DAY_MS),
      },
    });

    const agent = await loginAgent(user.email, password);
    const res = await agent.get('/api/billing/summary');

    expect(res.body.status).toBe('GRACE');
    expect(res.body.graceDaysRemaining).toBe(2);
    expect(res.body.renewal.extendsFromValidUntil).toBe(true);
    expect(new Date(res.body.renewal.anchor).getTime()).toBe(validUntil.getTime());
  });

  it('anchors a fully EXPIRED tenant on today — past grace is a cold start', async () => {
    const { user, password } = await createUser();
    const validUntil = new Date(Date.now() - 10 * DAY_MS);
    await prisma.entitlement.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        planCode: 'STARTER',
        status: 'ACTIVE',
        validUntil,
        graceUntil: new Date(validUntil.getTime() + 3 * DAY_MS),
        cycleStartedAt: new Date(Date.now() - 40 * DAY_MS),
      },
      update: {
        planCode: 'STARTER',
        status: 'ACTIVE',
        validUntil,
        graceUntil: new Date(validUntil.getTime() + 3 * DAY_MS),
      },
    });

    const agent = await loginAgent(user.email, password);
    const res = await agent.get('/api/billing/summary');

    expect(res.body.status).toBe('EXPIRED');
    expect(res.body.renewal.extendsFromValidUntil).toBe(false);
    expect(Math.abs(new Date(res.body.renewal.anchor).getTime() - Date.now())).toBeLessThan(10_000);
  });

  it('derives status lazily — a stored ACTIVE past validUntil still reads GRACE/EXPIRED', async () => {
    const { user, password } = await createUser();
    const validUntil = new Date(Date.now() - 5 * DAY_MS);
    await prisma.entitlement.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        planCode: 'STARTER',
        status: 'ACTIVE', // the sweeper has not run
        validUntil,
        graceUntil: new Date(validUntil.getTime() + 3 * DAY_MS),
        cycleStartedAt: new Date(Date.now() - 35 * DAY_MS),
      },
      update: { status: 'ACTIVE', validUntil, graceUntil: new Date(validUntil.getTime() + 3 * DAY_MS) },
    });

    const agent = await loginAgent(user.email, password);
    const res = await agent.get('/api/billing/summary');

    expect(res.body.status).toBe('EXPIRED');
    expect(res.body.daysRemaining).toBe(0);
  });
});

describe('GET /api/billing/summary — add-on history', () => {
  it('counts only PAID add-on orders, which is what the first-add-on upgrade pitch fires on', async () => {
    const { user, password } = await createUser();
    await putOnStarter(user.id);

    await prisma.order.create({
      data: { cashfreeOrderId: uniq('sfy'), tenantId: user.id, planCode: 'STARTER', amount: 49900, currency: 'INR', status: 'PAID', paidAt: new Date() },
    });
    await prisma.order.create({
      data: { cashfreeOrderId: uniq('sfy'), tenantId: user.id, addonCode: 'reply_credits_500', amount: 24900, currency: 'INR', status: 'CREATED' },
    });

    const agent = await loginAgent(user.email, password);
    let res = await agent.get('/api/billing/summary');
    // An abandoned checkout is not a purchase.
    expect(res.body.paidAddonOrders).toBe(0);

    await prisma.order.create({
      data: { cashfreeOrderId: uniq('sfy'), tenantId: user.id, addonCode: 'reply_credits_500', amount: 24900, currency: 'INR', status: 'PAID', paidAt: new Date() },
    });
    res = await agent.get('/api/billing/summary');
    expect(res.body.paidAddonOrders).toBe(1);
  });
});

describe('GET /api/billing/summary — tenants with nothing yet', () => {
  it('answers cleanly for a tenant with no entitlement row at all', async () => {
    const { user, password } = await createUser({ withTrial: false });
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/api/billing/summary');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NONE');
    expect(res.body.plan).toBeNull();
    expect(res.body.validUntil).toBeNull();
    expect(res.body.credits).toEqual({
      current: 0,
      banked: 0,
      remaining: 0,
      spentThisCycle: 0,
      cyclePool: 0,
      usedPercent: 0,
    });
    expect(res.body.orders).toEqual([]);
    // A cold start, so the preview is anchored on today and still offers a
    // real date to show — the page never has to render "unknown".
    expect(res.body.renewal.extendsFromValidUntil).toBe(false);
    expect(res.body.renewal.validUntilByPlan.STARTER).toBeTruthy();
  });
});

describe('GET /api/billing/summary — trial terms', () => {
  /**
   * The TRIAL catalogue row. Upserted because an earlier file may have cleared
   * the catalogue, and asserted against by READING IT BACK — so these tests pin
   * "the response mirrors the row", not today's particular numbers.
   */
  async function trialPlanRow() {
    return prisma.plan.upsert({
      where: { code: 'TRIAL' },
      update: {},
      create: {
        code: 'TRIAL',
        name: 'Trial',
        igAccountLimit: 1,
        autoReplyCreditsPerCycle: 25,
        autoReplyBankCap: 25,
        classificationCapCycle: 100,
        classificationThrottlePerHour: 100,
        cycleLengthDays: 3,
      },
    });
  }

  const termsOf = (row) => ({
    days: row.cycleLengthDays,
    classificationLimit: row.classificationCapCycle,
    autoReplyCredits: row.autoReplyCreditsPerCycle,
    draftCredits: row.draftCreditsPerCycle,
  });

  it('tells a tenant with no entitlement what connecting would get them', async () => {
    const row = await trialPlanRow();
    const { user, password } = await createUser({ withTrial: false });
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/api/billing/summary');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NONE');
    expect(res.body.trial).toEqual(termsOf(row));
  });

  it('gives a trialing tenant the trial limit next to their own usage', async () => {
    const row = await trialPlanRow();
    const { user, password } = await createUser(); // an ACTIVE trial
    await prisma.entitlement.update({
      where: { userId: user.id },
      data: { classificationCountCycle: 37, replyCreditsCurrent: 20 },
    });
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/api/billing/summary');
    expect(res.body.status).toBe('TRIALING');
    expect(res.body.plan.code).toBe('TRIAL');
    expect(res.body.trial).toEqual(termsOf(row));
    expect(res.body.usage.classificationsThisCycle).toBe(37);
    expect(res.body.credits.remaining).toBe(20);
    expect(res.body.daysRemaining).toBeGreaterThan(0);
  });

  it('drops the trial terms once the trial has lapsed', async () => {
    await trialPlanRow();
    const { user, password } = await createUser();
    await prisma.entitlement.update({
      where: { userId: user.id },
      data: { validUntil: new Date(Date.now() - DAY_MS) },
    });
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/api/billing/summary');
    expect(res.body.status).toBe('EXPIRED');
    expect(res.body.trial).toBeNull();
  });

  it('sends a PAYING tenant no classification limit of any kind', async () => {
    await trialPlanRow();
    const { user, password } = await createUser();
    await putOnStarter(user.id, { classifications: 812 });
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/api/billing/summary');
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.trial).toBeNull();
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('classificationLimit');
    expect(serialized).not.toContain('classificationCapCycle');
    expect(serialized).not.toContain('classificationThrottlePerHour');
  });
});
