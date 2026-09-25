/**
 * Gate 2 — the entitlement service.
 *
 * These exercise the five behaviors called out in the feat/billing brief:
 * bank cap enforcement, FIFO spend ordering, early renewal extending from
 * validUntil (not today), grace-window credit preservation, and hourly
 * throttle reset. Plan/PlanPrice/AddonPack rows used here are test-scoped
 * fixtures, independent of the real catalogue seeded by the
 * seed_billing_catalogue migration — a test changing a real plan's numbers
 * would be a footgun for every other test that reads the same row.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';

import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const entitlementService = require('../src/services/entitlementService.js');

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A Plan row scoped to one test, so nothing here touches the real catalogue. */
async function createPlan(overrides = {}) {
  return prisma.plan.create({
    data: {
      code: uniq('PLAN').toUpperCase(),
      name: 'Test Plan',
      igAccountLimit: 1,
      autoReplyCreditsPerCycle: 500,
      autoReplyBankCap: 500,
      classificationCapCycle: 100,
      classificationThrottlePerHour: 10,
      cycleLengthDays: 30,
      ...overrides,
    },
  });
}

async function createEntitlement(userId, overrides = {}) {
  return prisma.entitlement.create({
    data: {
      userId,
      planCode: null,
      status: 'NONE',
      replyCreditsCurrent: 0,
      replyCreditsBanked: 0,
      classificationCountCycle: 0,
      classificationCountHour: 0,
      ...overrides,
    },
  });
}

describe('entitlementService — bank cap enforcement', () => {
  it('caps the rolled-over pool at the plan bank cap and discards the rest', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ autoReplyBankCap: 500, autoReplyCreditsPerCycle: 500 });
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      replyCreditsBanked: 300,
      replyCreditsCurrent: 400, // pool = 700, over the 500 cap
    });

    const updated = await entitlementService.rollCycle(user.id);

    expect(updated.replyCreditsBanked).toBe(500);
    expect(updated.replyCreditsCurrent).toBe(0);

    const ledger = await prisma.creditLedger.findMany({ where: { tenantId: user.id, pool: 'REPLY' }, orderBy: { createdAt: 'desc' } });
    expect(ledger[0].type).toBe('EXPIRE');
    expect(ledger[0].delta).toBe(-200); // 700 - 500 discarded
    expect(ledger[0].balanceAfter).toBe(500);
  });

  it('records ROLLOVER, not EXPIRE, when nothing is discarded', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ autoReplyBankCap: 500 });
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      replyCreditsBanked: 100,
      replyCreditsCurrent: 50, // pool = 150, well under the cap
    });

    await entitlementService.rollCycle(user.id);

    const ledger = await prisma.creditLedger.findMany({ where: { tenantId: user.id, pool: 'REPLY' } });
    expect(ledger[0].type).toBe('ROLLOVER');
    expect(ledger[0].delta).toBe(0);
  });
});

describe('entitlementService — FIFO spend ordering', () => {
  it('drains banked (older) credits before current (newer) ones', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan();
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      replyCreditsBanked: 1,
      replyCreditsCurrent: 5,
    });

    const first = await entitlementService.spendReplyCredit(user.id);
    expect(first.ok).toBe(true);

    let entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.replyCreditsBanked, 'the single banked credit is spent first').toBe(0);
    expect(entitlement.replyCreditsCurrent, 'current is untouched while banked still has a credit').toBe(5);

    const second = await entitlementService.spendReplyCredit(user.id);
    expect(second.ok).toBe(true);
    entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.replyCreditsBanked).toBe(0);
    expect(entitlement.replyCreditsCurrent, 'only now does current start draining').toBe(4);
  });

  it('refuses to spend below zero and writes no ledger row for the refusal', async () => {
    const { user } = await createUser({ withTrial: false });
    await createEntitlement(user.id, { status: 'ACTIVE', replyCreditsBanked: 0, replyCreditsCurrent: 0 });

    const result = await entitlementService.spendReplyCredit(user.id);
    expect(result.ok).toBe(false);
    expect(await prisma.creditLedger.count({ where: { tenantId: user.id } })).toBe(0);
  });

  it('every successful spend writes exactly one append-only SPEND row', async () => {
    const { user } = await createUser({ withTrial: false });
    await createEntitlement(user.id, { status: 'ACTIVE', replyCreditsCurrent: 2 });

    await entitlementService.spendReplyCredit(user.id);
    await entitlementService.spendReplyCredit(user.id);

    const ledger = await prisma.creditLedger.findMany({ where: { tenantId: user.id } });
    expect(ledger).toHaveLength(2);
    expect(ledger.every((row) => row.type === 'SPEND' && row.delta === -1)).toBe(true);
  });
});

