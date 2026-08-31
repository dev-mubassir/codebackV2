/**
 * Cashfree webhook routes — Subscriptions (this phase) and PG add-on orders
 * (Phase 4). Mounted under a path containing "webhook" so index.js's raw-
 * body capture (needed for signature verification) applies automatically,
 * same mechanism as the Instagram webhook.
 *
 * Deliberate difference from webhook.js: Instagram's webhook returns 200
 * immediately and processes in the background, because Meta requires a
 * fast response and eventual consistency is fine for message delivery.
 * Cashfree retries delivery until it gets a 200 — for billing-critical
 * state changes (activating a paid plan, crediting add-on DMs), we want
 * that retry safety net, so this handler processes synchronously and only
 * returns 200 once the database write has actually succeeded. A thrown
 * error returns 5xx, so Cashfree retries instead of the event being lost.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../lib/prisma');
const { verifyWebhookSignature } = require('../lib/cashfree');
const { claimWebhookEvent, releaseWebhookClaim } = require('../lib/webhookIdempotency');
const {
  parseMerchantSubscriptionId,
  computeNextPeriodEnd,
  MalformedSubscriptionIdError,
} = require('../lib/cashfreeSubscriptions');
const {
  parseAddonOrderId,
  MalformedAddonOrderIdError,
  parseRenewalOrderId,
  MalformedRenewalOrderIdError,
} = require('../lib/cashfreeOrders');
const { getAddonPack } = require('../lib/addonPacks');

const PROVIDER = 'cashfree_subscriptions';
const PROVIDER_PG = 'cashfree_pg';

// Statuses from SUBSCRIPTION_STATUS_CHANGED that mean "no longer a live,
// chargeable subscription" — treated the same as an explicit cancellation.
const CANCEL_LIKE_STATUSES = ['CUSTOMER_CANCELLED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'LINK_EXPIRED'];

// Statuses that mean "not currently payable, but not necessarily over" —
// same treatment as a failed payment. CUSTOMER_PAUSED is deliberately NOT
// included: no pause concept exists elsewhere in this codebase, so it's
// left logged-only rather than invented here.
const PAST_DUE_LIKE_STATUSES = ['ON_HOLD', 'BANK_APPROVAL_PENDING', 'CARD_EXPIRED'];

router.post('/subscriptions', async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  // Cashfree's own docs verify webhook signatures with the client secret,
  // not a separate webhook-specific credential — confirmed against
  // https://www.cashfree.com/docs/api-reference/vrs/webhook-signature-verification
  // ("Generate an HMAC-SHA256 hash of this string using your client secret").
  const secret = process.env.CASHFREE_SUBSCRIPTIONS_CLIENT_SECRET;

  if (!verifyWebhookSignature(req.rawBody, signature, timestamp, secret)) {
    console.warn('[CashfreeSubscriptions] Rejected webhook: invalid or missing signature.');
    return res.status(401).send('Invalid signature');
  }

  // Cashfree's own dedup header; fall back to a hash of the verified raw
  // body if it's ever absent, rather than processing with no guard at all.
  const eventId = req.headers['x-idempotency-header']
    || crypto.createHash('sha256').update(req.rawBody).digest('hex');

  const isNewEvent = await claimWebhookEvent(PROVIDER, eventId);
  if (!isNewEvent) {
    console.log(`[CashfreeSubscriptions] Duplicate webhook delivery, already processed: ${eventId}`);
    return res.status(200).send('OK');
  }

  const { type, data } = req.body || {};

  try {
    if (type === 'SUBSCRIPTION_PAYMENT_SUCCESS') {
      await handlePaymentSuccess(data);
    } else if (type === 'SUBSCRIPTION_PAYMENT_FAILED') {
      await handlePaymentFailed(data);
    } else if (type === 'SUBSCRIPTION_STATUS_CHANGED') {
      await handleStatusChanged(data);
    } else {
      // Confirmed against Cashfree's docs: SUBSCRIPTION_AUTH_STATUS,
      // SUBSCRIPTION_PAYMENT_NOTIFICATION_INITIATED,
      // SUBSCRIPTION_PAYMENT_CANCELLED, SUBSCRIPTION_REFUND_STATUS,
      // SUBSCRIPTION_CARD_EXPIRY_REMINDER,
      // SUBSCRIPTION_CONTROLLED_NOTIFICATION_STATUS, and
      // SUBSCRIPTION_CONTROLLED_EXECUTION_STATUS also exist. None of them
      // map to the three outcomes this phase handles (activation/renewal,
      // payment failure, cancellation), so they're acknowledged and logged
      // rather than silently dropped or guessed at.
      console.log(`[CashfreeSubscriptions] Received unhandled event type "${type}" — logged, no state change applied.`);
    }
    res.status(200).send('OK');
  } catch (error) {
    if (error instanceof MalformedSubscriptionIdError) {
      // Signature already verified — this is genuinely from Cashfree, but
      // references an id shape we can never resolve. Retrying won't help,
      // so ack it and leave a loud trail for manual investigation instead
      // of retry-storming forever on something that can never succeed.
      console.error('[CashfreeSubscriptions] Malformed subscription_id on a verified payload — will not retry. Raw body:', req.rawBody);
      return res.status(200).send('OK');
    }
    // Genuine/transient failure: release the claim so Cashfree's retry of
    // this SAME event actually reprocesses it, instead of the retry being
    // silently swallowed as "already processed" by the claim we just took.
    await releaseWebhookClaim(PROVIDER, eventId).catch(() => {});
    console.error('[CashfreeSubscriptions] Error processing webhook:', error.message);
    res.status(500).send('Processing failed');
  }
});

/**
 * PG add-on order webhooks. Independently confirmed against Cashfree's PG-
 * specific docs — signature scheme is the same as Subscriptions (same
 * headers, same HMAC-SHA256(timestamp+rawBody) algorithm), but idempotency
 * for this product could not be pinned down with full confidence: the
 * general webhook docs describe a cross-product x-idempotency-header, while
 * the Payments-specific idempotency guidance instead recommends deduping on
 * the payload's own cf_payment_id with no header mentioned. Using the
 * header when present and falling back to cf_payment_id covers both.
 */
