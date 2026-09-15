/**
 * Refunds (Gates 11b, 11c). Admin-initiated only — there is no self-serve
 * refund button anywhere.
 *
 * THREE ENTRY POINTS, ONE STATE MACHINE:
 *   initiateRefund     POST /api/admin/billing/orders/:id/refunds
 *   applyRefundStatus  every status Cashfree reports: the create response, the
 *                      REFUND_STATUS_WEBHOOK, and syncRefund below
 *   syncRefund         POST /api/admin/billing/refunds/:refundId/sync — the
 *                      backstop for a dropped webhook
 *
 * A REFUND THAT FAILS AT CASHFREE NEVER LOOKS SUCCESSFUL HERE. The row is
 * written as REQUESTED before Cashfree is called, and its status only ever
 * changes to what Cashfree says. SUCCESS, CANCELLED and FAILED are terminal: a
 * late or replayed status after them is ignored.
 *
 * REVOCATION IS THE PART THAT MATTERS. A refund without revocation is free
 * service. When SUCCESS refunds on an order reach its full amount, the grant is
 * revoked (entitlementService.revokeOrderGrant) in the SAME transaction that
 * records the SUCCESS, under a row lock on the order, exactly once per order.
 * A PARTIAL refund revokes nothing — money left and access stayed — so it
 * raises a CRITICAL alert to SUPPORT_EMAIL instead.
 *
 * THE POLICY IS REPORTED, NEVER A HARD REFUSAL. Eligibility and the usage
 * numbers it was decided on are returned and stored on the refund row. An
 * ineligible refund needs overridePolicy: true and an override reason, both
 * stored — an admin can always refund, but never by accident.
 */

const crypto = require('crypto');
const prisma = require('../lib/prisma');
const entitlementService = require('./entitlementService');
const cashfreeOrders = require('../lib/cashfreeOrders');
const { alertBillingOps } = require('../lib/billingAlerts');

/** The published policy (frontend/src/app/refund-policy/page.js). Change both together. */
const REFUND_WINDOW_DAYS = 7;
const PLAN_USAGE_LIMIT_PERCENT = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL = ['SUCCESS', 'CANCELLED', 'FAILED'];
const CASHFREE_STATUSES = ['PENDING', 'ONHOLD', 'SUCCESS', 'CANCELLED', 'FAILED'];
/** Refunds that count against what is still refundable: anything not known to have failed. */
const COMMITTED = ['REQUESTED', 'PENDING', 'ONHOLD', 'SUCCESS'];
const TX_OPTIONS = { maxWait: 15_000, timeout: 20_000 };

/** An error carrying the HTTP status and body the admin route should answer with. */
function httpError(status, error, extra = {}) {
  return Object.assign(new Error(error), { status, body: { error, ...extra } });
}

