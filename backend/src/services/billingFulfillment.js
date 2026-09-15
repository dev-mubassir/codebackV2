/**
 * Shared "an order was actually paid" logic, called from TWO places:
 *   - routes/cashfreeWebhooks.js — the primary, near-real-time path.
 *   - jobs/billingReconciliationJob.js — the nightly backstop for a webhook
 *     Cashfree sent but we never received (dropped webhooks are normal; a
 *     paying customer locked out is the worst support ticket, per the
 *     brief).
 * Both must reach the exact same idempotent outcome, so the logic lives
 * here once rather than being duplicated.
 *
 * ORDER STATE IS "HAS A SUCCESSFUL PAYMENT OR NOT". An order is CREATED until a
 * payment succeeds (PAID) or it expires (EXPIRED, the only terminal state). A
 * failed or abandoned ATTEMPT never changes the order — Cashfree lets a
 * customer retry on the same order — and is recorded as a PaymentAttempt row
 * instead (recordPaymentAttempt below).
 *
 * IDEMPOTENCY. The guard is the conditional UPDATE below (`status: 'CREATED'`
 * in the WHERE clause), not an in-memory set — this is a single-instance
 * deployment with no row-level locking, and the brief is explicit that the
 * DB is the guard. A second call for the same orderId (a replayed webhook,
 * or the reconciliation job re-checking an order the webhook already
 * fulfilled seconds earlier) updates zero rows and grants nothing twice.
 */

const prisma = require('../lib/prisma');
const entitlementService = require('./entitlementService');
const { recoverSkippedMessages } = require('./skippedMessageRecovery');
const { alertBillingOps } = require('../lib/billingAlerts');

/**
 * Payment methods that are India-only by construction — UPI, netbanking,
 * and India-specific BNPL/wallet rails carry no "country" field in
 * Cashfree's payload because there is only ever one possible country.
 * `payment_group`/`payment_status` shape confirmed against the reverted
 * code's own PG webhook handler.
 */
const DOMESTIC_ONLY_PAYMENT_GROUPS = ['upi', 'net_banking', 'nb', 'app', 'paylater', 'cardless_emi', 'banktransfer'];

/**
 * Region evidence from a webhook/order-fetch payment object, as a
 * provenance pair rather than a bare country code — NEVER fall back to the
 * order's own currency here. Currency is the pricing hint WE showed the
 * customer before they paid, so using it as evidence of their actual
 * region is circular — it is exactly the VPN-arbitrage path the region
 * lock exists to close.
 *
 * `card_country` IS the correct field name (alongside `card_network`,
 * `card_type`, `card_bank_name`) but Cashfree's own documented sample
 * payloads show it frequently returning null — a real card payment with no
 * usable country signal is the expected common case, not an edge case.
 *
 * @returns {{ country: string|null, source: 'RAIL_INFERRED'|'CARD_COUNTRY'|'UNVERIFIED' }}
 */
function inferPaymentCountry(payment) {
  const group = payment?.payment_group;
  if (group && DOMESTIC_ONLY_PAYMENT_GROUPS.includes(group)) {
    return { country: 'IN', source: 'RAIL_INFERRED' };
  }

  // A string or nothing. The value is written to a String column, so an
  // unexpected shape here (an object, a number) would be a Prisma validation
  // throw — a 500 and an endless Cashfree retry for a payment we could grant.
  const cardCountry = payment?.payment_method?.card?.card_country;
  if (typeof cardCountry === 'string' && /^[A-Za-z]{2,3}$/.test(cardCountry)) {
    return { country: cardCountry, source: 'CARD_COUNTRY' };
  }

  return { country: null, source: 'UNVERIFIED' };
}

/** IN-or-INTL from a country code. Only ever called with RAIL_INFERRED/CARD_COUNTRY evidence — never for UNVERIFIED, which has no country to convert. */
function countryToBillingRegion(country) {
  return country === 'IN' ? 'IN' : 'INTL';
}

/**
 * Generous bounds for the fulfilment transaction. A retry storm queues every
 * concurrent delivery behind the first one's row lock on the order, and each
 * waiter needs a pooled connection meanwhile; Prisma's defaults (2s wait, 5s
 * run) would turn that queue into spurious 500s. A 500 is safe — nothing
 * commits — but it is noise Cashfree then has to retry.
 */
const FULFILMENT_TX_OPTIONS = { maxWait: 15_000, timeout: 20_000 };

/** A bounded string from an untrusted payload field, or null. */
function text(value, max) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

/** The PaymentAttempt row for one reported attempt outcome. */
function attemptRow({ cashfreeOrderId, eventType, payment, rawPayload }) {
  const cfPaymentId = payment?.cf_payment_id;
  return {
    cashfreeOrderId,
    cfPaymentId: typeof cfPaymentId === 'string' || typeof cfPaymentId === 'number' ? String(cfPaymentId).slice(0, 64) : null,
    status: text(payment?.payment_status, 40) || 'UNKNOWN',
    eventType: text(eventType, 64) || 'UNKNOWN',
    paymentGroup: text(payment?.payment_group, 40),
    failureReason: text(payment?.payment_message, 500) || text(payment?.error_details?.error_description, 500),
    rawPayload: typeof rawPayload === 'string' ? rawPayload : null,
  };
}

