/**
 * Shared Cashfree helpers: base URL selection and webhook signature
 * verification. Adapted from the reverted feat(billing) commit (0a47627,
 * see git history) — that code's signature scheme was independently
 * confirmed against Cashfree's docs one month before this file was written
 * (https://www.cashfree.com/docs/api-reference/vrs/webhook-signature-verification:
 * "Generate an HMAC-SHA256 hash of this string using your client secret"),
 * and is stable enough (this exact mechanism, unchanged for years) that it
 * is reused here rather than re-derived. Re-confirm against current docs if
 * Cashfree ever announces a signing change.
 *
 * ONE secret, not two: Cashfree signs webhooks with your CLIENT SECRET
 * (CASHFREE_SECRET_KEY), the same value used for API auth — there is no
 * separate webhook-specific signing secret to configure in the dashboard.
 */

const crypto = require('crypto');

const CASHFREE_HOSTS = Object.freeze({
  sandbox: 'https://sandbox.cashfree.com',
  production: 'https://api.cashfree.com',
});

/**
 * Which Cashfree environment to call: 'sandbox' or 'production'.
 *
 * CASHFREE_ENV decides it when set to exactly one of those two words;
 * otherwise NODE_ENV does (production -> production, anything else ->
 * sandbox), which is what this always did.
 *
 * WHY THE OVERRIDE EXISTS: running the production site against Cashfree's
 * TEST account — real app, test cards, no real money — before the live
 * account is activated. Without it a production deploy always called the live
 * API, and sandbox keys failed there with an opaque `authentication_error`.
 *
 * The browser side must agree: a payment_session_id minted on sandbox cannot
 * be opened in production mode. frontend useCheckout.js reads
 * NEXT_PUBLIC_CASHFREE_MODE the same way, so set both together.
 *
 * Read at call time, like billingFlags.js, so the setting is honoured without
 * a code change and is testable.
 */
function cashfreeEnvironment() {
  const override = (process.env.CASHFREE_ENV || '').trim().toLowerCase();
  if (override === 'sandbox' || override === 'production') return override;
  return process.env.NODE_ENV === 'production' ? 'production' : 'sandbox';
}

/** Cashfree's sandbox and production API hosts differ; never mix them. */
function getBaseUrl() {
  return CASHFREE_HOSTS[cashfreeEnvironment()];
}

/**
 * Verify a Cashfree webhook signature.
 *
 * HMAC-SHA256 of (x-webhook-timestamp + raw body), keyed with the client
 * secret, Base64-encoded, compared against x-webhook-signature. Must use
 * the raw body — parsing and re-serializing JSON can alter decimal
 * formatting and break the signature.
 */
function verifyWebhookSignature(rawBody, signatureHeader, timestampHeader, secret) {
  if (!secret) {
    console.error('[Cashfree] Rejected webhook: no client secret configured.');
    return false;
  }
  if (!signatureHeader || !timestampHeader || !rawBody) {
    console.warn('[Cashfree] Rejected webhook: missing signature, timestamp, or raw body.');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(timestampHeader + rawBody)
    .digest('base64');

  const provided = Buffer.from(signatureHeader);
  const expected = Buffer.from(expectedSignature);

  // Buffers of different lengths make timingSafeEqual throw instead of
  // returning false — guard against that first, same as webhook.js.
  if (provided.length !== expected.length) return false;

  return crypto.timingSafeEqual(provided, expected);
}

/**
 * Convert our internal smallest-currency-unit storage (paise for INR, cents
 * for USD — both 2-decimal currencies) to the decimal amount Cashfree's
 * Orders API expects (e.g. 49900 -> 499.00). Currency-agnostic: dividing by
 * 100 is correct for any 2-decimal currency, which is all Siffty supports
 * (INR, USD) — this is not INR-specific despite the old code's name
 * (paiseToRupees), hence the rename.
 */
function smallestUnitToDecimal(amount) {
  return Number((amount / 100).toFixed(2));
}

module.exports = { getBaseUrl, cashfreeEnvironment, verifyWebhookSignature, smallestUnitToDecimal };