function generateRefundId() {
  // Cashfree caps refund_id at 40 characters; "rf_" + 32 hex is 35.
  return `rf_${crypto.randomUUID().replace(/-/g, '')}`;
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Is this order refundable under the published policy, and on what numbers?
 *
 * Usage is the auto-replies sent after the payment (SPEND ledger rows since
 * paidAt), exactly as /refund-policy words it.
 */
async function evaluatePolicy(order, now = new Date(), db = prisma) {
  const snap = order.grantSnapshot || {};
  const kind = order.planCode ? 'plan' : order.addonCode === 'extra_ig_account' ? 'extra_ig_account' : 'reply_pack';
  const daysSincePayment = order.paidAt ? (now.getTime() - order.paidAt.getTime()) / DAY_MS : null;

  // The purchase's OWN credits (FIFO: credits already held spend first).
  const usage = await entitlementService.creditsUsedFromOrder(order, { db });
  const creditsGranted = kind === 'extra_ig_account' ? null : usage.granted;
  const creditsUsedFromPurchase = usage.usedFromOrder;

  const reasons = [];
  if (daysSincePayment == null) reasons.push('The order has no payment date.');
  else if (daysSincePayment > REFUND_WINDOW_DAYS) {
    reasons.push(`Paid ${round1(daysSincePayment)} days ago; the window is ${REFUND_WINDOW_DAYS} days.`);
  }

  let usedPercent = null;
  const cycleEndsAt = snap.grantedValidUntil || null;
  if (kind === 'plan') {
    usedPercent = creditsGranted > 0 ? round1((creditsUsedFromPurchase / creditsGranted) * 100) : 0;
    if (usedPercent >= PLAN_USAGE_LIMIT_PERCENT) {
      reasons.push(
        `${creditsUsedFromPurchase} of the ${creditsGranted} credits from this purchase used (${usedPercent}%); the limit is under ${PLAN_USAGE_LIMIT_PERCENT}%.`
      );
    }
    if (cycleEndsAt && now.getTime() >= new Date(cycleEndsAt).getTime()) {
      reasons.push(`The paid period ended on ${new Date(cycleEndsAt).toISOString()}.`);
    }
  } else if (kind === 'reply_pack' && creditsUsedFromPurchase > 0) {
    reasons.push(`${creditsUsedFromPurchase} of this top-up's credits used; a top-up is refundable only if entirely unused.`);
  } else if (kind === 'extra_ig_account' && order.slotUsedAt) {
    reasons.push(`An Instagram account was connected using this slot on ${order.slotUsedAt.toISOString()}.`);
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    kind,
    windowDays: REFUND_WINDOW_DAYS,
    daysSincePayment: daysSincePayment == null ? null : round1(daysSincePayment),
    paidAt: order.paidAt?.toISOString() ?? null,
    creditsGranted,
    creditsAheadAtGrant: usage.creditsAheadAtGrant,
    creditsSpentSincePayment: usage.spentSincePayment,
    creditsUsedFromPurchase,
    usageMeasure: usage.measure,
    slotUsedAt: kind === 'extra_ig_account' ? order.slotUsedAt?.toISOString() ?? null : undefined,
    usedPercent,
    usageLimitPercent: kind === 'plan' ? PLAN_USAGE_LIMIT_PERCENT : null,
    cycleEndsAt,
    evaluatedAt: now.toISOString(),
  };
}

/** The order, its refunds, and what is still refundable. */
async function refundContext(cashfreeOrderId, db = prisma) {
  const order = await db.order.findUnique({ where: { cashfreeOrderId } });
  if (!order) throw httpError(404, 'No order with that id.');
  const refunds = await db.refund.findMany({ where: { cashfreeOrderId }, orderBy: { createdAt: 'asc' } });
  const committed = refunds.filter((r) => COMMITTED.includes(r.status)).reduce((sum, r) => sum + r.amount, 0);
  return { order, refunds, refundableAmount: Math.max(0, order.amount - committed) };
}

/** GET eligibility: policy, usage numbers, refunds so far, what is still refundable. */
async function getRefundEligibility(cashfreeOrderId, now = new Date()) {
  const { order, refunds, refundableAmount } = await refundContext(cashfreeOrderId);
  const policy = order.status === 'PAID' ? await evaluatePolicy(order, now) : null;
  return {
    order: {
      cashfreeOrderId: order.cashfreeOrderId,
      tenantId: order.tenantId,
      item: order.planCode || order.addonCode,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      paidAt: order.paidAt,
    },
    refundableAmount,
    policy,
    refunds,
  };
}

/**
 * Start a refund at Cashfree.
 *
 * @param {object} args
 * @param {string} args.cashfreeOrderId
 * @param {number} [args.amount]           smallest currency unit; defaults to everything still refundable
 * @param {string} args.reason             always required
 * @param {boolean} [args.overridePolicy]  required (true) when the policy says ineligible
 * @param {string} [args.overrideReason]   required whenever overridePolicy is true
 * @param {string} args.initiatedBy        the admin user id
 */
async function initiateRefund({ cashfreeOrderId, amount, reason, overridePolicy = false, overrideReason, initiatedBy, now = new Date() }) {
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (!cleanReason) throw httpError(400, 'A reason is required for every refund.');

  const { order, refundableAmount } = await refundContext(cashfreeOrderId);
  if (order.status !== 'PAID') throw httpError(409, `Only a PAID order can be refunded; this one is ${order.status}.`);
  if (refundableAmount <= 0) throw httpError(409, 'This order has already been refunded in full.');

  const refundAmount = amount == null ? refundableAmount : amount;
  if (!Number.isInteger(refundAmount) || refundAmount <= 0) {
    throw httpError(400, 'amount must be a positive whole number in the smallest currency unit (paise or cents).');
  }
  if (refundAmount > refundableAmount) {
    throw httpError(409, `amount ${refundAmount} exceeds what is still refundable (${refundableAmount}).`, { refundableAmount });
  }

  const policy = await evaluatePolicy(order, now);
  const overriding = overridePolicy === true;
  const cleanOverrideReason = typeof overrideReason === 'string' ? overrideReason.trim() : '';
  if (!policy.eligible && !overriding) {
    throw httpError(409, 'This refund is outside the refund policy. To issue it anyway, send overridePolicy: true with an overrideReason.', {
      code: 'REFUND_POLICY_INELIGIBLE',
      policy,
    });
  }
  if (overriding && !cleanOverrideReason) {
    throw httpError(400, 'overrideReason is required when overridePolicy is true.', { policy });
  }

  const refundId = generateRefundId();
  await prisma.refund.create({
    data: {
      refundId,
      cashfreeOrderId,
      tenantId: order.tenantId,
      amount: refundAmount,
      currency: order.currency,
      reason: cleanReason.slice(0, 1000),
      status: 'REQUESTED',
      initiatedBy,
      overridePolicy: overriding,
      overrideReason: overriding ? cleanOverrideReason.slice(0, 1000) : null,
      policyCheck: policy,
    },
  });

  let cf;
  try {
    cf = await cashfreeOrders.createRefund({ orderId: cashfreeOrderId, refundId, amountInPaise: refundAmount, note: cleanReason });
  } catch (err) {
    const httpStatus = err.response?.status;
    const detail = err.response?.data?.message || err.message;
    // A 4xx is Cashfree refusing it: no refund exists there, so FAILED. Anything
    // else (timeout, 5xx) might have created it — stay REQUESTED and let a
    // re-sync ask. Neither is ever recorded as a success.
    const refused = httpStatus >= 400 && httpStatus < 500;
    await prisma.refund.update({
      where: { refundId },
      data: { status: refused ? 'FAILED' : 'REQUESTED', lastError: String(detail).slice(0, 1000) },
    });
    console.error(`[Refund] Cashfree create refund ${refundId} for ${cashfreeOrderId} failed (${httpStatus || 'no response'}):`, detail);
    throw httpError(502, refused ? `Cashfree refused the refund: ${detail}` : 'Cashfree did not confirm the refund. Re-sync it before retrying.', {
      refundId,
      status: refused ? 'FAILED' : 'REQUESTED',
    });
  }

  const applied = await applyRefundStatus({
    refundId,
    cashfreeOrderId,
    status: cf.refund_status,
    refundAmount: cf.refund_amount,
    cfRefundId: cf.cf_refund_id,
    arn: cf.refund_arn,
    statusDescription: cf.status_description,
    processedAt: cf.processed_at,
    rawPayload: JSON.stringify(cf),
    source: 'create',
  });

  return { refund: applied.refund, policy, revocation: applied.revocation || null };
}

/**
 * Record a status Cashfree reported for a refund — and revoke the grant when
 * it completes the order's full refund. Idempotent: replays, out-of-order
 * statuses, and concurrent deliveries all converge on one transition and at
 * most one revocation.
 *
 * @returns {Promise<{ outcome: string, refund?: object, revocation?: object }>}
 */
async function applyRefundStatus({
  refundId,
  cashfreeOrderId,
  status,
  refundAmount,
  cfRefundId,
  arn,
  statusDescription,
  processedAt,
  rawPayload,
  source,
  now = new Date(),
}) {
  if (!CASHFREE_STATUSES.includes(status)) {
    console.warn(`[Refund] Ignoring unknown refund_status "${status}" for ${refundId} (${source}).`);
    return { outcome: 'ignored_unknown_status' };
  }

  const alerts = [];

  const result = await prisma.$transaction(async (tx) => {
    let refund = await tx.refund.findUnique({ where: { refundId } });

    if (!refund) {
      // A refund Siffty did not initiate — e.g. issued from the Cashfree
      // dashboard. It still moves money, so it is recorded and processed like
      // any other, and a human is told.
      const order = await tx.order.findUnique({ where: { cashfreeOrderId } });
      if (!order) {
        console.warn(`[Refund] ${source}: refund ${refundId} for unknown order ${cashfreeOrderId} — ignored.`);
        return { outcome: 'order_not_found' };
      }
      const amountMinor = Math.round(Number(refundAmount) * 100);
      if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        console.error(`[Refund] ${source}: external refund ${refundId} carries no usable refund_amount (${JSON.stringify(refundAmount)}) — ignored.`);
        return { outcome: 'invalid_amount' };
      }
      refund = await tx.refund.create({
        data: {
          refundId,
          cashfreeOrderId,
          tenantId: order.tenantId,
          amount: amountMinor,
          currency: order.currency,
          reason: 'Issued outside Siffty (first reported by Cashfree).',
          status: 'REQUESTED',
          initiatedBy: 'cashfree:external',
        },
      });
      alerts.push(['refundOutsideSiffty', { refundId, cashfreeOrderId, tenantId: order.tenantId, amount: amountMinor, currency: order.currency, status }]);
    }

    if (refund.cashfreeOrderId !== cashfreeOrderId) {
      console.error(`[Refund] ${source}: refund ${refundId} belongs to ${refund.cashfreeOrderId}, not ${cashfreeOrderId} — ignored.`);
      return { outcome: 'order_mismatch', refund };
    }

    if (TERMINAL.includes(refund.status)) {
      return { outcome: refund.status === status ? 'duplicate' : 'ignored_after_terminal', refund };
    }

    // The conditional update is the idempotency guard: a concurrent delivery
    // waits on this row, then matches nothing once the first has committed a
    // terminal status.
    const moved = await tx.refund.updateMany({
      where: { refundId, status: { notIn: TERMINAL } },
      data: {
        status,
        cfRefundId: cfRefundId != null ? String(cfRefundId).slice(0, 64) : undefined,
        arn: typeof arn === 'string' && arn ? arn.slice(0, 64) : undefined,
        statusDescription: typeof statusDescription === 'string' ? statusDescription.slice(0, 500) : undefined,
        processedAt: processedAt && !Number.isNaN(new Date(processedAt).getTime()) ? new Date(processedAt) : undefined,
        rawPayload: typeof rawPayload === 'string' ? rawPayload : undefined,
        lastError: null,
      },
    });
    if (moved.count === 0) return { outcome: 'duplicate', refund: await tx.refund.findUnique({ where: { refundId } }) };

    let revocation = null;
    if (status === 'SUCCESS') {
      // Lock the order: two different refunds completing concurrently must not
      // both see "not yet revoked".
      await tx.$queryRaw`SELECT id FROM orders WHERE cashfree_order_id = ${cashfreeOrderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { cashfreeOrderId } });
      const succeeded = await tx.refund.aggregate({ where: { cashfreeOrderId, status: 'SUCCESS' }, _sum: { amount: true } });
      const refundedTotal = succeeded._sum.amount ?? 0;

      if (refundedTotal >= order.amount) {
        const alreadyRevoked = await tx.refund.count({ where: { cashfreeOrderId, revokedAt: { not: null } } });
        if (!alreadyRevoked) {
          revocation = await entitlementService.revokeOrderGrant(order, { tx, now, refundId });
          await tx.refund.update({ where: { refundId }, data: { revokedAt: now, revocation } });
          if (revocation.snapshotMissing) {
            alerts.push(['refundSnapshotMissing', { refundId, cashfreeOrderId, tenantId: order.tenantId, revocation }]);
          }
        }
      } else {
        alerts.push([
          'partialRefund',
          {
            refundId,
            cashfreeOrderId,
            tenantId: order.tenantId,
            item: order.planCode || order.addonCode,
            refundedThisTime: refund.amount,
            refundedTotal,
            orderAmount: order.amount,
            currency: order.currency,
          },
        ]);
      }
    }

    return { outcome: 'updated', refund: await tx.refund.findUnique({ where: { refundId } }), revocation };
  }, TX_OPTIONS);

  // Only after commit: an alert about a transition that rolled back would be its own false record.
  for (const [kind, details] of alerts) await alertBillingOps(kind, details);

  if (result.outcome === 'updated') {
    console.log(
      `[Refund] ${source}: ${refundId} -> ${status}` + (result.revocation ? ` (grant revoked: ${JSON.stringify(result.revocation)})` : '')
    );
  }
  return result;
}

/** Ask Cashfree for a refund's current state and apply it — the backstop for a dropped webhook. */
async function syncRefund(refundId, now = new Date()) {
  const refund = await prisma.refund.findUnique({ where: { refundId } });
  if (!refund) throw httpError(404, 'No refund with that id.');

  let cf;
  try {
    cf = await cashfreeOrders.getRefund(refund.cashfreeOrderId, refundId);
  } catch (err) {
    if (err.response?.status === 404 && refund.status === 'REQUESTED') {
      // Never reached Cashfree: it can never succeed.
      const updated = await prisma.refund.update({
        where: { refundId },
        data: { status: 'FAILED', lastError: 'Not found at Cashfree on re-sync.' },
      });
      return { outcome: 'not_found_at_cashfree', refund: updated };
    }
    throw httpError(502, `Could not fetch the refund from Cashfree: ${err.response?.data?.message || err.message}`);
  }

  return applyRefundStatus({
    refundId,
    cashfreeOrderId: refund.cashfreeOrderId,
    status: cf.refund_status,
    refundAmount: cf.refund_amount,
    cfRefundId: cf.cf_refund_id,
    arn: cf.refund_arn,
    statusDescription: cf.status_description,
    processedAt: cf.processed_at,
    rawPayload: JSON.stringify(cf),
    source: 'sync',
    now,
  });
}

module.exports = {
  REFUND_WINDOW_DAYS,
  PLAN_USAGE_LIMIT_PERCENT,
  evaluatePolicy,
  getRefundEligibility,
  initiateRefund,
  applyRefundStatus,
  syncRefund,
};
