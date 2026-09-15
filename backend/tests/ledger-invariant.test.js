/**
 * The ledger invariant: no operation may change credits without writing a
 * ledger row.
 *
 * For every tenant, the sum of CreditLedger deltas must equal
 * replyCreditsCurrent + replyCreditsBanked — after every grantPlan,
 * grantAddon, spendReplyCredit and rollCycle, and after the trial grant.
 * Anything discarded is an EXPIRE row whose `source` names the reason.
 *
 * WHY: on a same-tenant Pro -> pack -> Starter sequence, grantPlan capped the
 * carried bank at the OLD plan's cap and dropped 517 credits with no ledger
 * row at all. The ledger is the record a disputed balance is checked against;
 * once it stops adding up, it can no longer answer that question. The trial
 * grant had the same hole — 25 credits with no GRANT row.
 *
 * billing:doctor runs the same sum against the live database.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const svc = require('../src/services/entitlementService.js');
const igIdentity = require('../src/lib/igIdentity.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const REGION = { billingRegion: 'IN', currency: 'INR', regionSource: 'RAIL_INFERRED' };

/** The real catalogue shape, pinned so the arithmetic below is deterministic. */
async function catalogue() {
  const plans = {
    TRIAL: ['Trial', 1, 25, 25, 100, 100, 3],
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

async function ledgerSum(tenantId) {
  const r = await prisma.creditLedger.aggregate({ where: { tenantId }, _sum: { delta: true } });
  return r._sum.delta ?? 0;
}

/** THE invariant. Returns the entitlement for follow-on assertions. */
async function expectBalanced(tenantId, after) {
  const e = await prisma.entitlement.findUnique({ where: { userId: tenantId } });
  const balance = e ? e.replyCreditsCurrent + e.replyCreditsBanked : 0;
  expect(await ledgerSum(tenantId), `ledger sum must equal the held balance after: ${after}`).toBe(balance);
  return e;
}

const expireRows = (tenantId) =>
  prisma.creditLedger.findMany({ where: { tenantId, type: 'EXPIRE' }, orderBy: { createdAt: 'asc' } });

beforeEach(async () => {
  await resetDb();
  await catalogue();
});

describe('ledger invariant — the exact Pro -> pack -> Starter sequence that lost 517 credits', () => {
  it('stays balanced at every step, and records the discard as an EXPIRE row with a reason', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const t = user.id;

    const claim = await igIdentity.claimInstagramIdentity({ userId: t, igUserId: uniq('ig-seq'), emailVerified: true });
    expect(claim.trialOutcome).toBe('TRIAL_GRANTED');
    let e = await expectBalanced(t, 'trial grant');
    expect(e.replyCreditsCurrent).toBe(25);
    const trialGrant = await prisma.creditLedger.findFirst({ where: { tenantId: t, type: 'GRANT', source: 'trial_grant' } });
    expect(trialGrant?.delta, 'the trial grant is a ledger row now').toBe(25);

    await svc.grantPlan(t, 'PRO', REGION);
    e = await expectBalanced(t, 'grantPlan PRO');
    expect([e.replyCreditsCurrent, e.replyCreditsBanked]).toEqual([2000, 25]);

    for (let i = 1; i <= 8; i++) {
      await svc.spendReplyCredit(t);
      await expectBalanced(t, `spendReplyCredit #${i}`);
    }

    await svc.grantAddon(t, 'reply_credits_500');
    e = await expectBalanced(t, 'grantAddon reply_credits_500');
    expect(e.replyCreditsCurrent + e.replyCreditsBanked).toBe(2517);

    // Called directly, as the old bug was: checkout now refuses this while Pro
    // is ACTIVE, but grantPlan must still never lose credits without a record.
    await svc.grantPlan(t, 'STARTER', REGION);
    e = await expectBalanced(t, 'grantPlan STARTER on the same tenant');
    // Where two caps could apply, the customer's side wins: carried balance
    // capped at Pro's 2,000 (not Starter's 500), then Starter's grant on top.
    expect([e.replyCreditsCurrent, e.replyCreditsBanked], 'carried at the larger cap, plus the new grant').toEqual([500, 2000]);

    const expired = await expireRows(t);
    expect(expired).toHaveLength(1);
    expect(expired[0].delta, 'the 517 that used to vanish, now recorded').toBe(-517);
    expect(expired[0].source).toBe('expire:plan_change_bank_cap');
    expect(expired[0].balanceAfter).toBe(2000);

    // The next cycle roll caps the over-sized bank to Starter in the normal way
    // — and records that too.
    await svc.rollCycle(t);
    e = await expectBalanced(t, 'rollCycle');
    expect([e.replyCreditsCurrent, e.replyCreditsBanked]).toEqual([0, 500]);
    const rolled = (await expireRows(t)).find((r) => r.source === 'expire:cycle_bank_cap');
    expect(rolled?.delta).toBe(-2000);
  });
});

describe('ledger invariant — every credit-changing path', () => {
  it('same-plan renewal over the bank cap: stacks from validUntil, EXPIRE row for the excess', async () => {
    const { user } = await createUser({ withTrial: false });
    const t = user.id;
    const first = await svc.grantPlan(t, 'STARTER', REGION);
    await svc.grantAddon(t, 'reply_credits_500');
    await svc.grantAddon(t, 'reply_credits_500');
    await expectBalanced(t, 'two packs');

    const renewed = await svc.grantPlan(t, 'STARTER', REGION);
    await expectBalanced(t, 'same-plan renewal');
    expect(renewed.validUntil.getTime(), 'renewal stacks from the existing validUntil').toBe(first.validUntil.getTime() + 30 * DAY_MS);
    expect([renewed.replyCreditsCurrent, renewed.replyCreditsBanked]).toEqual([500, 500]);
    const [expired] = await expireRows(t);
    expect([expired.delta, expired.source]).toEqual([-1000, 'expire:renewal_bank_cap']);
  });

  it('upgrade under the new cap: validity stacks, credits sum, nothing discarded', async () => {
    const { user } = await createUser({ withTrial: false });
    const t = user.id;
    const starter = await svc.grantPlan(t, 'STARTER', REGION);

    const pro = await svc.grantPlan(t, 'PRO', REGION);
    await expectBalanced(t, 'upgrade Starter -> Pro');
    expect(pro.planCode).toBe('PRO');
    expect(pro.validUntil.getTime()).toBe(starter.validUntil.getTime() + 30 * DAY_MS);
    expect([pro.replyCreditsCurrent, pro.replyCreditsBanked]).toEqual([2000, 500]);
    expect(await expireRows(t)).toHaveLength(0);
  });

  it('upgrade over the new cap: carried balance capped at the NEW plan cap, EXPIRE row for the rest', async () => {
    const { user } = await createUser({ withTrial: false });
    const t = user.id;
    await svc.grantPlan(t, 'STARTER', REGION);
    for (let i = 0; i < 4; i++) await svc.grantAddon(t, 'reply_credits_500'); // 2500 held
    await expectBalanced(t, 'four packs');

    const pro = await svc.grantPlan(t, 'PRO', REGION);
    await expectBalanced(t, 'upgrade over cap');
    expect([pro.replyCreditsCurrent, pro.replyCreditsBanked]).toEqual([2000, 2000]);
    const [expired] = await expireRows(t);
    expect([expired.delta, expired.source]).toEqual([-500, 'expire:plan_change_bank_cap']);
  });

  it('cold start after full expiry: the leftover is forfeit AND recorded', async () => {
    const { user } = await createUser({ withTrial: false });
    const t = user.id;
    await svc.grantPlan(t, 'STARTER', REGION);
    // Past validUntil and past grace. Dates are not credits — no ledger row due.
    await prisma.entitlement.update({
      where: { userId: t },
      data: { validUntil: new Date(Date.now() - 10 * DAY_MS), graceUntil: new Date(Date.now() - 7 * DAY_MS) },
    });

    const fresh = await svc.grantPlan(t, 'STARTER', REGION);
    await expectBalanced(t, 'cold-start grant');
    expect(fresh.validUntil.getTime()).toBeGreaterThan(Date.now() + 29 * DAY_MS);
    expect([fresh.replyCreditsCurrent, fresh.replyCreditsBanked]).toEqual([500, 0]);
    const [expired] = await expireRows(t);
    expect([expired.delta, expired.source]).toEqual([-500, 'expire:cold_start_forfeit']);
  });

  it('rollCycle over the cap writes an EXPIRE row that names its reason', async () => {
    const { user } = await createUser({ withTrial: false });
    const t = user.id;
    await svc.grantPlan(t, 'STARTER', REGION);
    await svc.grantAddon(t, 'reply_credits_500');

    await svc.rollCycle(t);
    const e = await expectBalanced(t, 'rollCycle over cap');
    expect([e.replyCreditsCurrent, e.replyCreditsBanked]).toEqual([0, 500]);
    const [expired] = await expireRows(t);
    expect([expired.delta, expired.source]).toEqual([-500, 'expire:cycle_bank_cap']);
  });

  it('the extra-account add-on changes no credits and writes no credit row', async () => {
    const { user } = await createUser({ withTrial: false });
    const t = user.id;
    await svc.grantPlan(t, 'STARTER', REGION);
    const before = await prisma.creditLedger.count({ where: { tenantId: t } });
    await svc.grantAddon(t, 'extra_ig_account');
    await expectBalanced(t, 'extra_ig_account');
    expect(await prisma.creditLedger.count({ where: { tenantId: t } })).toBe(before);
  });

  it('holds over a long mixed sequence of every operation', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const t = user.id;
    await igIdentity.claimInstagramIdentity({ userId: t, igUserId: uniq('ig-mix'), emailVerified: true });
    await expectBalanced(t, 'trial');

    // Deterministic pseudo-random walk (LCG) so a failure is reproducible.
    let seed = 20260915;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ops = [
      ['grantPlan STARTER', () => svc.grantPlan(t, 'STARTER', REGION)],
      ['grantPlan PRO', () => svc.grantPlan(t, 'PRO', REGION)],
      ['grantAddon pack', () => svc.grantAddon(t, 'reply_credits_500')],
      ['spend', () => svc.spendReplyCredit(t)],
      ['spend', () => svc.spendReplyCredit(t)],
      ['rollCycle', () => svc.rollCycle(t)],
    ];
    for (let step = 1; step <= 60; step++) {
      const [label, run] = ops[Math.floor(next() * ops.length)];
      await run();
      await expectBalanced(t, `step ${step}: ${label}`);
    }
  });
});

