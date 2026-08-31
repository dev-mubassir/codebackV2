/**
 * Cashfree Subscriptions API helper (recurring plan billing).
 *
 * Uses the "Create Subscription Mandate" endpoint (POST /pg/subscriptions,
 * x-api-version 2026-01-01 — confirmed against Cashfree's current docs,
 * Aug 2026, not assumed from memory). Amounts are decimal RUPEES, not
 * paise — Cashfree's convention differs from Razorpay/Stripe here, and
 * getting this wrong would over/under-charge by 100x.
 *
 * The merchant-supplied subscription_id encodes our own Subscription row's
 * id and the purchased plan's slug (e.g. "cb_<subscriptionRowId>_growth"),
 * so the webhook handler can resolve which tenant/plan a payment belongs to
 * without a separate pending-checkout table (none was authorized for this
 * phase — see Phase 1b, which dropped the original AddonPurchase model).
 * Plan slugs never contain underscores, so this is unambiguous to parse.
 */

const axios = require('axios');
const { getBaseUrl, paiseToRupees } = require('./cashfree');

const API_VERSION = '2026-01-01';

/** Thrown by parseMerchantSubscriptionId for an unparseable id — distinct from a DB/transient failure, so callers can tell "will never succeed" from "retry later." */
class MalformedSubscriptionIdError extends Error {}

function buildMerchantSubscriptionId(subscriptionRowId, planSlug) {
  return `cb_${subscriptionRowId}_${planSlug}`;
}

/** Inverse of buildMerchantSubscriptionId. Throws MalformedSubscriptionIdError on an unrecognized shape. */
function parseMerchantSubscriptionId(merchantSubscriptionId) {
  const parts = String(merchantSubscriptionId || '').split('_');
  if (parts.length !== 3 || parts[0] !== 'cb') {
    throw new MalformedSubscriptionIdError(`Unrecognized Cashfree subscription_id shape: ${merchantSubscriptionId}`);
  }
  return { subscriptionRowId: parts[1], planSlug: parts[2] };
}

/**
 * Advance `from` by one plan interval. Only 'monthly' exists today (Starter
 * and Growth are both seeded that way) — fail loud on anything else rather
 * than silently miscalculating a billing-critical date.
 */
function computeNextPeriodEnd(from, interval) {
  const end = new Date(from);
  if (interval === 'monthly') {
    end.setMonth(end.getMonth() + 1);
  } else {
    throw new Error(`Unsupported plan interval for period calculation: ${interval}`);
  }
  return end;
}

/**
 * Create a Cashfree subscription (mandate) for a plan purchase.
 *
 * `plan` is our own Plan row (priceInPaise/interval), not Cashfree's. The
 * plan is defined inline on the request rather than pre-created as a
 * reusable Cashfree plan object — simpler for a small fixed set of tiers,
 * and explicitly supported ("plan_id... otherwise define plan inline").
 */
async function createSubscription({ subscriptionRowId, plan, customerName, customerEmail, customerPhone, returnUrl }) {
  const clientId = process.env.CASHFREE_SUBSCRIPTIONS_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_SUBSCRIPTIONS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('CASHFREE_SUBSCRIPTIONS_CLIENT_ID/CLIENT_SECRET are not configured');
  }
  if (plan.interval !== 'monthly') {
    throw new Error(`Cannot create a Cashfree subscription for non-monthly plan "${plan.slug}"`);
  }

  const merchantSubscriptionId = buildMerchantSubscriptionId(subscriptionRowId, plan.slug);
  const planAmountRupees = paiseToRupees(plan.priceInPaise);
  // Nominal mandate-authorization charge, auto-refunded. This is NOT the
  // plan price — the real recurring charge is a separate CHARGE-type
  // payment that arrives later via webhook.
  const authorizationAmountRupees = 1;

  const response = await axios.post(
    `${getBaseUrl()}/pg/subscriptions`,
    {
      subscription_id: merchantSubscriptionId,
      customer_details: {
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      },
      plan_details: {
        plan_name: plan.name,
        plan_type: 'PERIODIC',
        plan_currency: 'INR',
        plan_amount: planAmountRupees,
        // Required by Cashfree — the ceiling a single charge on this plan
        // may ever reach. Starter/Growth are fixed-price, so the charge
        // should never exceed plan_amount itself; equal, not higher.
        plan_max_amount: planAmountRupees,
        plan_intervals: 1,
        plan_interval_type: 'MONTH',
        // plan_max_cycles intentionally omitted — recurs until cancelled.
      },
      authorization_details: {
        authorization_amount: authorizationAmountRupees,
        authorization_amount_refund: true,
        payment_methods: ['upi', 'card'],
      },
      subscription_meta: {
        return_url: returnUrl,
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': API_VERSION,
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-idempotency-key': merchantSubscriptionId,
      },
      timeout: 15000,
    }
  );

  return response.data; // { cf_subscription_id, subscription_id, subscription_session_id, subscription_status, ... }
}

module.exports = {
  createSubscription,
  buildMerchantSubscriptionId,
  parseMerchantSubscriptionId,
  computeNextPeriodEnd,
  MalformedSubscriptionIdError,
};
