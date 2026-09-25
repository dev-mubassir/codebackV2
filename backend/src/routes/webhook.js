/**
 * Webhook routes — handles incoming Instagram webhook events.
 *
 * Meta sends all DM events to a single webhook endpoint. We identify which
 * Codeback user owns the account via entry.id (the IG User ID), persist the
 * message immediately, and queue AI analysis to run in the background — the
 * webhook itself must stay fast and must never block on AI inference.
 *
 * Important: The raw body must be available for signature verification.
 * The main server passes `req.rawBody` for this purpose.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const deliveries = require('../services/webhookDeliveries');
const { isShuttingDown } = require('../lib/health');
const isProduction = process.env.NODE_ENV === 'production';

// Kept for backwards compatibility with index.js — Socket.io is now
// accessed through lib/socket.js everywhere, so this is a no-op shim.
function setSocketIO() {}

// ============================================
// GET /webhook & GET /webhooks/instagram
// Webhook verification endpoint (Meta sends this to verify your endpoint)
// ============================================
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('[Webhook] Verification request received:', { mode, token: token ? '***' : undefined });

  const expected = process.env.WEBHOOK_VERIFY_TOKEN;

  // FAIL CLOSED ON AN UNSET TOKEN. The old comparison was a plain `===`, so
  // with WEBHOOK_VERIFY_TOKEN unset a request carrying no hub.verify_token
  // evaluated `undefined === undefined` -> true, and any Meta app could
  // complete the subscription handshake against this endpoint.
  if (!expected) {
    console.error('[Webhook] WEBHOOK_VERIFY_TOKEN is not set — refusing to verify.');
    return res.status(503).send('Verification is not configured');
  }

  // Timing-safe, matching the POST path. The GET token is a low-value one-shot
  // handshake secret, but there is no reason for the two paths to disagree.
  const provided = typeof token === 'string' ? token : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const tokenMatches = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (mode === 'subscribe' && tokenMatches) {
    console.log('[Webhook] Verified successfully with Meta!');
    // Coerce to a string: `?hub.challenge=a&hub.challenge=b` arrives as an
    // array, and res.send(array) returns JSON where Meta expects a plain echo.
    return res.status(200).send(String(challenge ?? ''));
  }

  console.warn('[Webhook] Verification failed — token mismatch or invalid mode.');
  return res.status(403).send('Verification failed');
});

// ============================================
// POST /webhook & POST /webhooks/instagram
// Receive incoming webhook events (messages, reactions, read receipts)
// ============================================
router.post('/', async (req, res) => {
  const signatureHeader = req.headers['x-hub-signature-256'];

  if (!verifySignature(req.rawBody, signatureHeader)) {
    console.warn('[Webhook] Rejected request: invalid or missing X-Hub-Signature-256.');
    return res.status(401).send('Invalid signature');
  }

  // ------------------------------------------------------------------
  // SAVE, THEN ACKNOWLEDGE (zero missed DMs — services/webhookDeliveries.js).
  //
  // The signed raw body is written to webhook_deliveries BEFORE Meta gets its
  // 200. Until this change the 200 went out first and only a hash was kept, so
  // a crash or redeploy mid-processing lost the DM for good: Meta had been
  // told "received" and never retried.
  //
  //   saved             -> 200, then dispatch (queue, or in-process fallback)
  //   already saved     -> 200 (a Meta retry; queue/sweep own it)
  //   database failure  -> 503, so Meta retries later
  //   shutting down     -> 503, so Meta retries on a live instance
  //
  // The body hash doubles as delivery-level idempotency (a retry of the same
  // bytes is one row); Message.igMessageId is the per-message guard.
  // ------------------------------------------------------------------
  if (isShuttingDown()) {
    return res.status(503).send('Shutting down, retry');
  }

  let delivery;
  try {
    delivery = await deliveries.store(req.rawBody || Buffer.from(JSON.stringify(req.body || {})));
  } catch (err) {
    console.error('[Webhook] Could not save the delivery; answering 503 so Meta retries:', err.message);
    return res.status(503).send('Temporarily unavailable');
  }

  res.status(200).send('EVENT_RECEIVED');

  if (delivery.duplicate) {
    console.log('[Webhook] Duplicate delivery acknowledged (already stored).');
    return;
  }
  await deliveries.dispatch(delivery.id);
});

/**
 * Verify the X-Hub-Signature-256 header to ensure the request came from Meta.
 */
function verifySignature(rawBody, signatureHeader) {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;

  // Without a configured secret we cannot verify anything. Never fall back to
  // an empty HMAC key — that key is attacker-known and lets anyone forge a
  // valid signature. Reject (except the explicit non-production test hatch).
  if (!appSecret) {
    if (process.env.SKIP_SIGNATURE_VERIFICATION === 'true' && !isProduction) {
      console.warn('[Webhook] INSTAGRAM_APP_SECRET unset — allowed only because SKIP_SIGNATURE_VERIFICATION=true in non-production.');
      return true;
    }
    console.error('[Webhook] Rejected: INSTAGRAM_APP_SECRET is not configured; cannot verify signatures.');
    return false;
  }

  if (!signatureHeader || !rawBody) {
    // Development/testing escape hatch — STRUCTURALLY BLOCKED in production
    if (process.env.SKIP_SIGNATURE_VERIFICATION === 'true' && !isProduction) {
      console.warn('[Webhook] Missing signature/raw body — allowed because SKIP_SIGNATURE_VERIFICATION=true in non-production.');
      return true;
    }
    console.warn('[Webhook] Missing signature or raw body.');
    return false;
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const provided = Buffer.from(signatureHeader);
  const expected = Buffer.from(expectedSignature);

  // Buffers of different lengths would make timingSafeEqual throw instead of
  // returning false — guard against that first.
  if (provided.length !== expected.length) {
    if (process.env.SKIP_SIGNATURE_VERIFICATION === 'true' && !isProduction) {
      console.warn('[Webhook] Signature length mismatch — allowed because SKIP_SIGNATURE_VERIFICATION=true in non-production.');
      return true;
    }
    return false;
  }

  const isValid = crypto.timingSafeEqual(provided, expected);
  if (!isValid && process.env.SKIP_SIGNATURE_VERIFICATION === 'true' && !isProduction) {
    console.warn('[Webhook] Signature mismatch — allowed because SKIP_SIGNATURE_VERIFICATION=true in non-production.');
    return true;
  }

  return isValid;
}

module.exports = router;
module.exports.setSocketIO = setSocketIO;