describe('entitlementService — early renewal extends from validUntil, never from today', () => {
  it('a renewal while still ACTIVE anchors the new cycle on the OLD validUntil', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ code: 'STARTER_TEST', cycleLengthDays: 30 });
    const oldValidUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // renewing 10 days early
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: oldValidUntil,
      billingRegion: 'IN',
      currency: 'INR',
    });

    const updated = await entitlementService.grantPlan(user.id, plan.code, { billingRegion: 'IN', currency: 'INR' });

    const expected = new Date(oldValidUntil.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(updated.validUntil.getTime(), 'must extend from the OLD validUntil, not from now').toBe(expected.getTime());
  });

  it('a cold start (no existing entitlement) anchors the cycle on now', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ code: 'PRO_TEST', cycleLengthDays: 30 });

    const before = Date.now();
    const updated = await entitlementService.grantPlan(user.id, plan.code, { billingRegion: 'IN', currency: 'INR' });
    const after = Date.now();

    const days = (updated.validUntil.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(updated.cycleStartedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(updated.cycleStartedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('never overwrites an already-locked region on renewal', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ code: 'LOCKED_TEST' });
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      billingRegion: 'IN',
      currency: 'INR',
    });

    // A VPN making a renewal look like a US payment must not move the lock.
    const updated = await entitlementService.grantPlan(user.id, plan.code, { billingRegion: 'INTL', currency: 'USD' });

    expect(updated.billingRegion).toBe('IN');
    expect(updated.currency).toBe('INR');
  });
});

describe('entitlementService — grace-window renewal preserves the credit bank', () => {
  it('renewing during GRACE keeps the bank and extends from the ORIGINAL validUntil', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ code: 'GRACE_TEST', autoReplyBankCap: 1000, cycleLengthDays: 30 });
    const originalValidUntil = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // expired yesterday
    const graceUntil = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // still 2 days of grace left
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE', // stored status is stale — effectiveStatus must derive GRACE from the dates
      validUntil: originalValidUntil,
      graceUntil,
      replyCreditsBanked: 150,
      replyCreditsCurrent: 50,
      billingRegion: 'IN',
      currency: 'INR',
    });

    expect(
      (await entitlementService.getEntitlement(user.id)).effectiveStatus,
      'must be derived as GRACE even though the stored column still says ACTIVE'
    ).toBe('GRACE');

    const updated = await entitlementService.grantPlan(user.id, plan.code, { billingRegion: 'IN', currency: 'INR' });

    expect(
      updated.replyCreditsBanked,
      'the 200-credit pool from before renewal must be preserved into the bank, not zeroed'
    ).toBe(200);
    expect(updated.validUntil.getTime()).toBe(originalValidUntil.getTime() + 30 * 24 * 60 * 60 * 1000);
  });

  it('classification still works during GRACE; auto-reply does not', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ code: 'GRACE_AI_TEST', classificationCapCycle: 100, classificationThrottlePerHour: 100 });
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() - 1000),
      graceUntil: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      replyCreditsCurrent: 100,
    });

    expect(await entitlementService.canClassify(user.id), 'classification continues into grace').toBe(true);
    expect(await entitlementService.canAutoReply(user.id), 'auto-reply stops at validUntil, not at the end of grace').toBe(false);
  });

  it('renewing AFTER grace has fully lapsed forfeits the old bank (cold start)', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ code: 'POST_GRACE_TEST', autoReplyBankCap: 1000 });
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      graceUntil: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // grace ended 7 days ago
      replyCreditsBanked: 400,
      replyCreditsCurrent: 100,
    });

    const before = Date.now();
    const updated = await entitlementService.grantPlan(user.id, plan.code, { billingRegion: 'IN', currency: 'INR' });

    expect(updated.replyCreditsBanked, 'fully expired — the old bank is forfeit, not carried forward').toBe(0);
    expect(updated.cycleStartedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('entitlementService — hourly throttle reset', () => {
  it('blocks classification once the hourly cap is hit within the window', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ classificationThrottlePerHour: 2, classificationCapCycle: 1000 });
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      hourWindowStartedAt: new Date(),
      classificationCountHour: 0,
    });

    expect(await entitlementService.canClassify(user.id)).toBe(true);
    await entitlementService.recordClassification(user.id, uniq('msg'));
    expect(await entitlementService.canClassify(user.id)).toBe(true);
    await entitlementService.recordClassification(user.id, uniq('msg'));

    expect(await entitlementService.canClassify(user.id), 'the 2/hr cap has now been hit').toBe(false);
  });

  it('a window older than an hour resets the count, even before any sweep runs', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ classificationThrottlePerHour: 2, classificationCapCycle: 1000 });
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      hourWindowStartedAt: new Date(Date.now() - 61 * 60 * 1000), // 61 minutes ago — stale window
      classificationCountHour: 2, // already at the cap, but in the OLD window
    });

    expect(
      await entitlementService.canClassify(user.id),
      'a stale window must not carry its count into the new one'
    ).toBe(true);

    await entitlementService.recordClassification(user.id, uniq('msg'));
    const after = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(after.classificationCountHour, 'recording after a stale window starts a fresh count of 1').toBe(1);
    expect(after.hourWindowStartedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('the cycle cap (never rolls over) is independent of the hourly window', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ classificationCapCycle: 1, classificationThrottlePerHour: 1000 });
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });

    expect(await entitlementService.canClassify(user.id)).toBe(true);
    await entitlementService.recordClassification(user.id, uniq('msg'));
    expect(await entitlementService.canClassify(user.id), 'the 1/cycle cap is now spent').toBe(false);
  });

  it('the SAME messageId recorded three times counts exactly once — retries and provider failover are structurally one classification', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ classificationCapCycle: 1000, classificationThrottlePerHour: 1000 });
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });

    const messageId = uniq('msg-retry');
    await entitlementService.recordClassification(user.id, messageId);
    await entitlementService.recordClassification(user.id, messageId); // e.g. a retried Gemini call
    await entitlementService.recordClassification(user.id, messageId); // e.g. xAI/OpenAI failover on the same message

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.classificationCountCycle, 'three attempts at the same message must count as one').toBe(1);
    expect(entitlement.classificationCountHour).toBe(1);

    const ledger = await prisma.creditLedger.findMany({ where: { tenantId: user.id, type: 'CLASSIFY' } });
    expect(ledger, 'only one CLASSIFY row for this messageId, not three').toHaveLength(1);
    expect(ledger[0].messageId).toBe(messageId);
    expect(ledger[0].delta, 'a classification is not a credit movement').toBe(0);
  });

  it('DIFFERENT messages for the same tenant each count separately', async () => {
    const { user } = await createUser({ withTrial: false });
    const plan = await createPlan({ classificationCapCycle: 1000, classificationThrottlePerHour: 1000 });
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    });

    await entitlementService.recordClassification(user.id, uniq('msg-a'));
    await entitlementService.recordClassification(user.id, uniq('msg-b'));
    await entitlementService.recordClassification(user.id, uniq('msg-c'));

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement.classificationCountCycle).toBe(3);
  });
});

