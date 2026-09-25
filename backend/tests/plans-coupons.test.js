/**
 * Admin rebuild, Gate 6 — plans (extended billing_plans), terms-bought
 * snapshots, per-customer controls, coupons, payment history.
 *
 * Uses its OWN plan codes: the seeded catalogue is shared by other files and
 * must not be edited here.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAdmin, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const adminRoutes = require('../src/routes/admin.js');
const svc = require('../src/services/entitlementService.js');
const igIdentity = require('../src/lib/igIdentity.js');
const coupons = require('../src/services/coupons.js');

const ORIGIN = 'https://app.test.local';
const DAY = 24 * 60 * 60 * 1000;
const REGION = { billingRegion: 'IN', currency: 'INR', regionSource: 'RAIL_INFERRED' };
let app;
let ipSeq = 0;
const ip = () => `10.120.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(async () => {
  const billingRoutes = (await import('../src/routes/billing.js')).default;
  app = buildTestApp({ admin: adminRoutes, mount: { '/api/billing': billingRoutes } });
});
beforeEach(async () => {
  await resetDb();
  await prisma.couponRedemption.deleteMany({});
  await prisma.coupon.deleteMany({});
  await prisma.planPrice.deleteMany({ where: { plan: { code: { startsWith: 'GATE6_' } } } });
  await prisma.plan.deleteMany({ where: { code: { startsWith: 'GATE6_' } } });
});

async function adminAgent({ stepUp = true } = {}) {
  const { admin, password } = await createAdmin();
  const agent = request.agent(app).set('Origin', ORIGIN).set('X-Forwarded-For', ip());
  expect((await agent.post('/api/admin/login').send({ email: admin.email, password })).status).toBe(200);
  if (stepUp) expect((await agent.post('/api/admin/step-up').send({ password })).status).toBe(200);
  return agent;
}

const ledgerMatchesBalance = async (userId) => {
  const e = await prisma.entitlement.findUnique({ where: { userId } });
  const sum = await prisma.creditLedger.aggregate({ where: { tenantId: userId }, _sum: { delta: true } });
  return (sum._sum.delta || 0) === (e ? e.replyCreditsCurrent + e.replyCreditsBanked : 0);
};

describe('plans', () => {
  it('create needs step-up + reason, starts hidden, validates strictly, and is audited', async () => {
    const noStep = await adminAgent({ stepUp: false });
    expect((await noStep.post('/api/admin/plans').send({ code: 'GATE6_A', name: 'A', reason: 'new tier' })).status).toBe(403);

    const agent = await adminAgent();
    const bad = [
      { code: 'lower', name: 'A', reason: 'r1r' },
      { code: 'GATE6_A', name: 'A', reason: 'r1r', classificationCapCycle: -1 },
      { code: 'GATE6_A', name: 'A', reason: 'r1r', prices: [{ billingRegion: 'IN', currency: 'USD', amount: 100 }] },
      { code: 'GATE6_A', name: 'A', reason: 'r1r', features: { 'Bad Key': true } },
      { code: 'GATE6_A', name: 'A', reason: 'r1r', baseUrl: 'x' },
    ];
    for (const body of bad) expect((await agent.post('/api/admin/plans').send(body)).status, JSON.stringify(body)).toBe(400);

    const res = await agent.post('/api/admin/plans').send({
      code: 'GATE6_A', name: 'Gate Six', reason: 'influencer tier', classificationCapCycle: 500, autoReplyCreditsPerCycle: 50,
      features: { priority_support: true, seats: 2 }, prices: [{ billingRegion: 'IN', amount: 19900 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.isActive, 'new plans start hidden').toBe(false);
    expect(res.body.prices).toEqual([{ billingRegion: 'IN', currency: 'INR', amount: 19900 }]);
    expect(await prisma.adminAuditLog.count({ where: { action: 'PLAN_CREATE', targetId: 'GATE6_A' } })).toBe(1);
  });

  it('an edit applies to NEW purchases only — an existing customer keeps what they bought', async () => {
    const agent = await adminAgent();
    const created = await agent.post('/api/admin/plans').send({ code: 'GATE6_B', name: 'Tier B', reason: 'test tier', classificationCapCycle: 100, autoReplyBankCap: 10, cycleLengthDays: 30 });
    expect(created.status).toBe(201);

    const { user: before } = await createUser({ withTrial: false });
    await svc.grantPlan(before.id, 'GATE6_B', REGION);

    const edit = await agent.put('/api/admin/plans/GATE6_B').send({ classificationCapCycle: 5, reason: 'tighten for new buyers' });
    expect(edit.status).toBe(200);
    const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'PLAN_UPDATE' } });
    expect(audit.before.classificationCapCycle).toBe(100);
    expect(audit.after.classificationCapCycle).toBe(5);

    const { user: after } = await createUser({ withTrial: false });
    await svc.grantPlan(after.id, 'GATE6_B', REGION);

    await prisma.entitlement.updateMany({ where: { userId: { in: [before.id, after.id] } }, data: { classificationCountCycle: 6 } });
    expect(await svc.classificationGateReason(before.id), 'bought at 100').toBe('ok');
    expect(await svc.classificationGateReason(after.id), 'bought at 5').toBe('cycle_cap');
  });

  it('the trial snapshots its terms too', async () => {
    const { user } = await createUser({ withTrial: false });
    const igUserId = uniq('ig');
    await createAccount({ userId: user.id, igUserId });
    await prisma.instagramIdentity.create({ data: { igUserIdHash: igIdentity.hashIgUserId(igUserId), purgeAfter: igIdentity.purgeAfterDate() } });
    const r = await igIdentity.claimTrialForUser({ userId: user.id });
    expect(r.trialGranted).toBe(true);
    const e = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(e.termsSnapshotAt).not.toBeNull();
    expect(e.termClassificationCapCycle).toBe(100);
  });
});

describe('per-customer controls', () => {
  it('grant a plan with a custom expiry: step-up + reason, ledger intact, other tenants untouched', async () => {
    const { user } = await createUser({});
    const { user: other } = await createUser({});
    const otherBefore = await prisma.entitlement.findUnique({ where: { userId: other.id } });
    const noStep = await adminAgent({ stepUp: false });
    const until = new Date(Date.now() + 45 * DAY).toISOString();
    expect((await noStep.post(`/api/admin/users/${user.id}/billing/grant-plan`).send({ planCode: 'STARTER', validUntil: until, reason: 'partner' })).status).toBe(403);

    const agent = await adminAgent();
    expect((await agent.post(`/api/admin/users/${user.id}/billing/grant-plan`).send({ planCode: 'STARTER', validUntil: until })).status).toBe(400);
    expect((await agent.post(`/api/admin/users/${user.id}/billing/grant-plan`).send({ planCode: 'TRIAL', validUntil: until, reason: 'partner' })).status).toBe(400);
    const res = await agent.post(`/api/admin/users/${user.id}/billing/grant-plan`).send({ planCode: 'STARTER', validUntil: until, reason: 'partner deal' });
    expect(res.status).toBe(200);

    const e = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(e).toMatchObject({ planCode: 'STARTER', status: 'ACTIVE' });
    expect(e.validUntil.toISOString()).toBe(until);
    expect(await prisma.creditLedger.count({ where: { tenantId: user.id, source: 'admin_grant:starter' } })).toBe(1);
    expect(await ledgerMatchesBalance(user.id)).toBe(true);
    expect(await prisma.adminAuditLog.count({ where: { action: 'PLAN_GRANT_MANUAL', targetId: user.id, reason: 'partner deal' } })).toBe(1);
    expect(await prisma.entitlement.findUnique({ where: { userId: other.id } })).toEqual(otherBefore);
  });

  it('extend expiry, and bonus quota for this cycle only', async () => {
    const { user } = await createUser({});
    const before = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    const agent = await adminAgent();

    expect((await agent.post(`/api/admin/users/${user.id}/billing/extend`).send({ days: 0, reason: 'goodwill' })).status).toBe(400);
    expect((await agent.post(`/api/admin/users/${user.id}/billing/extend`).send({ days: 10, reason: 'goodwill' })).status).toBe(200);
    const extended = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(extended.validUntil.getTime() - before.validUntil.getTime()).toBe(10 * DAY);

    await prisma.entitlement.update({ where: { userId: user.id }, data: { classificationCountCycle: 100 } });
    expect(await svc.classificationGateReason(user.id)).toBe('cycle_cap');
    expect((await agent.post(`/api/admin/users/${user.id}/billing/bonus-quota`).send({ amount: 50, reason: 'launch week' })).status).toBe(200);
    expect(await svc.classificationGateReason(user.id)).toBe('ok');
    await svc.rollCycle(user.id);
    expect((await prisma.entitlement.findUnique({ where: { userId: user.id } })).bonusClassificationsCycle, 'reset at the cycle roll').toBe(0);
  });

  it('reset trial lets the customer claim again; refused on a live paid plan', async () => {
    const { user } = await createUser({ withTrial: false });
    const igUserId = uniq('ig');
    await createAccount({ userId: user.id, igUserId });
    await prisma.instagramIdentity.create({ data: { igUserIdHash: igIdentity.hashIgUserId(igUserId), purgeAfter: igIdentity.purgeAfterDate() } });
    expect((await igIdentity.claimTrialForUser({ userId: user.id })).trialGranted).toBe(true);
    expect((await igIdentity.claimTrialForUser({ userId: user.id })).trialGranted).toBe(false);

    const agent = await adminAgent();
    expect((await agent.post(`/api/admin/users/${user.id}/billing/reset-trial`).send({ reason: 'support case 12' })).status).toBe(200);
    expect(await ledgerMatchesBalance(user.id)).toBe(true);
    expect((await igIdentity.claimTrialForUser({ userId: user.id })).trialGranted, 'claimable again').toBe(true);

    const { user: paid } = await createUser({ withTrial: false });
    await svc.grantPlan(paid.id, 'STARTER', REGION);
    const refused = await agent.post(`/api/admin/users/${paid.id}/billing/reset-trial`).send({ reason: 'mistake' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PAID_PLAN');
  });
});

describe('coupons', () => {
  async function makeCoupon(agent, body) {
    const res = await agent.post('/api/admin/coupons').send({ discountType: 'PERCENT', value: 20, reason: 'influencer launch', ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }

  it('admin CRUD: normalised codes, strict validation, audited, never deleted', async () => {
    const agent = await adminAgent();
    const c = await makeCoupon(agent, { code: 'priya20', influencerTag: 'priya' });
    expect(c.code).toBe('PRIYA20');
    expect((await agent.post('/api/admin/coupons').send({ code: 'PRIYA20', discountType: 'PERCENT', value: 20, reason: 'dup' })).status).toBe(409);
    expect((await agent.post('/api/admin/coupons').send({ code: 'X1Y', discountType: 'PERCENT', value: 120, reason: 'bad' })).status).toBe(400);
    expect((await agent.post('/api/admin/coupons').send({ code: 'X1Y', discountType: 'FLAT', value: 500, reason: 'bad' })).status, 'flat needs a currency').toBe(400);

    const off = await agent.put(`/api/admin/coupons/${c.id}`).send({ isActive: false, reason: 'campaign over' });
    expect(off.status).toBe(200);
    expect(await coupons.findRedeemable('priya20')).toBeNull();
    expect(await prisma.adminAuditLog.count({ where: { action: { in: ['COUPON_CREATE', 'COUPON_UPDATE'] } } })).toBe(2);
  });

  it('redeemed at signup; an invalid code blocks signup before any account exists', async () => {
    const agent = await adminAgent();
    await makeCoupon(agent, { code: 'LAUNCH10' });
    const email = `${uniq('signup')}@test.codeback`;
    const body = { name: 'New Person', email, password: 'a-good-password', confirmPassword: 'a-good-password' };

    const bad = await request(app).post('/auth/register').set('X-Forwarded-For', ip()).send({ ...body, couponCode: 'NOPE99' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('COUPON_INVALID');
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    const ok = await request(app).post('/auth/register').set('X-Forwarded-For', ip()).send({ ...body, couponCode: 'launch10' });
    expect(ok.status).toBe(201);
    expect(ok.body.couponApplied).toBe(true);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(await prisma.couponRedemption.findUnique({ where: { userId: user.id } })).toMatchObject({ context: 'signup' });
    expect((await prisma.coupon.findUnique({ where: { code: 'LAUNCH10' } })).usedCount).toBe(1);
  });

  it('the last use cannot be taken twice, and a customer redeems only once', async () => {
    const agent = await adminAgent();
    await makeCoupon(agent, { code: 'ONEONLY', maxUses: 1 });
    await makeCoupon(agent, { code: 'SECOND' });
    const a = (await createUser({})).user;
    const b = (await createUser({})).user;

    const results = await Promise.allSettled([coupons.redeemCoupon('ONEONLY', a.id, 'signup'), coupons.redeemCoupon('ONEONLY', b.id, 'signup')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await prisma.coupon.findUnique({ where: { code: 'ONEONLY' } })).usedCount).toBe(1);

    const winner = results[0].status === 'fulfilled' ? a : b;
    await expect(coupons.redeemCoupon('SECOND', winner.id, 'trial_claim')).rejects.toMatchObject({ code: 'ALREADY_REDEEMED' });
    expect((await prisma.coupon.findUnique({ where: { code: 'SECOND' } })).usedCount, 'rolled back').toBe(0);
  });

  it('an expired code is refused', async () => {
    const agent = await adminAgent();
    await makeCoupon(agent, { code: 'OLDCODE', expiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(coupons.redeemCoupon('OLDCODE', (await createUser({})).user.id, 'signup')).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('influencer report: signups and paid conversions per tag', async () => {
    const agent = await adminAgent();
    await makeCoupon(agent, { code: 'PRIYA', influencerTag: 'priya' });
    const u1 = (await createUser({})).user;
    const u2 = (await createUser({})).user;
    await coupons.redeemCoupon('PRIYA', u1.id, 'signup');
    await coupons.redeemCoupon('PRIYA', u2.id, 'signup');
    await prisma.order.create({ data: { cashfreeOrderId: uniq('sfy'), tenantId: u1.id, planCode: 'STARTER', amount: 49900, currency: 'INR', status: 'PAID', paidAt: new Date() } });

    const res = await agent.get('/api/admin/coupons/report');
    expect(res.status).toBe(200);
    expect(res.body.find((r) => r.influencerTag === 'priya')).toMatchObject({ signups: 2, paidConversions: 1, conversionRate: 0.5 });
  });
});

describe('payment history', () => {
  it('lists orders with attempts and refunds, never raw payloads', async () => {
    const { user } = await createUser({});
    const id = uniq('sfy');
    await prisma.order.create({ data: { cashfreeOrderId: id, tenantId: user.id, planCode: 'STARTER', amount: 49900, currency: 'INR', status: 'PAID', paidAt: new Date(), rawPayload: '{"card":"secret-raw"}' } });
    await prisma.paymentAttempt.create({ data: { cashfreeOrderId: id, cfPaymentId: 'p1', status: 'SUCCESS', eventType: 'PAYMENT_SUCCESS_WEBHOOK', rawPayload: '{"secret-raw":1}' } });
    const agent = await adminAgent({ stepUp: false });
    const res = await agent.get(`/api/admin/payments?userId=${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0]).toMatchObject({ cashfreeOrderId: id, customerEmail: user.email, status: 'PAID' });
    expect(res.body.payments[0].attempts).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('secret-raw');
  });
});
