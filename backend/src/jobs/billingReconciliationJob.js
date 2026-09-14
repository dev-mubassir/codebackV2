/**
 * Nightly reconciliation — the backstop for a dropped Cashfree webhook.
 *
 * "Dropped webhooks are normal; a paying customer locked out is our worst
 * support ticket" (feat/billing brief). This job never trusts Cashfree's
 * webhook as the ONLY signal a payment happened: for every one of our own
 * Order rows still sitting in CREATED from the last 24h, it asks Cashfree
 * directly what actually happened, and self-heals through the exact same
 * fulfillPaidOrder() path the webhook itself uses — so a healed order is
 * granted, credited, and region-locked identically to one the webhook
 * caught live.
 *
 * Scoped to OUR pending orders, not "list all Cashfree orders in the last
 * 24h" — Cashfree's public PG REST API has no such bulk date-range listing
 * endpoint (the MCP's search_orders tool queries an internal/dashboard
 * reporting API, not something this production code path may depend on;
 * see the hard constraint that the MCP connection is dev-only). Re-fetching
 * each of our own CREATED orders individually via GET /pg/orders/{id} is
 * both correct and exactly what the public REST API supports.
 */

const prisma = require('../lib/prisma');
const { getOrder, getPaymentsForOrder } = require('../lib/cashfreeOrders');
const { fulfillPaidOrder } = require('../services/billingFulfillment');

const LOOKBACK_HOURS = 24;

async function reconcileRecentOrders({ lookbackHours = LOOKBACK_HOURS } = {}) {
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const pending = await prisma.order.findMany({
    where: { status: 'CREATED', createdAt: { gte: cutoff } },
  });

  let checked = 0;
  let mismatches = 0;
  let healed = 0;
  let checkFailures = 0;

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

    mismatches += 1;
    // ALERT. No Slack/PagerDuty/ops-email integration exists in this
    // codebase today (see Gate 3 report) — a loud, structured console.error
    // is the alerting mechanism, consistent with this codebase's existing
    // convention for operationally critical conditions (e.g. index.js's
    // FATAL boot checks). Northflank log aggregation is what an operator
    // would be watching.
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
        `[BillingReconciliation] Order ${order.cashfreeOrderId} confirmed PAID but could not fetch payment detail for country inference — ` +
          `falling back to the order's own currency for the region lock:`,
        err.response?.data || err.message
      );
    }

    try {
      const result = await fulfillPaidOrder({
        cashfreeOrderId: order.cashfreeOrderId,
        payment,
        rawPayload: JSON.stringify({ reconciledFrom: 'nightly_job', cfOrder, payment }),
      });
      if (result.outcome === 'granted') healed += 1;
    } catch (err) {
      console.error(`[BillingReconciliation] Healing FAILED for order ${order.cashfreeOrderId}:`, err.message);
    }
  }

  if (mismatches > 0 || checkFailures > 0) {
    console.log(
      `[BillingReconciliation] Checked ${checked} pending order(s): ${mismatches} mismatch(es), ${healed} healed, ${checkFailures} check failure(s).`
    );
  }

  return { checked, mismatches, healed, checkFailures };
}

module.exports = { reconcileRecentOrders, LOOKBACK_HOURS };
