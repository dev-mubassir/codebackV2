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

const isProduction = process.env.NODE_ENV === 'production';

/** Cashfree's sandbox and production API hosts differ; never mix them. */
function getBaseUrl() {
  return isProduction ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
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

module.exports = { getBaseUrl, verifyWebhookSignature, smallestUnitToDecimal };
