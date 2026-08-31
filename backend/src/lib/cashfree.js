/**
 * Shared Cashfree helpers: base URL selection and webhook signature
 * verification. Both the Subscriptions and Payment Gateway products use the
 * identical verification algorithm (confirmed against Cashfree's current
 * docs, Aug 2026) — only the secret differs per product. Route-specific
 * logic (request shapes, event handling) lives in cashfreeSubscriptions.js
 * and cashfreeOrders.js, not here.
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
 * Per Cashfree's current docs: HMAC-SHA256 of (x-webhook-timestamp + raw
 * body), keyed with the webhook secret, Base64-encoded, compared against
 * x-webhook-signature. Must use the raw body — parsing and re-serializing
 * JSON can alter decimal formatting and break the signature.
 */
function verifyWebhookSignature(rawBody, signatureHeader, timestampHeader, secret) {
  if (!secret) {
    console.error('[Cashfree] Rejected webhook: no webhook secret configured.');
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
 * Convert paise (our internal storage unit, matching priceInPaise) to the
 * decimal-rupee amount Cashfree's APIs expect (e.g. 49900 -> 499.00).
 * Routed through one place so every call site rounds the same way instead
 * of duplicating raw division that could drift on floating-point edges.
 */
function paiseToRupees(paise) {
  return Number((paise / 100).toFixed(2));
}

module.exports = { getBaseUrl, verifyWebhookSignature, paiseToRupees };
