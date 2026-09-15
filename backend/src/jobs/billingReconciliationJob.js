/**
 * Nightly reconciliation — the backstop for a dropped Cashfree webhook.
 *
 * "Dropped webhooks are normal; a paying customer locked out is our worst
 * support ticket" (feat/billing brief). This job never trusts Cashfree's
 * webhook as the ONLY signal a payment happened: for every one of our own
 * Order rows still sitting in CREATED, it asks Cashfree directly what
 * actually happened, and self-heals through the exact same fulfillPaidOrder()
 * path the webhook itself uses — so a healed order is granted, credited,
 * and region-locked identically to one the webhook caught live.
 *
 * BOUNDED (3.1.9), so this cannot become unbounded work over time:
 *   - only orders created in the last LOOKBACK_HOURS (48h — one nightly run
 *     plus slack, not "every pending order forever")
 *   - at most MAX_ORDERS_PER_RUN re-fetched per run, oldest first (most at
 *     risk of aging out of the window before being checked)
 *   - a CREATED order older than EXPIRE_AFTER_DAYS (7d) is moved to the
 *     terminal EXPIRED state and never re-fetched again by this job
 * Without the 7-day expiry, an abandoned checkout (customer opened the
 * hosted checkout page and never paid) would be re-queried by this job
 * forever.
 *
 * Scoped to OUR pending orders, not "list all Cashfree orders in the last
 * 48h" — Cashfree's public PG REST API has no such bulk date-range listing
 * endpoint (the MCP's search_orders tool queries an internal/dashboard
 * reporting API, not something this production code path may depend on;
 * see the hard constraint that the MCP connection is dev-only). Re-fetching
 * each of our own CREATED orders individually via GET /pg/orders/{id} is
 * both correct and exactly what the public REST API supports.
 */

const prisma = require('../lib/prisma');
const { getOrder, getPaymentsForOrder } = require('../lib/cashfreeOrders');
const { fulfillPaidOrder } = require('../services/billingFulfillment');
const mailer = require('../lib/email');

const LOOKBACK_HOURS = 48;
const MAX_ORDERS_PER_RUN = 200;
const EXPIRE_AFTER_DAYS = 7;

/** CREATED orders old enough that they will never be checked again — retire them so the main loop stays bounded. */
async function expireStaleOrders({ expireAfterDays = EXPIRE_AFTER_DAYS } = {}) {
  const cutoff = new Date(Date.now() - expireAfterDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.order.updateMany({
    where: { status: 'CREATED', createdAt: { lt: cutoff } },
    data: { status: 'EXPIRED' },
  });
  if (count > 0) {
    console.log(`[BillingReconciliation] Expired ${count} stale CREATED order(s) older than ${expireAfterDays} days.`);
  }
  return count;
}

/**
 * ALERT (3.1.10). One digest email per run, never one per mismatch — a
 * night with 40 dropped webhooks must not itself burn the email quota or
 * bury the on-call person in identical subject lines. CRITICAL tier (see
 * lib/email/quota.js): money is unaccounted for until a human looks.
 */
async function sendMismatchDigest(mismatches, checked) {
  const to = (process.env.SUPPORT_EMAIL || '').trim();
  if (!to) {
    console.error(
      `[BillingReconciliation] SUPPORT_EMAIL is not set — cannot send the mismatch alert for ${mismatches.length} mismatch(es). ` +
        `Logging full detail here instead: ${JSON.stringify(mismatches)}`
    );
    return;
  }
  try {
    await mailer.sendBillingReconciliationMismatch(to, { mismatches, checked });
  } catch (err) {
    console.error(
      `[BillingReconciliation] Failed to send the mismatch alert email — logging full detail as a fallback:`,
      err.message,
      JSON.stringify(mismatches)
    );
  }
}

async function reconcileRecentOrders({ lookbackHours = LOOKBACK_HOURS, maxPerRun = MAX_ORDERS_PER_RUN } = {}) {
  const expired = await expireStaleOrders();

  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const pending = await prisma.order.findMany({
    where: { status: 'CREATED', createdAt: { gte: cutoff } },
    orderBy: { createdAt: 'asc' }, // oldest first — closest to aging out of the window unreconciled
    take: maxPerRun,
  });

  let checked = 0;
  let checkFailures = 0;
  const mismatches = []; // collected for ONE digest, not sent per-mismatch

  for (const order of pending) {
    checked += 1;
    let cfOrder;
    try {
      cfOrder = await getOrder(order.cashfreeOrderId);
    } catch (err) {
      checkFailures += 1;
      console.error(
        `[BillingReconciliation] Could not fetch order ${order.cashfreeOrderId} from Cashfree — will retry next run:`,
        err.response?.data || err.message
      );
      continue;
    }

    if (cfOrder.order_status !== 'PAID') {
      continue; // genuinely still unpaid/expired — nothing to reconcile
    }

    console.error(
      `[BillingReconciliation] MISMATCH — order ${order.cashfreeOrderId} (tenant ${order.tenantId}, ${order.planCode || order.addonCode}) ` +
        `is PAID at Cashfree but was still CREATED in our database. A webhook was dropped. Healing now.`
    );

    let payment = null;
    try {
      const payments = await getPaymentsForOrder(order.cashfreeOrderId);
      payment = Array.isArray(payments) ? payments.find((p) => p.payment_status === 'SUCCESS') || null : null;
    } catch (err) {
      console.error(
        `[BillingReconciliation] Order ${order.cashfreeOrderId} confirmed PAID but could not fetch payment detail for region evidence — ` +
          `granting with UNVERIFIED region (unlocked) rather than guessing:`,
        err.response?.data || err.message
      );
    }

    let healed = false;
    try {
      const result = await fulfillPaidOrder({
        cashfreeOrderId: order.cashfreeOrderId,
        payment,
        rawPayload: JSON.stringify({ reconciledFrom: 'nightly_job', cfOrder, payment }),
      });
      healed = result.outcome === 'granted';
    } catch (err) {
      console.error(`[BillingReconciliation] Healing FAILED for order ${order.cashfreeOrderId}:`, err.message);
    }

    mismatches.push({
      cashfreeOrderId: order.cashfreeOrderId,
      tenantId: order.tenantId,
      planCode: order.planCode,
      addonCode: order.addonCode,
      healed,
    });
  }

  if (mismatches.length > 0) {
    await sendMismatchDigest(mismatches, checked);
  }

  if (mismatches.length > 0 || checkFailures > 0 || expired > 0) {
    console.log(
      `[BillingReconciliation] Checked ${checked} pending order(s): ${mismatches.length} mismatch(es) ` +
        `(${mismatches.filter((m) => m.healed).length} healed), ${checkFailures} check failure(s), ${expired} expired.`
    );
  }

  return { checked, mismatches: mismatches.length, healed: mismatches.filter((m) => m.healed).length, checkFailures, expired };
}

module.exports = { reconcileRecentOrders, expireStaleOrders, LOOKBACK_HOURS, MAX_ORDERS_PER_RUN, EXPIRE_AFTER_DAYS };