router.post('/pg', async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  // Same reasoning as the /subscriptions handler above — Cashfree verifies
  // with the client secret, not a distinct webhook secret.
  const secret = process.env.CASHFREE_PG_CLIENT_SECRET;

  if (!verifyWebhookSignature(req.rawBody, signature, timestamp, secret)) {
    console.warn('[CashfreePG] Rejected webhook: invalid or missing signature.');
    return res.status(401).send('Invalid signature');
  }

  const { type, data } = req.body || {};

  const eventId = req.headers['x-idempotency-header']
    || data?.payment?.cf_payment_id
    || crypto.createHash('sha256').update(req.rawBody).digest('hex');

  const isNewEvent = await claimWebhookEvent(PROVIDER_PG, eventId);
  if (!isNewEvent) {
    console.log(`[CashfreePG] Duplicate webhook delivery, already processed: ${eventId}`);
    return res.status(200).send('OK');
  }

  try {
    if (type === 'PAYMENT_SUCCESS_WEBHOOK') {
      await handleOrderPaymentSuccess(data);
    } else {
      // PAYMENT_FAILED_WEBHOOK, PAYMENT_USER_DROPPED_WEBHOOK, and similar
      // exist but credit nothing — a failed one-time purchase never
      // credited anything to roll back, unlike a subscription's status.
      console.log(`[CashfreePG] Received unhandled event type "${type}" — logged, no state change applied.`);
    }
    res.status(200).send('OK');
  } catch (error) {
    if (error instanceof MalformedAddonOrderIdError || error instanceof MalformedRenewalOrderIdError) {
      console.error('[CashfreePG] Malformed order_id on a verified payload — will not retry. Raw body:', req.rawBody);
      return res.status(200).send('OK');
    }
    // See the /subscriptions handler above for why this release matters.
    await releaseWebhookClaim(PROVIDER_PG, eventId).catch(() => {});
    console.error('[CashfreePG] Error processing webhook:', error.message);
    res.status(500).send('Processing failed');
  }
});

