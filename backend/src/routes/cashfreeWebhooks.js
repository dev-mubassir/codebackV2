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
const { verifyWebhookSignature, parseCashfreeJson, checkWebhookTimestamp } = require('../lib/cashfree');
const { fulfillPaidOrder, recordPaymentAttempt } = require('../services/billingFulfillment');
const { applyRefundStatus } = require('../services/refundService');
const { isBillingEnabled } = require('../lib/billingFlags');

/** Attempt outcomes that are recorded on their own and never change the order. */
const ATTEMPT_ONLY_EVENTS = ['PAYMENT_FAILED_WEBHOOK', 'PAYMENT_USER_DROPPED_WEBHOOK'];

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

  // Replay window — LOG-ONLY until sandbox confirms what timestamp a Cashfree
  // retry carries (see lib/cashfree.js checkWebhookTimestamp).
  const age = checkWebhookTimestamp(timestamp);
  if (!age.withinWindow) {
    const enforce = process.env.WEBHOOK_TIMESTAMP_ENFORCE === 'true';
    console.warn(
      `[CashfreeWebhook] Timestamp outside the ±5 min window ` +
        `(skew ${age.skewMs === null ? 'unparseable' : `${Math.round(age.skewMs / 1000)}s`}; ` +
        `event ${req.headers['x-webhook-attempt'] ? `attempt ${req.headers['x-webhook-attempt']}` : 'attempt ?'}). ` +
        (enforce ? 'Rejected.' : 'Accepted (log-only mode).')
    );
    if (enforce) return res.status(401).send('Stale webhook');
  }

  // MALFORMED BUT SIGNED. A payload that carries a valid signature but not the
  // shape we need is acknowledged with 200 and logged — never a 5xx. Cashfree
  // retries anything that is not a 2xx, and a payload that is wrong today is
  // wrong on every retry, so a 5xx here is an infinite retry loop and a 4xx is
  // the same loop with a different number. A genuine payment is not lost by
  // acking it: the nightly reconciliation job asks Cashfree directly about
  // every order still pending, and an admin can re-sync any refund.
  //
  // ids MUST be strings before they go anywhere near Prisma: an object or a
  // number there is a validation throw, i.e. exactly that 5xx loop.
  // Read the VERIFIED raw bytes with parseCashfreeJson, not req.body: express.json
  // has already rounded any cf_*_id larger than a safe JS integer.
  let parsed = req.body;
  if (req.rawBody) {
    try {
      parsed = parseCashfreeJson(req.rawBody.toString('utf8'));
    } catch {
      parsed = req.body;
    }
  }
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const { type, data } = body;
  const rawPayload = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);

  if (type === 'REFUND_STATUS_WEBHOOK') {
    return handleRefundWebhook(data, rawPayload, res);
  }

  const rawOrderId = data?.order?.order_id;
  const orderId = typeof rawOrderId === 'string' && rawOrderId.length > 0 ? rawOrderId : null;
  const paymentStatus = data?.payment?.payment_status;

  if (ATTEMPT_ONLY_EVENTS.includes(type)) {
    // A failed or abandoned ATTEMPT. The order stays CREATED — the customer can
    // still pay it until it expires — and the attempt is kept on its own row.
    if (!orderId) {
      console.warn(`[CashfreeWebhook] Malformed ${type} (order_id: ${JSON.stringify(rawOrderId)}) — acknowledged, nothing recorded.`);
      return res.status(200).send('OK');
    }
    try {
      await recordPaymentAttempt({ cashfreeOrderId: orderId, eventType: type, payment: data?.payment, rawPayload });
      return res.status(200).send('OK');
    } catch (error) {
      console.error(`[CashfreeWebhook] Recording a ${type} attempt failed:`, error.name, error.message);
      return res.status(500).send('Processing failed');
    }
  }

  if (type !== 'PAYMENT_SUCCESS_WEBHOOK') {
    console.log(`[CashfreeWebhook] Received "${type}" for order ${orderId} — logged, no state change applied.`);
    return res.status(200).send('OK');
  }

  if (!orderId) {
    console.error(
      `[CashfreeWebhook] Malformed PAYMENT_SUCCESS_WEBHOOK — order_id is ${JSON.stringify(rawOrderId)}. ` +
        'Acknowledged so Cashfree stops retrying; reconciliation will heal a real payment.'
    );
    return res.status(200).send('OK');
  }

  if (paymentStatus !== 'SUCCESS') {
    console.log(`[CashfreeWebhook] Ignoring PAYMENT_SUCCESS_WEBHOOK with status=${paymentStatus} for ${orderId} — not a confirmed success.`);
    return res.status(200).send('OK');
  }

  try {
    // Every outcome is acknowledged: granted, already processed, an unknown
    // order (retrying changes nothing), and a payment on an order we already
    // expired (alerted inside fulfillPaidOrder — retrying cannot fix it).
    // Only a thrown error, which rolled everything back, asks for a retry.
    await fulfillPaidOrder({ cashfreeOrderId: orderId, payment: data.payment, rawPayload });
    return res.status(200).send('OK');
  } catch (error) {
    console.error('[CashfreeWebhook] Fulfillment failed:', error.name, error.message);
    return res.status(500).send('Processing failed');
  }
});

/**
 * REFUND_STATUS_WEBHOOK — same signature verification (above), same posture on
 * malformed payloads, and the same retry contract: 200 only once the status
 * (and any revocation) has committed.
 *
 * The webhook shape differs from the REST refund object: cf_refund_id is a
 * number here, and speeds are flat fields. Only the fields below are read.
 */
async function handleRefundWebhook(data, rawPayload, res) {
  const refund = data?.refund;
  const refundId = typeof refund?.refund_id === 'string' && refund.refund_id.length > 0 ? refund.refund_id : null;
  const orderId = typeof refund?.order_id === 'string' && refund.order_id.length > 0 ? refund.order_id : null;
  const status = typeof refund?.refund_status === 'string' ? refund.refund_status : null;

  if (!refundId || !orderId || !status) {
    console.error(
      `[CashfreeWebhook] Malformed REFUND_STATUS_WEBHOOK (refund_id: ${JSON.stringify(refund?.refund_id)}, ` +
        `order_id: ${JSON.stringify(refund?.order_id)}, status: ${JSON.stringify(refund?.refund_status)}) — acknowledged. ` +
        'Re-sync the refund from the admin endpoint if it was real.'
    );
    return res.status(200).send('OK');
  }

  try {
    await applyRefundStatus({
      refundId,
      cashfreeOrderId: orderId,
      status,
      refundAmount: refund.refund_amount,
      cfRefundId: refund.cf_refund_id,
      arn: refund.refund_arn,
      statusDescription: refund.status_description,
      processedAt: refund.processed_at,
      rawPayload,
      source: 'webhook',
    });
    return res.status(200).send('OK');
  } catch (error) {
    console.error('[CashfreeWebhook] Refund status processing failed:', error.name, error.message);
    return res.status(500).send('Processing failed');
  }
}

module.exports = router;
