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

/**
 * Payment methods that are India-only by construction — UPI, netbanking,
 * and India-specific BNPL/wallet rails carry no "country" field in
 * Cashfree's payload because there is only ever one possible country.
 * Confirmed against the reverted code's PG webhook handler for the payload
 * shape (`data.payment.payment_group`, `data.payment.payment_status`) —
 * NOT independently re-confirmed against current docs this session; see
 * the Gate 3 report for why (doc search was unavailable) and re-verify
 * `card_country`'s exact field name before this handles real money.
 */
const DOMESTIC_ONLY_PAYMENT_GROUPS = ['upi', 'net_banking', 'nb', 'app', 'paylater', 'cardless_emi', 'banktransfer'];

/**
 * Best-effort country inference from a webhook/order-fetch payment object.
 * Returns an ISO country code or null if genuinely unknown — callers fall
 * back to the order's own currency (chosen by the customer at checkout from
 * real regional pricing) rather than guessing further here.
 */
function inferPaymentCountry(payment) {
  const group = payment?.payment_group;
  if (group && DOMESTIC_ONLY_PAYMENT_GROUPS.includes(group)) return 'IN';

  const cardCountry = payment?.payment_method?.card?.card_country;
  if (cardCountry) return cardCountry;

  return null;
}

/** IN-or-INTL, from an inferred country code or (failing that) the order's own currency. */
function resolveBillingRegion({ inferredCountry, orderCurrency }) {
  if (inferredCountry) return inferredCountry === 'IN' ? 'IN' : 'INTL';
  return orderCurrency === 'INR' ? 'IN' : 'INTL';
}

/**
 * Mark an Order PAID and grant its plan/add-on, exactly once, ever.
 *
 * @param {string} cashfreeOrderId  our own merchant order_id
 * @param {object} payment          the webhook/order-fetch `payment` object, for country inference (may be partial or absent)
 * @param {string} rawPayload       raw JSON to store on the Order row for reconciliation/audit
 * @returns {{ outcome: 'granted'|'already_processed'|'not_found'|'not_success', order?: object }}
 */
async function fulfillPaidOrder({ cashfreeOrderId, payment, rawPayload }) {
  const existing = await prisma.order.findUnique({ where: { cashfreeOrderId } });
  if (!existing) {
    console.warn(`[Billing] Fulfillment requested for unknown order ${cashfreeOrderId} — ignoring.`);
    return { outcome: 'not_found' };
  }

  // The conditional update IS the idempotency guard.
  const claimed = await prisma.order.updateMany({
    where: { cashfreeOrderId, status: 'CREATED' },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      paymentCountry: inferPaymentCountry(payment),
      rawPayload,
    },
  });

  if (claimed.count === 0) {
    console.log(`[Billing] Order ${cashfreeOrderId} already fulfilled — no-op.`);
    return { outcome: 'already_processed', order: existing };
  }

  const order = await prisma.order.findUnique({ where: { cashfreeOrderId } });
  const billingRegion = resolveBillingRegion({
    inferredCountry: inferPaymentCountry(payment),
    orderCurrency: order.currency,
  });

  if (order.planCode) {
    await entitlementService.grantPlan(order.tenantId, order.planCode, {
      billingRegion,
      currency: order.currency,
    });
  } else if (order.addonCode) {
    await entitlementService.grantAddon(order.tenantId, order.addonCode);
  } else {
    // Schema allows neither to be set only through a bug elsewhere — the
    // checkout path (routes/billing.js) always sets exactly one. Fail loud
    // rather than silently taking someone's money and granting nothing.
    console.error(`[Billing] Order ${cashfreeOrderId} has neither planCode nor addonCode — cannot grant.`);
    throw new Error(`Order ${cashfreeOrderId} has no planCode or addonCode to grant`);
  }

  console.log(`[Billing] Fulfilled order ${cashfreeOrderId} for tenant ${order.tenantId} (${order.planCode || order.addonCode}).`);
  return { outcome: 'granted', order };
}

module.exports = { fulfillPaidOrder, inferPaymentCountry, resolveBillingRegion, DOMESTIC_ONLY_PAYMENT_GROUPS };
