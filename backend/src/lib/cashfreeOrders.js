/**
 * Cashfree Payment Gateway helper (one-time add-on DM credit purchases).
 *
 * Uses the Create Order endpoint (POST /pg/orders). Independently confirmed
 * against Cashfree's current docs (Aug 2026) rather than assumed from
 * Phase 3's Subscriptions integration:
 *   - order_amount is decimal RUPEES, same convention as Subscriptions
 *     (confirmed separately, not carried over by assumption).
 *   - order_id allows only 45 chars (alphanumeric/underscore/hyphen) —
 *     much shorter than subscription_id's 250, which is why the addon
 *     pack is encoded as a single-digit code (see lib/addonPacks.js)
 *     rather than a descriptive slug.
 *   - The webhook idempotency signal for this product could not be
 *     confirmed with full confidence: Cashfree's general webhook docs
 *     describe a cross-product `x-idempotency-header`, but the
 *     Payments-specific idempotency guidance instead recommends deduping
 *     on the payload's own cf_payment_id, with no header mentioned. The
 *     webhook handler uses the header when present and falls back to
 *     cf_payment_id — see routes/cashfreeWebhooks.js.
 */

const axios = require('axios');
const { getBaseUrl, paiseToRupees } = require('./cashfree');

const API_VERSION = '2026-01-01';

/** Thrown by parseAddonOrderId for an unparseable id — distinct from a DB/transient failure. */
class MalformedAddonOrderIdError extends Error {}

/** Thrown by parseRenewalOrderId for an unparseable id — same reasoning as MalformedAddonOrderIdError. */
class MalformedRenewalOrderIdError extends Error {}

function buildAddonOrderId(subscriptionRowId, packCode) {
  return `ao_${subscriptionRowId}_${packCode}`;
}

/** Inverse of buildAddonOrderId. Throws MalformedAddonOrderIdError on an unrecognized shape. */
function parseAddonOrderId(orderId) {
  const parts = String(orderId || '').split('_');
  if (parts.length !== 3 || parts[0] !== 'ao') {
    throw new MalformedAddonOrderIdError(`Unrecognized Cashfree add-on order_id shape: ${orderId}`);
  }
  return { subscriptionRowId: parts[1], packCode: parts[2] };
}

/**
 * Manual-renewal order id — used when CASHFREE_SUBSCRIPTIONS_ENABLED is
 * false and a plan purchase/renewal goes through a one-time PG order
 * instead of Subscriptions autopay. Mirrors buildAddonOrderId's shape
 * (prefix_uuid_code).
 *
 * order_id's 45-char limit doesn't leave room for the full plan slug
 * alongside the 36-char subscription UUID — "mr_<uuid>_growth" is 46 chars
 * and "mr_<uuid>_starter" is 47, both already over the limit before
 * anything else is added. Same constraint that forced add-on packs onto a
 * single-digit code instead of a descriptive slug (lib/addonPacks.js), so
 * plan slugs are mapped to a one-character code here too. Callers still
 * pass/receive the real slug — this mapping is internal to the encoding.
 */
const RENEWAL_PLAN_CODES = { starter: 's', growth: 'g' };
const RENEWAL_PLAN_SLUGS_BY_CODE = { s: 'starter', g: 'growth' };

function buildRenewalOrderId(subscriptionRowId, planSlug) {
  const code = RENEWAL_PLAN_CODES[planSlug];
  if (!code) throw new Error(`No renewal order-id code defined for plan slug "${planSlug}"`);
  return `mr_${subscriptionRowId}_${code}`;
}

/** Inverse of buildRenewalOrderId. Throws MalformedRenewalOrderIdError on an unrecognized shape or plan code. */
function parseRenewalOrderId(orderId) {
  const parts = String(orderId || '').split('_');
  if (parts.length !== 3 || parts[0] !== 'mr') {
    throw new MalformedRenewalOrderIdError(`Unrecognized Cashfree renewal order_id shape: ${orderId}`);
  }
  const planSlug = RENEWAL_PLAN_SLUGS_BY_CODE[parts[2]];
  if (!planSlug) {
    throw new MalformedRenewalOrderIdError(`Unrecognized renewal plan code in order_id: ${orderId}`);
  }
  return { subscriptionRowId: parts[1], planSlug };
}

/**
 * Create a one-time Cashfree order. Generalized from Phase 4's add-on-pack-
 * specific version: callers now build their own order_id (via
 * buildAddonOrderId or buildRenewalOrderId) and pass the amount/note
 * directly, so both add-on purchases and manual-renewal payments share this
 * one HTTP call without this function knowing which kind of order it is.
 */
async function createOrder({ orderId, amountInPaise, orderNote, customerId, customerEmail, customerPhone, returnUrl }) {
  const clientId = process.env.CASHFREE_PG_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_PG_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('CASHFREE_PG_CLIENT_ID/CLIENT_SECRET are not configured');
  }

  const orderAmountRupees = paiseToRupees(amountInPaise);

  const response = await axios.post(
    `${getBaseUrl()}/pg/orders`,
    {
      order_id: orderId,
      order_amount: orderAmountRupees,
      order_currency: 'INR',
      customer_details: {
        customer_id: customerId,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      },
      order_meta: {
        return_url: returnUrl,
        notify_url: `${process.env.BACKEND_URL}/webhooks/cashfree/pg`,
      },
      order_note: orderNote,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': API_VERSION,
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-idempotency-key': orderId,
      },
      timeout: 15000,
    }
  );

  return response.data; // { cf_order_id, order_id, payment_session_id, order_status, ... }
}

module.exports = {
  createOrder,
  buildAddonOrderId,
  parseAddonOrderId,
  MalformedAddonOrderIdError,
  buildRenewalOrderId,
  parseRenewalOrderId,
  MalformedRenewalOrderIdError,
};
