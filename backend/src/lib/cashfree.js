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
 * Replay window for signed webhooks: ±5 minutes around x-webhook-timestamp.
 *
 * LOG-ONLY for now. The signature covers the timestamp, so a stale timestamp
 * means a replayed (or long-retried) delivery — but Cashfree RETRIES failed
 * deliveries, and until sandbox shows whether a retry carries the original
 * timestamp or a fresh one, rejecting on age could drop a genuine late retry.
 * Fulfilment is idempotent (the CREATED -> PAID guard), so a replay cannot
 * grant twice either way. Flip WEBHOOK_TIMESTAMP_ENFORCE=true once confirmed.
 *
 * Accepts epoch seconds or milliseconds. Returns the skew in ms (or null if
 * the header is not a number) and whether it is inside the window.
 */
const WEBHOOK_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

function checkWebhookTimestamp(timestampHeader, now = Date.now()) {
  const raw = Number(String(timestampHeader ?? '').trim());
  if (!Number.isFinite(raw) || raw <= 0) return { withinWindow: false, skewMs: null };
  const ms = raw < 1e12 ? raw * 1000 : raw;
  const skewMs = now - ms;
  return { withinWindow: Math.abs(skewMs) <= WEBHOOK_TIMESTAMP_WINDOW_MS, skewMs };
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

/**
 * Keys whose values are identifiers, never quantities. Cashfree types these
 * inconsistently — in the sandbox run on 15 September 2026 the same payment
 * webhook arrived twice, once with cf_payment_id as a JSON number and once as a
 * string — so an integer under one of these keys is always read as a string,
 * whatever its size, and callers compare one type.
 */
const CASHFREE_ID_KEY = /^(?:[a-z0-9_]*_id|utr|[a-z0-9_]*_utr|[a-z0-9_]*arn|rrn|[a-z0-9_]*reference|[a-z0-9_]*_number)$/;

const NUMBER_TOKEN = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/**
 * Rewrite JSON text so that no integer can lose digits when parsed.
 *
 * A string-aware scan, not a regex over the whole text: it never touches digits,
 * colons or braces inside string values, and it sees integers inside arrays and
 * nested objects. An integer literal is quoted when
 *   - it is not a safe JavaScript integer (beyond ±2^53), under ANY key or
 *     inside an array, or
 *   - it is the value of an id-like key (CASHFREE_ID_KEY).
 * Decimals, exponents, amounts and every other number are left alone.
 */
function quoteUnsafeIntegers(text) {
  const src = String(text);
  let out = '';
  let i = 0;
  let lastString = null; // raw text of the most recent string token, for key detection
  let valueKey = null; // the key whose value comes next, set at ':'

  while (i < src.length) {
    const ch = src[i];

    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      lastString = src.slice(i, j + 1);
      out += lastString;
      i = j + 1;
      continue;
    }

    if (ch === ':') {
      try {
        valueKey = JSON.parse(lastString);
      } catch {
        valueKey = null;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      NUMBER_TOKEN.lastIndex = i;
      const match = NUMBER_TOKEN.exec(src);
      if (match) {
        const token = match[0];
        const integer = /^-?\d+$/.test(token);
        const quote =
          integer && (!Number.isSafeInteger(Number(token)) || (typeof valueKey === 'string' && CASHFREE_ID_KEY.test(valueKey)));
        out += quote ? `"${token}"` : token;
        i += token.length;
        valueKey = null;
        continue;
      }
    }

    // Structure ends whatever value a key was waiting for.
    if (ch === '{' || ch === '[' || ch === ',' || ch === '}' || ch === ']') valueKey = null;
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Parse a Cashfree JSON body without losing digits in its ids.
 *
 * WHY. Cashfree ids exceed Number.MAX_SAFE_INTEGER, and JSON.parse rounds them
 * silently: the payment webhook in the sandbox end-to-end run on 15 September
 * 2026 sent cf_payment_id as the number 1453353814355098112, which parsed as
 * 1453353814355098000 — one payment was recorded as two attempts. The digits
 * cannot be recovered after parsing, so the text is rewritten first
 * (quoteUnsafeIntegers): every unsafe integer anywhere, and every id-like field,
 * arrives as an exact string. docs/BILLING.md lists every field audited.
 *
 * Signature verification still runs over the untouched raw bytes; this is only
 * how the verified body is read. Throws on invalid JSON, like JSON.parse.
 */
function parseCashfreeJson(text) {
  return JSON.parse(quoteUnsafeIntegers(text));
}

/** axios transformResponse using parseCashfreeJson; leaves non-JSON bodies as they are. */
function cashfreeResponseParser(data) {
  if (typeof data !== 'string' || data.length === 0) return data;
  try {
    return parseCashfreeJson(data);
  } catch {
    return data;
  }
}

module.exports = {
  checkWebhookTimestamp,
  WEBHOOK_TIMESTAMP_WINDOW_MS,
  getBaseUrl,
  cashfreeEnvironment,
  verifyWebhookSignature,
  smallestUnitToDecimal,
  parseCashfreeJson,
  cashfreeResponseParser,
  CASHFREE_ID_KEY,
};
