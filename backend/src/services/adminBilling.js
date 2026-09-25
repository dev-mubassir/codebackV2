/**
 * Manual, per-customer plan controls for the admin panel (Gate 6). Every one
 * is called from a route that already demanded step-up and a written reason,
 * and writes an audit row; this module does the entitlement work only.
 *
 * All four keep the credit ledger honest (tests/ledger-invariant.test.js and
 * billing:doctor check "ledger sum === held balance"): only grantPlan and
 * resetTrial move credits, and both write ledger rows for it.
 *
 * Throws AdminBillingError(status, code, message) for a refusal the route
 * should pass straight to the admin.
 */

const prisma = require('../lib/prisma');
const { grantPlan, effectiveStatus, termsFrom } = require('./entitlementService');
const { hashIgUserId } = require('../lib/igIdentity');

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 3 * DAY_MS;
const PAID_GRANTABLE = ['STARTER', 'PRO', 'ENTERPRISE'];

class AdminBillingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const snapshot = (e) =>
  e
    ? {
        planCode: e.planCode,
        status: effectiveStatus(e),
        validUntil: e.validUntil,
        graceUntil: e.graceUntil,
        credits: e.replyCreditsCurrent + e.replyCreditsBanked,
        bonusClassificationsCycle: e.bonusClassificationsCycle,
      }
    : null;

/**
 * Grant a paid plan with a custom expiry — no payment, no order. Goes through
 * grantPlan (credits, bank carry-over, ledger, terms snapshot) and then sets
 * the expiry the admin chose. No region lock is set: no payment evidence.
 */
async function grantPlanWithExpiry(userId, planCode, validUntil) {
  if (!PAID_GRANTABLE.includes(planCode)) throw new AdminBillingError(400, 'BAD_PLAN', 'Grant STARTER, PRO or ENTERPRISE. Use "reset trial" for trials.');
  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan) throw new AdminBillingError(400, 'BAD_PLAN', 'That plan does not exist.');
  const now = Date.now();
  if (!(validUntil instanceof Date) || Number.isNaN(validUntil.getTime()) || validUntil.getTime() <= now || validUntil.getTime() > now + 366 * DAY_MS) {
    throw new AdminBillingError(400, 'BAD_DATE', 'Choose an expiry in the future, at most a year away.');
  }
  const before = await prisma.entitlement.findUnique({ where: { userId } });
  await prisma.$transaction(async (tx) => {
    await grantPlan(userId, planCode, { billingRegion: null, currency: null, regionSource: null }, {
      tx,
      afterCommit: [],
      ledgerSource: `admin_grant:${planCode.toLowerCase()}`,
    });
    await tx.entitlement.update({
      where: { userId },
      data: { validUntil, graceUntil: new Date(validUntil.getTime() + GRACE_MS), status: 'ACTIVE' },
    });
  });
  const after = await prisma.entitlement.findUnique({ where: { userId } });
  return { before: snapshot(before), after: snapshot(after) };
}

/** Push validUntil (and graceUntil) out by `days`. The status follows the new dates. */
async function extendExpiry(userId, days) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new AdminBillingError(400, 'BAD_DAYS', 'Days must be a whole number from 1 to 365.');
  const e = await prisma.entitlement.findUnique({ where: { userId } });
  if (!e || !e.planCode || !e.validUntil) throw new AdminBillingError(409, 'NO_PLAN', 'This customer has no plan or trial to extend.');
  const shift = days * DAY_MS;
  const now = Date.now();
  // Extending a lapsed plan extends from today, not from a date in the past.
  const base = Math.max(e.validUntil.getTime(), now);
  const validUntil = new Date(base + shift);
  const graceUntil = e.planCode === 'TRIAL' ? null : new Date(validUntil.getTime() + GRACE_MS);
  const status = e.planCode === 'TRIAL' ? 'TRIALING' : 'ACTIVE';
  const after = await prisma.entitlement.update({ where: { userId }, data: { validUntil, graceUntil, status } });
  return { before: snapshot(e), after: snapshot(after) };
}

/** Extra classifications for the CURRENT cycle only (reset by the next grant or roll). */
async function addBonusClassifications(userId, amount) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) throw new AdminBillingError(400, 'BAD_AMOUNT', 'Amount must be a whole number from 1 to 100,000.');
  const e = await prisma.entitlement.findUnique({ where: { userId } });
  if (!e || !e.planCode) throw new AdminBillingError(409, 'NO_PLAN', 'This customer has no plan or trial to add quota to.');
  const after = await prisma.entitlement.update({ where: { userId }, data: { bonusClassificationsCycle: { increment: amount } } });
  return { before: snapshot(e), after: snapshot(after) };
}

/**
 * Let the customer start a trial again: clear the trial on their entitlement
 * and the "trial used" stamp on their CONNECTED Instagram accounts' identities.
 * Refused while a paid plan is live — resetting would throw away paid time.
 */
async function resetTrial(userId) {
  const e = await prisma.entitlement.findUnique({ where: { userId } });
  const status = effectiveStatus(e);
  if (e && e.planCode && e.planCode !== 'TRIAL' && ['ACTIVE', 'GRACE'].includes(status)) {
    throw new AdminBillingError(409, 'PAID_PLAN', 'This customer is on a paid plan; a trial reset would throw it away.');
  }
  const accounts = await prisma.instagramAccount.findMany({ where: { userId, connectionStatus: 'CONNECTED' }, select: { igUserId: true } });
  const hashes = [...new Set(accounts.map((a) => hashIgUserId(a.igUserId)))];

  await prisma.$transaction(async (tx) => {
    if (e) {
      const balance = e.replyCreditsCurrent + e.replyCreditsBanked;
      await tx.entitlement.update({
        where: { userId },
        data: {
          planCode: null,
          status: 'NONE',
          validUntil: null,
          graceUntil: null,
          replyCreditsCurrent: 0,
          replyCreditsBanked: 0,
          classificationCountCycle: 0,
          bonusClassificationsCycle: 0,
          ...termsFrom(null),
          termsSnapshotAt: null,
        },
      });
      if (balance > 0) {
        await tx.creditLedger.create({
          data: { tenantId: userId, delta: -balance, type: 'EXPIRE', source: 'expire:admin_trial_reset', balanceAfter: 0 },
        });
      }
    }
    if (hashes.length) {
      await tx.instagramIdentity.updateMany({ where: { igUserIdHash: { in: hashes } }, data: { trialConsumedAt: null } });
    }
  });
  const after = await prisma.entitlement.findUnique({ where: { userId } });
  return { before: snapshot(e), after: snapshot(after), identitiesCleared: hashes.length };
}

module.exports = { grantPlanWithExpiry, extendExpiry, addBonusClassifications, resetTrial, AdminBillingError, PAID_GRANTABLE };
