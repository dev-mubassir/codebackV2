/**
 * Cashfree webhook — one-time PG orders only, single endpoint (no separate
 * /subscriptions route; this codebase never calls the Subscriptions API).
 *
 * Deliberate difference from webhook.js (the Instagram webhook): that one
 * returns 200 immediately and processes in the background, because Meta
 * requires a fast response and eventual consistency is fine for message
 * delivery. Cashfree retries delivery until it gets a 200 — for a
 * billing-critical state change (activating a plan, crediting an add-on),
 * we want that retry safety net instead, so this handler processes
 * SYNCHRONOUSLY and only returns 200 once the database write has actually
 * succeeded. A thrown error returns 5xx, so Cashfree retries rather than
 * the event being lost. (Same reasoning the reverted feat(billing) commit
 * used for its own webhook handler.)
 *
 * Mounted under a path containing "webhook" so index.js's raw-body capture
 * (needed for signature verification) applies automatically.
 */

const express = require('express');
const router = express.Router();
const { verifyWebhookSignature } = require('../lib/cashfree');
const { fulfillPaidOrder } = require('../services/billingFulfillment');
const { isBillingEnabled } = require('../lib/billingFlags');

router.post('/', async (req, res) => {
  // Same posture as billing checkout: while billing is dark, this endpoint
  // must not do anything with a request even if one somehow arrives (there
  // is no checkout flow to have generated one, but Cashfree's dashboard
  // could still be misconfigured to point here). 404, not 401/403 — no
  // signal that the endpoint means anything.
  if (!isBillingEnabled()) {
    return res.status(404).send('Not found');
  }

  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const secret = process.env.CASHFREE_SECRET_KEY;

  if (!verifyWebhookSignature(req.rawBody, signature, timestamp, secret)) {
    console.warn('[CashfreeWebhook] Rejected: invalid or missing signature.');
    return res.status(401).send('Invalid signature');
  }

  const { type, data } = req.body || {};
  const orderId = data?.order?.order_id;
  const paymentStatus = data?.payment?.payment_status;

  if (type !== 'PAYMENT_SUCCESS_WEBHOOK') {
    // PAYMENT_FAILED_WEBHOOK, PAYMENT_USER_DROPPED_WEBHOOK, and similar
    // exist but credit nothing — a failed one-time purchase never
    // credited anything to roll back.
    console.log(`[CashfreeWebhook] Received "${type}" for order ${orderId} — logged, no state change applied.`);
    return res.status(200).send('OK');
  }

  if (!orderId || paymentStatus !== 'SUCCESS') {
    console.log(`[CashfreeWebhook] Ignoring PAYMENT_SUCCESS_WEBHOOK with status=${paymentStatus} for ${orderId} — not a confirmed success.`);
    return res.status(200).send('OK');
  }

  try {
    const result = await fulfillPaidOrder({
      cashfreeOrderId: orderId,
      payment: data.payment,
      rawPayload: req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body),
    });

    if (result.outcome === 'not_found') {
      // Verified signature, but references an order we have no record of.
      // Ack it (retrying changes nothing) rather than inviting a retry storm.
      return res.status(200).send('OK');
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('[CashfreeWebhook] Fulfillment failed:', error.message);
    return res.status(500).send('Processing failed');
  }
});

module.exports = router;