/**
 * Record an attempt outcome (FAILED, USER_DROPPED, ...) WITHOUT touching the
 * order. `createMany({ skipDuplicates })` — ON CONFLICT DO NOTHING — makes a
 * replayed webhook a no-op, and never aborts a surrounding transaction the way
 * a caught unique violation would on Postgres.
 *
 * @returns {Promise<{ recorded: boolean, reason?: 'not_found'|'duplicate' }>}
 */
async function recordPaymentAttempt({ cashfreeOrderId, eventType, payment, rawPayload }, db = prisma) {
  const order = await db.order.findUnique({ where: { cashfreeOrderId }, select: { id: true } });
  if (!order) {
    console.warn(`[Billing] ${eventType} for unknown order ${cashfreeOrderId} — not recorded.`);
    return { recorded: false, reason: 'not_found' };
  }
  const { count } = await db.paymentAttempt.createMany({
    data: [attemptRow({ cashfreeOrderId, eventType, payment, rawPayload })],
    skipDuplicates: true,
  });
  console.log(
    `[Billing] ${eventType} for order ${cashfreeOrderId}: attempt ${count ? 'recorded' : 'already recorded'}; order unchanged.`
  );
  return count ? { recorded: true } : { recorded: false, reason: 'duplicate' };
}

/**
 * Mark an Order PAID and grant its plan/add-on, exactly once, ever.
 *
 * ONE TRANSACTION. Marking the order PAID, recording the successful attempt,
 * granting what it bought, and snapshotting what that grant changed all commit
 * or roll back together. They used to be separate writes: a failure between
 * marking PAID and granting left the order PAID with nothing granted, the
 * webhook returned 500, and Cashfree's retry then found the order already PAID
 * and granted nothing. tests/cashfree-webhook-edge-cases.test.js (Gate 9.5)
 * pins this.
 *
 * THE GRANT SNAPSHOT (Gate 11c). What the entitlement looked like before the
 * grant, and what the grant added, is stored on the order in the same
 * transaction. A refund needs exactly that to revoke the purchase — "set
 * validUntil back to what it was before the order" cannot be computed later.
 *
 * Emails and skipped-message recovery run only AFTER the commit: neither may
 * describe or act on a grant that then rolled back.
 *
 * @param {string} cashfreeOrderId  our own merchant order_id
 * @param {object} payment          the webhook/order-fetch `payment` object, for region evidence (may be partial or absent)
 * @param {string} rawPayload       raw JSON to store on the Order row for reconciliation/audit
 * @param {string} [eventType]      what reported the payment, for the attempt row
 * @returns {{ outcome: 'granted'|'already_processed'|'not_found'|'paid_after_expiry', order?: object }}
 */
