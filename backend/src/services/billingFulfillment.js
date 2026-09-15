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

  const cardCountry = payment?.payment_method?.card?.card_country;
  if (cardCountry) {
    return { country: cardCountry, source: 'CARD_COUNTRY' };
  }

  return { country: null, source: 'UNVERIFIED' };
}

/** IN-or-INTL from a country code. Only ever called with RAIL_INFERRED/CARD_COUNTRY evidence — never for UNVERIFIED, which has no country to convert. */
function countryToBillingRegion(country) {
  return country === 'IN' ? 'IN' : 'INTL';
}

/**
 * Mark an Order PAID and grant its plan/add-on, exactly once, ever.
 *
 * @param {string} cashfreeOrderId  our own merchant order_id
 * @param {object} payment          the webhook/order-fetch `payment` object, for region evidence (may be partial or absent)
 * @param {string} rawPayload       raw JSON to store on the Order row for reconciliation/audit
 * @returns {{ outcome: 'granted'|'already_processed'|'not_found'|'not_success', order?: object }}
 */
async function fulfillPaidOrder({ cashfreeOrderId, payment, rawPayload }) {
  const existing = await prisma.order.findUnique({ where: { cashfreeOrderId } });
  if (!existing) {
    console.warn(`[Billing] Fulfillment requested for unknown order ${cashfreeOrderId} — ignoring.`);
    return { outcome: 'not_found' };
  }

  const { country, source } = inferPaymentCountry(payment);

  // The conditional update IS the idempotency guard.
  const claimed = await prisma.order.updateMany({
    where: { cashfreeOrderId, status: 'CREATED' },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      paymentCountry: country,
      regionSource: source,
      rawPayload,
    },
  });

  if (claimed.count === 0) {
    console.log(`[Billing] Order ${cashfreeOrderId} already fulfilled — no-op.`);
    return { outcome: 'already_processed', order: existing };
  }

  const order = await prisma.order.findUnique({ where: { cashfreeOrderId } });

  // UNVERIFIED carries no billingRegion/currency at all — grantPlan's own
  // `existing?.x || region.x` merge then leaves an unlocked tenant unlocked
  // (null || null = null) and never overwrites an already-locked one
  // (existing wins outright). See entitlementService.grantPlan and the
  // Entitlement schema comment.
  const billingRegion = source === 'UNVERIFIED' ? null : countryToBillingRegion(country);
  const currency = billingRegion ? order.currency : null;

  if (order.planCode) {
    await entitlementService.grantPlan(order.tenantId, order.planCode, {
      billingRegion,
      currency,
      regionSource: source,
    });
    // A purchase can end a stretch with no entitlement (a lapsed trial, or an
    // expired plan). Re-queue the DMs that were skipped meanwhile — after the
    // grant has committed, and never throwing: the order is already PAID.
    await recoverSkippedMessages(order.tenantId, { trigger: `plan_grant:${order.planCode.toLowerCase()}` });
  } else if (order.addonCode) {
    await entitlementService.grantAddon(order.tenantId, order.addonCode);
  } else {
    // Schema allows neither to be set only through a bug elsewhere — the
    // checkout path (routes/billing.js) always sets exactly one. Fail loud
    // rather than silently taking someone's money and granting nothing.
    console.error(`[Billing] Order ${cashfreeOrderId} has neither planCode nor addonCode — cannot grant.`);
    throw new Error(`Order ${cashfreeOrderId} has no planCode or addonCode to grant`);
  }

  console.log(`[Billing] Fulfilled order ${cashfreeOrderId} for tenant ${order.tenantId} (${order.planCode || order.addonCode}), region evidence: ${source}.`);
  return { outcome: 'granted', order };
}

module.exports = { fulfillPaidOrder, inferPaymentCountry, countryToBillingRegion, DOMESTIC_ONLY_PAYMENT_GROUPS };