describe('ledger invariant — refund revocation', () => {
  const { fulfillPaidOrder } = require('../src/services/billingFulfillment.js');
  const { applyRefundStatus } = require('../src/services/refundService.js');

  let paymentSeq = 900000;
  async function paid(tenantId, { planCode = null, addonCode = null, amount = 49900 } = {}) {
    const order = await prisma.order.create({
      data: { cashfreeOrderId: `sfy_${uniq('inv')}`, tenantId, planCode, addonCode, amount, currency: 'INR' },
    });
    await fulfillPaidOrder({ cashfreeOrderId: order.cashfreeOrderId, payment: { cf_payment_id: paymentSeq++, payment_group: 'upi' }, rawPayload: '{}' });
    return order;
  }
  const refundInFull = (order, refundId) =>
    applyRefundStatus({ refundId, cashfreeOrderId: order.cashfreeOrderId, status: 'SUCCESS', refundAmount: order.amount / 100, source: 'test' });

  it('stays balanced through purchases, spends, a pack refund with a shortfall, a partial refund, and a plan refund', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const t = user.id;
    await igIdentity.claimInstagramIdentity({ userId: t, igUserId: uniq('ig-refund'), emailVerified: true });
    await expectBalanced(t, 'trial');

    const starter = await paid(t, { planCode: 'STARTER' });
    await expectBalanced(t, 'fulfil STARTER');
    const pack = await paid(t, { addonCode: 'reply_credits_500', amount: 19900 });
    await expectBalanced(t, 'fulfil pack');

    for (let i = 1; i <= 30; i++) await svc.spendReplyCredit(t);
    await expectBalanced(t, '30 spends');

    await refundInFull(pack, 'inv_pack');
    let e = await expectBalanced(t, 'refund pack');
    const packExpire = (await expireRows(t)).find((r) => r.source === 'expire:refund');
    expect(packExpire.delta).toBe(-500);

    const pro = await paid(t, { planCode: 'PRO', amount: 149900 });
    await expectBalanced(t, 'fulfil PRO');
    await applyRefundStatus({ refundId: 'inv_partial', cashfreeOrderId: pro.cashfreeOrderId, status: 'SUCCESS', refundAmount: 100, source: 'test' });
    await expectBalanced(t, 'partial refund of PRO (revokes nothing)');

    for (let i = 1; i <= 5; i++) await svc.spendReplyCredit(t);
    await refundInFull(starter, 'inv_starter');
    e = await expectBalanced(t, 'refund STARTER under the stacked PRO');
    expect(e.planCode).toBe('PRO');

    await svc.rollCycle(t);
    e = await expectBalanced(t, 'rollCycle after refunds');
    expect(e.replyCreditsCurrent + e.replyCreditsBanked).toBeGreaterThanOrEqual(0);
  });

  it('a refund whose credits were all spent writes a zero-delta EXPIRE row with the shortfall, and never goes negative', async () => {
    const { user } = await createUser({ withTrial: false });
    const t = user.id;
    const pack0 = await paid(t, { planCode: 'STARTER' });
    await prisma.entitlement.update({ where: { userId: t }, data: { replyCreditsCurrent: 0 } });
    await prisma.creditLedger.create({ data: { tenantId: t, delta: -500, type: 'SPEND', source: 'auto_reply_spend', balanceAfter: 0 } });
    await expectBalanced(t, 'all spent');

    await refundInFull(pack0, 'inv_all_spent');

    const e = await expectBalanced(t, 'refund with nothing left');
    expect(e.replyCreditsCurrent + e.replyCreditsBanked).toBe(0);
    const row = (await expireRows(t)).find((r) => r.source === 'expire:refund');
    expect(row.delta).toBe(0);
    expect(row.note).toMatch(/removed 0, shortfall 500/);
  });
});