async function fulfillPaidOrder({ cashfreeOrderId, payment, rawPayload, eventType = 'PAYMENT_SUCCESS_WEBHOOK' }) {
  const existing = await prisma.order.findUnique({ where: { cashfreeOrderId } });
  if (!existing) {
    console.warn(`[Billing] Fulfillment requested for unknown order ${cashfreeOrderId} — ignoring.`);
    return { outcome: 'not_found' };
  }

  const { country, source } = inferPaymentCountry(payment);
  const afterCommit = [];

  const result = await prisma.$transaction(async (tx) => {
    // The successful attempt is recorded whatever happens next — a replay of a
    // success on an already-PAID order is still that same attempt, and
    // skipDuplicates makes the second write a no-op.
    await tx.paymentAttempt.createMany({
      data: [attemptRow({ cashfreeOrderId, eventType, payment: { payment_status: 'SUCCESS', ...payment }, rawPayload })],
      skipDuplicates: true,
    });

    // The conditional update IS the idempotency guard. Concurrent deliveries
    // block on this row until the first transaction commits, then match zero
    // rows.
    const claimed = await tx.order.updateMany({
      where: { cashfreeOrderId, status: 'CREATED' },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paymentCountry: country,
        regionSource: source,
        rawPayload,
      },
    });

    if (claimed.count === 0) return { outcome: 'already_processed' };

    const order = await tx.order.findUnique({ where: { cashfreeOrderId } });
    const before = await tx.entitlement.findUnique({ where: { userId: order.tenantId } });

    // UNVERIFIED carries no billingRegion/currency at all — grantPlan's own
    // `existing?.x || region.x` merge then leaves an unlocked tenant unlocked
    // (null || null = null) and never overwrites an already-locked one
    // (existing wins outright). See entitlementService.grantPlan and the
    // Entitlement schema comment.
    const billingRegion = source === 'UNVERIFIED' ? null : countryToBillingRegion(country);
    const currency = billingRegion ? order.currency : null;

    let granted;
    let grantedCredits;
    let grantedDays = null;
    // How many credits spend BEFORE this purchase's own (FIFO: older first).
    // Refund eligibility and revocation measure the purchase's own credits from
    // it — see entitlementService.creditsUsedFromOrder.
    let creditsAheadAtGrant = null;
    if (order.planCode) {
      granted = await entitlementService.grantPlan(
        order.tenantId,
        order.planCode,
        { billingRegion, currency, regionSource: source },
        { tx, afterCommit }
      );
      const plan = await tx.plan.findUnique({ where: { code: order.planCode } });
      grantedCredits = plan?.autoReplyCreditsPerCycle ?? 0;
      grantedDays = plan?.cycleLengthDays ?? null;
      // grantPlan puts the new cycle's credits in `current` and the carried
      // balance in `banked`, and spend drains banked first.
      creditsAheadAtGrant = granted.replyCreditsBanked;
    } else if (order.addonCode) {
      granted = await entitlementService.grantAddon(order.tenantId, order.addonCode, { tx });
      const pack =
        order.addonCode === 'extra_ig_account' ? null : await tx.addonPack.findUnique({ where: { code: order.addonCode } });
      grantedCredits = pack?.creditAmount ?? 0;
      // A top-up joins the back of the queue: everything already held spends first.
      creditsAheadAtGrant = pack ? (before ? before.replyCreditsCurrent + before.replyCreditsBanked : 0) : null;
    } else {
      // Schema allows neither to be set only through a bug elsewhere — the
      // checkout path (routes/billing.js) always sets exactly one. Fail loud,
      // and roll the PAID mark back with it, rather than silently taking
      // someone's money and granting nothing.
      console.error(`[Billing] Order ${cashfreeOrderId} has neither planCode nor addonCode — cannot grant.`);
      throw new Error(`Order ${cashfreeOrderId} has no planCode or addonCode to grant`);
    }

    const snapshotted = await tx.order.update({
      where: { cashfreeOrderId },
      data: {
        grantSnapshot: {
          priorPlanCode: before?.planCode ?? null,
          priorStatus: before?.status ?? null,
          priorValidUntil: before?.validUntil?.toISOString() ?? null,
          priorGraceUntil: before?.graceUntil?.toISOString() ?? null,
          grantedValidUntil: granted?.validUntil?.toISOString() ?? null,
          grantedGraceUntil: granted?.graceUntil?.toISOString() ?? null,
          grantedDays,
          grantedCredits,
          creditsAheadAtGrant,
        },
      },
    });

    return { outcome: 'granted', order: snapshotted };
  }, FULFILMENT_TX_OPTIONS);

  if (result.outcome === 'already_processed') {
    const current = await prisma.order.findUnique({ where: { cashfreeOrderId } });
    if (current?.status === 'EXPIRED') {
      // A confirmed payment on an order already retired. Nothing is granted —
      // EXPIRED is terminal — but money has been taken, so a human is told.
      console.error(
        `[Billing] PAID AFTER EXPIRY — order ${cashfreeOrderId} (tenant ${current.tenantId}, ` +
          `${current.planCode || current.addonCode}) received a confirmed payment after it was expired. ` +
          'Nothing was granted. MANUAL ACTION: refund it, or grant it by hand.'
      );
      await alertBillingOps('paidAfterExpiry', {
        cashfreeOrderId,
        tenantId: current.tenantId,
        item: current.planCode || current.addonCode,
        amount: current.amount,
        currency: current.currency,
        cfPaymentId: payment?.cf_payment_id ?? null,
      });
      return { outcome: 'paid_after_expiry', order: current };
    }
    console.log(`[Billing] Order ${cashfreeOrderId} already fulfilled — no-op.`);
    return { outcome: 'already_processed', order: current || existing };
  }

  for (const run of afterCommit) await run();

  const { order } = result;
  if (order.addonCode === 'extra_ig_account') {
    // Instagram account limits are not enforced at connect, so a tenant can
    // already be over the included count when buying a slot. Stamp it now if so.
    await entitlementService.recordInstagramSlotUsage(order.tenantId);
  }
  if (order.planCode) {
    // A purchase can end a stretch with no entitlement (a lapsed trial, or an
    // expired plan). Re-queue the DMs that were skipped meanwhile — after the
    // grant has committed, and never throwing: the order is already PAID.
    await recoverSkippedMessages(order.tenantId, { trigger: `plan_grant:${order.planCode.toLowerCase()}` });
  }

  console.log(`[Billing] Fulfilled order ${cashfreeOrderId} for tenant ${order.tenantId} (${order.planCode || order.addonCode}), region evidence: ${source}.`);
  return { outcome: 'granted', order };
}

module.exports = {
  fulfillPaidOrder,
  recordPaymentAttempt,
  inferPaymentCountry,
  countryToBillingRegion,
  DOMESTIC_ONLY_PAYMENT_GROUPS,
};
