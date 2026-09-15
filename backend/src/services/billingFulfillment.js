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
 * Order statuses a confirmed payment may still claim.
 *
 * FAILED is here on purpose. It records that a payment ATTEMPT failed, not that
 * the order is dead: Cashfree lets a customer retry payment on the same order,
 * and if FAILED were terminal that retry would take money and grant nothing.
 * EXPIRED is the terminal state — see the paid-after-expiry branch below.
 */
const CLAIMABLE_STATUSES = ['CREATED', 'FAILED'];

/**
 * Generous bounds for the fulfilment transaction. A retry storm queues every
 * concurrent delivery behind the first one's row lock on the order, and each
 * waiter needs a pooled connection meanwhile; Prisma's defaults (2s wait, 5s
 * run) would turn that queue into spurious 500s. A 500 is safe — nothing
 * commits — but it is noise Cashfree then has to retry.
 */
const FULFILMENT_TX_OPTIONS = { maxWait: 15_000, timeout: 20_000 };

/**
 * Mark an Order PAID and grant its plan/add-on, exactly once, ever.
 *
 * ONE TRANSACTION. Marking the order PAID and granting what it bought commit or
 * roll back together. They used to be two separate writes: a failure between
 * them left the order PAID with nothing granted, the webhook returned 500, and
 * Cashfree's retry then found the order already PAID and granted nothing —
 * money taken, nothing delivered, and nothing left that would ever retry it.
 * tests/cashfree-webhook-edge-cases.test.js (Gate 9.5) pins this.
 *
 * Emails and skipped-message recovery run only AFTER the commit: neither may
 * describe or act on a grant that then rolled back.
 *
 * @param {string} cashfreeOrderId  our own merchant order_id
 * @param {object} payment          the webhook/order-fetch `payment` object, for region evidence (may be partial or absent)
 * @param {string} rawPayload       raw JSON to store on the Order row for reconciliation/audit
 * @returns {{ outcome: 'granted'|'already_processed'|'not_found'|'paid_after_expiry', order?: object }}
 */
async function fulfillPaidOrder({ cashfreeOrderId, payment, rawPayload }) {
  const existing = await prisma.order.findUnique({ where: { cashfreeOrderId } });
  if (!existing) {
    console.warn(`[Billing] Fulfillment requested for unknown order ${cashfreeOrderId} — ignoring.`);
    return { outcome: 'not_found' };
  }

  const { country, source } = inferPaymentCountry(payment);
  const afterCommit = [];

  const result = await prisma.$transaction(async (tx) => {
    // The conditional update IS the idempotency guard. Concurrent deliveries
    // block on this row until the first transaction commits, then match zero
    // rows.
    const claimed = await tx.order.updateMany({
      where: { cashfreeOrderId, status: { in: CLAIMABLE_STATUSES } },
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

    // UNVERIFIED carries no billingRegion/currency at all — grantPlan's own
    // `existing?.x || region.x` merge then leaves an unlocked tenant unlocked
    // (null || null = null) and never overwrites an already-locked one
    // (existing wins outright). See entitlementService.grantPlan and the
    // Entitlement schema comment.
    const billingRegion = source === 'UNVERIFIED' ? null : countryToBillingRegion(country);
    const currency = billingRegion ? order.currency : null;

    if (order.planCode) {
      await entitlementService.grantPlan(
        order.tenantId,
        order.planCode,
        { billingRegion, currency, regionSource: source },
        { tx, afterCommit }
      );
    } else if (order.addonCode) {
      await entitlementService.grantAddon(order.tenantId, order.addonCode, { tx });
    } else {
      // Schema allows neither to be set only through a bug elsewhere — the
      // checkout path (routes/billing.js) always sets exactly one. Fail loud,
      // and roll the PAID mark back with it, rather than silently taking
      // someone's money and granting nothing.
      console.error(`[Billing] Order ${cashfreeOrderId} has neither planCode nor addonCode — cannot grant.`);
      throw new Error(`Order ${cashfreeOrderId} has no planCode or addonCode to grant`);
    }

    return { outcome: 'granted', order };
  }, FULFILMENT_TX_OPTIONS);

  if (result.outcome === 'already_processed') {
    const current = await prisma.order.findUnique({ where: { cashfreeOrderId } });
    if (current?.status === 'EXPIRED') {
      // A confirmed payment on an order the reconciliation job already retired.
      // Nothing is granted — EXPIRED is terminal — but money has been taken, so
      // this is not a quiet no-op. A human has to refund or grant by hand.
      console.error(
        `[Billing] PAID AFTER EXPIRY — order ${cashfreeOrderId} (tenant ${current.tenantId}, ` +
          `${current.planCode || current.addonCode}) received a confirmed payment after it was expired. ` +
          'Nothing was granted. MANUAL ACTION: refund it, or grant it by hand.'
      );
      return { outcome: 'paid_after_expiry', order: current };
    }
    console.log(`[Billing] Order ${cashfreeOrderId} already fulfilled — no-op.`);
    return { outcome: 'already_processed', order: current || existing };
  }

  for (const run of afterCommit) await run();

  const { order } = result;
  if (order.planCode) {
    // A purchase can end a stretch with no entitlement (a lapsed trial, or an
    // expired plan). Re-queue the DMs that were skipped meanwhile — after the
    // grant has committed, and never throwing: the order is already PAID.
    await recoverSkippedMessages(order.tenantId, { trigger: `plan_grant:${order.planCode.toLowerCase()}` });
  }

  console.log(`[Billing] Fulfilled order ${cashfreeOrderId} for tenant ${order.tenantId} (${order.planCode || order.addonCode}), region evidence: ${source}.`);
  return { outcome: 'granted', order };
}

/**
 * Record a failed payment attempt: CREATED -> FAILED, never anything else.
 *
 * Only CREATED moves. A late PAYMENT_FAILED_WEBHOOK for an order that has since
 * been paid (an earlier attempt failed, a retry succeeded, and the webhooks
 * arrived out of order) must not overwrite PAID. The payload is stored so the
 * reconciliation job can tell a real Cashfree attempt from a checkout that
 * failed before reaching Cashfree at all (routes/billing.js also writes FAILED,
 * with no payload).
 *
 * @returns {Promise<{ updated: boolean }>}
 */
async function markPaymentFailed({ cashfreeOrderId, rawPayload }) {
  const { count } = await prisma.order.updateMany({
    where: { cashfreeOrderId, status: 'CREATED' },
    data: { status: 'FAILED', rawPayload },
  });
  console.log(
    `[Billing] Payment attempt failed for order ${cashfreeOrderId} — ` +
      (count ? 'recorded as FAILED (a later successful attempt still grants).' : 'order not CREATED, left unchanged.')
  );
  return { updated: count === 1 };
}

module.exports = {
  fulfillPaidOrder,
  markPaymentFailed,
  inferPaymentCountry,
  countryToBillingRegion,
  CLAIMABLE_STATUSES,
  DOMESTIC_ONLY_PAYMENT_GROUPS,
};