describe('entitlementService — status gating', () => {
  it('NONE and EXPIRED block both classification and auto-reply', async () => {
    const { user } = await createUser({ withTrial: false });
    expect(await entitlementService.canClassify(user.id), 'no entitlement row at all').toBe(false);
    expect(await entitlementService.canAutoReply(user.id)).toBe(false);

    const plan = await createPlan();
    await createEntitlement(user.id, {
      planCode: plan.code,
      status: 'ACTIVE',
      validUntil: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      graceUntil: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      replyCreditsCurrent: 999,
    });
    expect(await entitlementService.canClassify(user.id), 'long past grace').toBe(false);
    expect(await entitlementService.canAutoReply(user.id)).toBe(false);
  });
});

describe('entitlementService — grantAddon', () => {
  it('a consumable pack credits replyCreditsCurrent and writes a GRANT ledger row', async () => {
    const { user } = await createUser({ withTrial: false });
    await createEntitlement(user.id, { status: 'ACTIVE', replyCreditsCurrent: 10 });
    await prisma.addonPack.create({ data: { code: 'test_pack_500', creditAmount: 500 } });

    const updated = await entitlementService.grantAddon(user.id, 'test_pack_500');
    expect(updated.replyCreditsCurrent).toBe(510);

    const ledger = await prisma.creditLedger.findFirst({ where: { tenantId: user.id } });
    expect(ledger.type).toBe('GRANT');
    expect(ledger.delta).toBe(500);
    expect(ledger.source).toBe('addon:test_pack_500');
  });

  it('the recurring add-on increments extraIgAccounts with no ledger entry', async () => {
    const { user } = await createUser({ withTrial: false });
    await createEntitlement(user.id, { status: 'ACTIVE', extraIgAccounts: 0 });

    const updated = await entitlementService.grantAddon(user.id, 'extra_ig_account');
    expect(updated.extraIgAccounts).toBe(1);
    expect(await prisma.creditLedger.count({ where: { tenantId: user.id } })).toBe(0);
  });
});
