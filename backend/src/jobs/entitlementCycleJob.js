/**
 * Cycle-boundary sweep — the half of rollCycle() that nothing else triggers.
 *
 * A RENEWAL already rolls the cycle: grantPlan() banks the leftover credits,
 * resets the classification counter and restamps cycleStartedAt, all inside
 * the payment transaction. This job exists for the tenants who did NOT
 * renew, where nothing else would ever reset anything.
 *
 * The case that actually matters is GRACE. Classification deliberately
 * keeps running after validUntil (only auto-reply stops), so a tenant whose
 * 30 days elapsed without a purchase would otherwise stay pinned at last
 * cycle's classification count for the whole grace window — hitting the cap
 * and silently losing enrichment on messages they are still entitled to.
 * "Classification never rolls over; it resets every cycle" has to be true
 * on the clock, not only on payment.
 *
 * Idempotent by construction: rollCycle() restamps cycleStartedAt to now, so
 * a swept entitlement immediately stops matching the query below. Running
 * this twice in a row is a no-op the second time.
 */

const prisma = require('../lib/prisma');
const entitlementService = require('../services/entitlementService');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Roll every entitlement whose cycle has elapsed without a purchase.
 *
 * One query per plan rather than one per tenant: cycle length lives on the
 * Plan row, so the cutoff differs per plan (3 days for TRIAL, 30 for the
 * paid tiers) and cannot be expressed as a single cross-table comparison in
 * Prisma. There are four plans.
 */
async function sweepElapsedCycles({ now = new Date() } = {}) {
  const plans = await prisma.plan.findMany({
    where: { cycleLengthDays: { gt: 0 } },
    select: { code: true, cycleLengthDays: true },
  });

  let rolled = 0;

  for (const plan of plans) {
    const cutoff = new Date(now.getTime() - plan.cycleLengthDays * DAY_MS);

    const due = await prisma.entitlement.findMany({
      where: {
        planCode: plan.code,
        cycleStartedAt: { lte: cutoff },
        // NONE has no cycle to roll, and a fully EXPIRED tenant cannot
        // classify at all — rolling their counter would be busywork that
        // grants nothing. GRACE is the case this job exists for.
        status: { in: ['TRIALING', 'ACTIVE', 'GRACE'] },
      },
      select: { userId: true },
    });

    for (const entitlement of due) {
      try {
        const result = await entitlementService.rollCycle(entitlement.userId, { ifCycleStartedBefore: cutoff });
        if (result) rolled += 1;
      } catch (err) {
        console.error(`[EntitlementCycle] Failed to roll cycle for tenant ${entitlement.userId}:`, err.message);
      }
    }
  }

  if (rolled > 0) console.log(`[EntitlementCycle] Rolled ${rolled} elapsed cycle(s).`);
  return rolled;
}

module.exports = { sweepElapsedCycles };
