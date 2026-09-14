/**
 * Cashfree Payment Gateway order creation — one-time orders only. No
 * Subscriptions/mandate API is used anywhere in this file or called from
 * it; see the feat/billing brief's hard constraint against auto-debit.
 *
 * Confirmed live against the sandbox account via the Cashfree MCP
 * connection during Gate 3 development (create_order / get_order) — see
 * the Gate 3 report for what was observed. That MCP connection is a
 * DEVELOPMENT TOOL ONLY; this module makes plain server-side REST calls
 * using env-var credentials and has no runtime dependency on it.
 *
 * DIFFERENCE FROM THE REVERTED CODE: the reverted lib/cashfreeOrders.js had
 * to encode context (which subscription row, which pack) into the order_id
 * string itself, because no Order table existed to look it up from. Gate 1
 * added one, so order_id here is just an opaque unique token — all context
 * (tenantId, planCode, addonCode, amount, currency) lives on the Order row,
 * looked up by this id when the webhook arrives.
 */

const crypto = require('crypto');
const axios = require('axios');
const { getBaseUrl, smallestUnitToDecimal } = require('./cashfree');

// Carried over from the reverted code (lib/cashfreeOrders.js, commit
// 0a47627), which states this was independently confirmed against
// Cashfree's current docs in Aug 2026 — one month before this file was
// written, and Cashfree's x-api-version values only move forward, never
// back. The Gate 3 MCP test calls below omitted x-api-version entirely
// (letting the account's own default apply) rather than re-confirming this
// specific string, so this is carried-over confidence, not independently
// re-verified this session. Re-verify if a call ever fails with a
// version-related error.
const API_VERSION = '2026-01-01';

/**
 * order_id must be alphanumeric/underscore/hyphen only, <= 45 chars. A bare
 * UUID (36 chars) plus a short prefix comfortably fits, and carries no
 * information of its own — see the module note above for why it doesn't
 * need to.
 */
function generateOrderId() {
  return `sfy_${crypto.randomUUID()}`;
}

/**
 * Create a one-time Cashfree order for a plan purchase/renewal or an
 * add-on purchase. Caller has already created the corresponding Order row
 * (status CREATED) with this same orderId before calling this — see
 * routes/billing.js. x-idempotency-key uses that same id, so a network
 * retry of this exact call cannot create two Cashfree-side orders for one
 * of our own Order rows.
 */
async function createOrder({ orderId, amountInPaise, currency, customerId, customerEmail, customerPhone, returnUrl }) {
  const clientId = process.env.CASHFREE_APP_ID;
  const clientSecret = process.env.CASHFREE_SECRET_KEY;
  if (!clientId || !clientSecret) {
    throw new Error('CASHFREE_APP_ID/CASHFREE_SECRET_KEY are not configured');
  }

  const orderAmountDecimal = smallestUnitToDecimal(amountInPaise);

  const response = await axios.post(
    `${getBaseUrl()}/pg/orders`,
    {
      order_id: orderId,
      order_amount: orderAmountDecimal,
      order_currency: currency,
      customer_details: {
        customer_id: customerId,
        customer_email: customerEmail,
        customer_phone: customerPhone,
      },
      order_meta: {
        return_url: returnUrl,
        notify_url: `${process.env.BACKEND_URL}/webhooks/cashfree`,
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': API_VERSION,
        'x-client-id': clientId,
        'x-client-secret': clientSecret,
        'x-idempotency-key': orderId,
      },
      timeout: 15000,
    }
  );

  return response.data; // { cf_order_id, order_id, payment_session_id, order_status, ... }
}

/**
 * Fetch an order's current status directly from Cashfree — used by the
 * checkout confirmation path and by the nightly reconciliation job, never
 * by the webhook handler itself (which trusts its own verified payload).
 */
async function getOrder(orderId) {
  const clientId = process.env.CASHFREE_APP_ID;
  const clientSecret = process.env.CASHFREE_SECRET_KEY;
  if (!clientId || !clientSecret) {
    throw new Error('CASHFREE_APP_ID/CASHFREE_SECRET_KEY are not configured');
  }

  const response = await axios.get(`${getBaseUrl()}/pg/orders/${encodeURIComponent(orderId)}`, {
    headers: {
      'x-api-version': API_VERSION,
      'x-client-id': clientId,
      'x-client-secret': clientSecret,
    },
    timeout: 15000,
  });

  return response.data;
}

/**
 * Fetch every payment attempt against an order — used by the nightly
 * reconciliation job to get payment-method detail (for country inference)
 * when self-healing an order Cashfree shows PAID but our DB still shows
 * CREATED. `getOrder` alone only reports order-level status, not the
 * payment attempt's method/country.
 */
async function getPaymentsForOrder(orderId) {
  const clientId = process.env.CASHFREE_APP_ID;
  const clientSecret = process.env.CASHFREE_SECRET_KEY;
  if (!clientId || !clientSecret) {
    throw new Error('CASHFREE_APP_ID/CASHFREE_SECRET_KEY are not configured');
  }

  const response = await axios.get(`${getBaseUrl()}/pg/orders/${encodeURIComponent(orderId)}/payments`, {
    headers: {
      'x-api-version': API_VERSION,
      'x-client-id': clientId,
      'x-client-secret': clientSecret,
    },
    timeout: 15000,
  });

  return response.data; // array of payment attempts
}

module.exports = { API_VERSION, generateOrderId, createOrder, getOrder, getPaymentsForOrder };
