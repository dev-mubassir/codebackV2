/**
 * Recovery for inbound DMs skipped while a tenant had no entitlement.
 *
 * THE LOSS THIS CLOSES. With billing on, messageAnalysisJob marks an inbound
 * DM `skipped` whenever classificationGateReason() is not 'ok'. For
 * `not_entitled` that was final: nothing retried it. A tenant whose trial
 * started — or whose plan was bought — after their DMs arrived kept those
 * leads unsorted for good, and nothing in the inbox said why.
 *
 * WHEN IT RUNS: right after an entitlement is granted — a trial on Instagram
 * connect, a trial claim, a plan purchase. Always after the grant has
 * committed, never inside it, and it never throws: a failed recovery must not
 * fail a grant, a connect, or a paid order.
 *
 * WHAT IT RECOVERS
 *   - inbound messages skipped for `not_entitled`, or skipped before skip
 *     reasons were recorded (aiSkipReason NULL — see below)
 *   - that arrived within the last RECOVERY_WINDOW_DAYS
 *   - newest first, bounded by what is left of the tenant's classification
 *     cap this cycle. Recovery can never classify more than the allowance the
 *     new entitlement actually has.
 * `cycle_cap` and `hourly_throttle` skips are NOT recovered here: a new grant
 * is not what clears them.
 *
 * HOW: each message is reset to `pending` with aiRecoveredAt stamped, by a
 * conditional update (so two concurrent recoveries cannot both take one), and
 * re-enqueued under a recovery-specific jobId — the queue dedupes on jobId and
 * would silently drop a second `analyze-<id>`.
 *
 * CLASSIFICATION, NOT AUTO-REPLY. A recovered message may auto-reply only if
 * it arrived within the last hour; older ones are classified and left for the
 * human. messageAnalysisJob enforces that from aiRecoveredAt.
 *
 * NULL REASONS. A skip recorded before `ai_skip_reason` existed has no
 * knowable reason, so it cannot be told apart from a cycle-cap skip. Such
 * messages are included; the cap bound above is what keeps that cost honest.
 */

const prisma = require('../lib/prisma');
const entitlementService = require('./entitlementService');

const RECOVERY_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A plan with no classification cap (Enterprise) still gets a ceiling on one recovery pass. */
const UNCAPPED_RECOVERY_LIMIT = 500;
const RECOVERABLE_REASONS = ['not_entitled'];

/** Inbound, skipped, this tenant's, within the recovery window. */
function recentSkippedWhere(tenantId, now) {
  return {
    direction: 'inbound',
    aiStatus: 'skipped',
    createdAt: { gte: new Date(now.getTime() - RECOVERY_WINDOW_DAYS * DAY_MS) },
    conversation: { instagramAccount: { userId: tenantId } },
  };
}

/** Classifications the tenant's live entitlement still allows this cycle; 0 when not entitled. */
async function remainingClassifications(tenantId) {
  const entitlement = await entitlementService.getEntitlement(tenantId);
  if (!entitlement || !entitlementService.LIVE_STATUSES.includes(entitlement.effectiveStatus)) return 0;
  const plan = entitlement.planCode ? await prisma.plan.findUnique({ where: { code: entitlement.planCode } }) : null;
  if (!plan) return 0;
  if (plan.classificationCapCycle == null) return UNCAPPED_RECOVERY_LIMIT;
  return Math.max(0, plan.classificationCapCycle - entitlement.classificationCountCycle);
}

/**
 * Re-queue this tenant's recoverable skipped messages. Never throws.
 *
 * @param {string} tenantId
 * @param {object} [opts]
 * @param {string} [opts.trigger]  what granted the entitlement, for the log
 * @param {Date}   [opts.now]
 * @returns {Promise<{requeued: number, limit?: number, error?: string}>}
 */
async function recoverSkippedMessages(tenantId, { trigger = 'entitlement_granted', now = new Date() } = {}) {
  try {
    const limit = await remainingClassifications(tenantId);
    if (limit <= 0) return { requeued: 0, limit };

    const candidates = await prisma.message.findMany({
      where: {
        ...recentSkippedWhere(tenantId, now),
        OR: [{ aiSkipReason: { in: RECOVERABLE_REASONS } }, { aiSkipReason: null }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true },
    });
    if (candidates.length === 0) return { requeued: 0, limit };

    // Lazily required: jobs/index -> messageAnalysisJob -> entitlementService,
    // and billingFulfillment (which requires this file) is itself reached from
    // jobs/index. Read at call time, so a test's spy on it is honoured.
    const jobs = require('../jobs/index');
    const jobKey = `recovered-${now.getTime()}`;

    let requeued = 0;
    for (const { id } of candidates) {
      const taken = await prisma.message.updateMany({
        where: { id, aiStatus: 'skipped' },
        data: { aiStatus: 'pending', aiSkipReason: null, aiRecoveredAt: now },
      });
      if (taken.count !== 1) continue; // a concurrent recovery already took it
      await jobs.enqueueMessageAnalysis(id, { jobKey });
      requeued += 1;
    }

    console.log(`[Recovery] ${trigger}: re-queued ${requeued} skipped message(s) for user ${tenantId} (allowance ${limit}).`);
    return { requeued, limit };
  } catch (err) {
    console.error(`[Recovery] ${trigger}: could not recover skipped messages for user ${tenantId}:`, err.message);
    return { requeued: 0, error: err.message };
  }
}

/**
 * Inbound DMs from the recovery window that are still unsorted, by the gate
 * reason recorded at the time — what the inbox tells the customer.
 *
 * @returns {Promise<{count: number, byReason: Record<string, number>, windowDays: number}>}
 *   byReason keys are gate reasons, plus `unrecorded` for pre-column skips.
 */
async function countUnsortedMessages(tenantId, now = new Date()) {
  const groups = await prisma.message.groupBy({
    by: ['aiSkipReason'],
    where: recentSkippedWhere(tenantId, now),
    _count: { _all: true },
  });
  const byReason = {};
  let count = 0;
  for (const g of groups) {
    const key = g.aiSkipReason || 'unrecorded';
    byReason[key] = (byReason[key] || 0) + g._count._all;
    count += g._count._all;
  }
  return { count, byReason, windowDays: RECOVERY_WINDOW_DAYS };
}

module.exports = {
  RECOVERY_WINDOW_DAYS,
  recoverSkippedMessages,
  countUnsortedMessages,
};
