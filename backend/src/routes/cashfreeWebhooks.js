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
const { fulfillPaidOrder, markPaymentFailed } = require('../services/billingFulfillment');
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

  // MALFORMED BUT SIGNED. A payload that carries a valid signature but not the
  // shape we need is acknowledged with 200 and logged — never a 5xx. Cashfree
  // retries anything that is not a 2xx, and a payload that is wrong today is
  // wrong on every retry, so a 5xx here is an infinite retry loop and a 4xx is
  // the same loop with a different number. A genuine payment is not lost by
  // acking it: the nightly reconciliation job asks Cashfree directly about
  // every order still pending.
  //
  // order_id MUST be a string before it goes anywhere near Prisma: an object
  // or a number there is a validation throw, i.e. exactly that 5xx loop.
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { type, data } = body;
  const rawOrderId = data?.order?.order_id;
  const orderId = typeof rawOrderId === 'string' && rawOrderId.length > 0 ? rawOrderId : null;
  const paymentStatus = data?.payment?.payment_status;
  const rawPayload = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);

  if (type === 'PAYMENT_FAILED_WEBHOOK') {
    if (!orderId) {
      console.warn(`[CashfreeWebhook] Malformed PAYMENT_FAILED_WEBHOOK (order_id: ${JSON.stringify(rawOrderId)}) — acknowledged, no state change.`);
      return res.status(200).send('OK');
    }
    try {
      await markPaymentFailed({ cashfreeOrderId: orderId, rawPayload });
      return res.status(200).send('OK');
    } catch (error) {
      console.error('[CashfreeWebhook] Recording a failed payment failed:', error.name, error.message);
      return res.status(500).send('Processing failed');
    }
  }

  if (type !== 'PAYMENT_SUCCESS_WEBHOOK') {
    // PAYMENT_USER_DROPPED_WEBHOOK and similar credit nothing and change
    // nothing: a dropped checkout stays CREATED, because the customer can
    // still come back and pay the same order, and the reconciliation job's
    // 7-day rule retires it if they never do.
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
    // expired (logged loudly inside fulfillPaidOrder — retrying cannot fix it).
    // Only a thrown error, which rolled everything back, asks for a retry.
    await fulfillPaidOrder({ cashfreeOrderId: orderId, payment: data.payment, rawPayload });
    return res.status(200).send('OK');
  } catch (error) {
    console.error('[CashfreeWebhook] Fulfillment failed:', error.name, error.message);
    return res.status(500).send('Processing failed');
  }
});

module.exports = router;