const RENEWAL_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Only a verified SUCCESS on the order itself represents confirmed payment
 * — never credit/activate on FAILED/PENDING/USER_DROPPED/CANCELLED.
 *
 * Dispatches on the order_id's prefix BEFORE parsing, not "try one parser,
 * catch and fall through to the other" — an unrecognized prefix is the only
 * case treated as genuinely malformed (ack, don't retry). A recognized
 * prefix with a malformed body underneath still throws its own dedicated
 * Malformed*Error, which the outer catch above still treats as malformed —
 * it's just not silently swallowed here before ever reaching that catch.
 */
async function handleOrderPaymentSuccess(data) {
  const orderId = data?.order?.order_id;
  const paymentStatus = data?.payment?.payment_status;

  if (!orderId || paymentStatus !== 'SUCCESS') {
    console.log(`[CashfreePG] Ignoring order payment (status=${paymentStatus}) for ${orderId} — not a confirmed success.`);
    return;
  }

  if (orderId.startsWith('ao_')) {
    return handleAddonOrderSuccess(orderId);
  }
  if (orderId.startsWith('mr_')) {
    return handleRenewalOrderSuccess(orderId);
  }
  throw new MalformedAddonOrderIdError(`Unrecognized Cashfree PG order_id prefix: ${orderId}`);
}

async function handleAddonOrderSuccess(orderId) {
  const { subscriptionRowId, packCode } = parseAddonOrderId(orderId);
  const pack = getAddonPack(packCode);
  if (!pack) throw new Error(`Webhook references unknown add-on pack code "${packCode}"`);

  await prisma.subscription.update({
    where: { id: subscriptionRowId },
    data: { addonDmCredits: { increment: pack.dmCredits } },
  });

  console.log(`[CashfreePG] Credited ${pack.dmCredits} add-on DMs to subscription ${subscriptionRowId} (order ${orderId}).`);
}

/**
 * Manual-renewal payment (CASHFREE_SUBSCRIPTIONS_ENABLED=false path) — same
 * activation outcome as Phase 3's Subscriptions autopay success, just
 * reached via a one-time PG order instead of a mandate charge. currentPeriodEnd
 * extends from its current value if that's still in the future (an early
 * renewal shouldn't lose remaining days); otherwise it starts fresh from
 * now. Flat 30 days either way — deliberately not the same calendar-month
 * computeNextPeriodEnd() Phase 3 uses, per how this was specified.
 */
async function handleRenewalOrderSuccess(orderId) {
  const { subscriptionRowId, planSlug } = parseRenewalOrderId(orderId);
  const plan = await prisma.plan.findUnique({ where: { slug: planSlug } });
  if (!plan) throw new Error(`Webhook references unknown plan slug "${planSlug}"`);

  const existing = await prisma.subscription.findUnique({ where: { id: subscriptionRowId } });
  if (!existing) throw new Error(`Webhook references missing subscription row ${subscriptionRowId}`);

  const now = new Date();
  const stillActive = existing.currentPeriodEnd && new Date(existing.currentPeriodEnd) > now;
  const extendFrom = stillActive ? new Date(existing.currentPeriodEnd) : now;
  const currentPeriodEnd = new Date(extendFrom.getTime() + RENEWAL_PERIOD_MS);

  await prisma.subscription.update({
    where: { id: subscriptionRowId },
    data: {
      planId: existing.planId || plan.id,
      status: 'active',
      currentPeriodEnd,
      // Added in a later migration — reset here now so that migration
      // doesn't need to touch this handler again.
      lastRenewalReminderSentAt: null,
      // Add-ons don't roll over — same rule as Phase 3's activation,
      // no divergence based on payment mechanism.
      dmQuotaUsedThisCycle: 0,
      addonDmCredits: 0,
    },
  });

  console.log(`[CashfreePG] Manually renewed ${plan.slug} for subscription ${subscriptionRowId}, period ends ${currentPeriodEnd.toISOString()}.`);
}

/**
 * A successful payment can be the small mandate-authorization charge
 * (payment_type "AUTH") or the actual plan charge (payment_type "CHARGE").
 * Only a CHARGE represents money paid for the plan itself — treating an
 * AUTH success as activation would grant a full plan for a ~₹1 auth
 * payment. Both the first activation and every renewal arrive as this
 * same event with payment_type "CHARGE", so one code path handles both.
 */
async function handlePaymentSuccess(data) {
  if (!data || data.payment_type !== 'CHARGE' || data.payment_status !== 'SUCCESS') {
    console.log(`[CashfreeSubscriptions] Ignoring payment success (type=${data?.payment_type}, status=${data?.payment_status}) for ${data?.subscription_id} — not a confirmed plan charge.`);
    return;
  }

  const { subscriptionRowId, planSlug } = parseMerchantSubscriptionId(data.subscription_id);
  const plan = await prisma.plan.findUnique({ where: { slug: planSlug } });
  if (!plan) throw new Error(`Webhook references unknown plan slug "${planSlug}"`);

  const now = new Date();
  const currentPeriodEnd = computeNextPeriodEnd(now, plan.interval);

  await prisma.subscription.update({
    where: { id: subscriptionRowId },
    data: {
      planId: plan.id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd,
      // Add-ons don't roll over — same rule at activation as at renewal.
      dmQuotaUsedThisCycle: 0,
      addonDmCredits: 0,
      provider: 'cashfree',
      providerSubscriptionId: data.cf_subscription_id,
    },
  });

  console.log(`[CashfreeSubscriptions] Activated/renewed ${plan.slug} for subscription ${subscriptionRowId}, period ends ${currentPeriodEnd.toISOString()}.`);
}

/** An AUTH failure just means mandate setup never succeeded — nothing was ever active, so there's nothing to mark past_due. */
async function handlePaymentFailed(data) {
  if (!data || data.payment_type !== 'CHARGE') {
    console.log(`[CashfreeSubscriptions] Ignoring payment failure (type=${data?.payment_type}) for ${data?.subscription_id} — not a plan charge.`);
    return;
  }

  const { subscriptionRowId } = parseMerchantSubscriptionId(data.subscription_id);
  // planId is left untouched — they still own the plan, just aren't
  // current on payment for it.
  await prisma.subscription.update({
    where: { id: subscriptionRowId },
    data: { status: 'past_due' },
  });

  console.log(`[CashfreeSubscriptions] Marked subscription ${subscriptionRowId} past_due: ${data.failure_details?.failure_reason || 'unknown reason'}.`);
}

async function handleStatusChanged(data) {
  const details = data?.subscription_details;
  if (!details) return;

  const status = details.subscription_status;

  if (CANCEL_LIKE_STATUSES.includes(status)) {
    const { subscriptionRowId } = parseMerchantSubscriptionId(details.subscription_id);
    await prisma.subscription.update({
      where: { id: subscriptionRowId },
      data: { status: 'cancelled' },
    });
    console.log(`[CashfreeSubscriptions] Cancelled subscription ${subscriptionRowId} (Cashfree status: ${status}).`);
    return;
  }

  if (PAST_DUE_LIKE_STATUSES.includes(status)) {
    const { subscriptionRowId } = parseMerchantSubscriptionId(details.subscription_id);
    await prisma.subscription.update({
      where: { id: subscriptionRowId },
      data: { status: 'past_due' },
    });
    console.log(`[CashfreeSubscriptions] Marked subscription ${subscriptionRowId} past_due (Cashfree status: ${status}).`);
    return;
  }

  console.log(`[CashfreeSubscriptions] Subscription ${details.subscription_id} status changed to ${status} — logged, no state change applied.`);
}

module.exports = router;
