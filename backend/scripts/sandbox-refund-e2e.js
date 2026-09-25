#!/usr/bin/env node
/**
 * DEV ONLY — a real refund, end to end, against the CASHFREE SANDBOX.
 *
 * Every test mocks Cashfree. This does not: it creates a real sandbox order,
 * pays it with Cashfree's public test UPI id, waits for the payment webhook to
 * reach the running local backend (through your tunnel), issues a real refund
 * through refundService, waits for REFUND_STATUS_WEBHOOK, and checks the
 * revocation and the ledger. It found two things no mocked test could: Cashfree
 * ids larger than a JavaScript number (lib/cashfree.js parseCashfreeJson), and a
 * refund webhook that never arrived because it was not configured in the
 * Cashfree dashboard.
 *
 * GUARDS — it refuses to run unless ALL hold:
 *   - NODE_ENV is not "production"
 *   - DATABASE_URL points at localhost (same rule as dev-reset-trial.js)
 *   - the Cashfree base URL resolves to the sandbox host (CASHFREE_ENV / NODE_ENV)
 * It writes to the LOCAL database only, and nothing it does moves real money.
 *
 * PREREQUISITES
 *   - the backend running locally with BILLING_ENABLED=true
 *   - BACKEND_URL reachable from the internet (a tunnel): it is the notify_url
 *   - for refund webhooks: https://<BACKEND_URL>/webhooks/cashfree added in the
 *     Cashfree sandbox dashboard (Developers -> Webhooks) with refund events
 *
 * USAGE (from backend/)
 *   npm run billing:sandbox-e2e                        strict: exit 0 only if BOTH webhooks arrive live
 *   npm run billing:sandbox-e2e -- --allow-resync      accept reconciliation / re-sync fallbacks
 *   npm run billing:sandbox-e2e -- --refund-webhook-wait 300
 *   npm run billing:sandbox-e2e -- --cleanup           dry run: list every row this script created
 *   npm run billing:sandbox-e2e -- --cleanup --apply   delete them
 *
 * Exit codes: 0 all checks passed, 1 a check failed or an error, 2 refused.
 *
 * DATA. Each run creates one tenant named sandbox-refund-e2e-<timestamp>@test.codeback,
 * one order and one refund. Orders, refunds and ledger rows are normally never
 * deleted; --cleanup is the dev-only exception and touches ONLY tenants whose
 * email matches that exact pattern.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function refuse(message, code = 2) {
  console.error(`\n  REFUSED: ${message}\n`);
  process.exit(code);
}

if (process.env.NODE_ENV === 'production') {
  refuse('NODE_ENV is "production". This script is for local development only.');
}

let dbHost;
try {
  dbHost = new URL(process.env.DATABASE_URL).hostname;
} catch {
  refuse('DATABASE_URL is missing or unparseable.');
}
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
if (!LOCAL_HOSTS.has(dbHost)) {
  refuse(`DATABASE_URL points at "${dbHost}", not a local database. This script only runs against localhost.`);
}

const { getBaseUrl, cashfreeEnvironment, cashfreeResponseParser } = require('../src/lib/cashfree');
if (cashfreeEnvironment() !== 'sandbox' || new URL(getBaseUrl()).hostname !== 'sandbox.cashfree.com') {
  refuse(`Cashfree resolves to ${getBaseUrl()} (${cashfreeEnvironment()}), not the sandbox. Set CASHFREE_ENV=sandbox.`);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const numberArg = (name, fallback) => {
  const at = args.indexOf(name);
  const n = at >= 0 ? Number(args[at + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const TENANT_EMAIL = /^sandbox-refund-e2e-\d+@test\.codeback$/;
const TERMINAL = ['SUCCESS', 'CANCELLED', 'FAILED'];

const axios = require('axios');
const prisma = require('../src/lib/prisma');
const cashfreeOrders = require('../src/lib/cashfreeOrders');
const { fulfillPaidOrder } = require('../src/services/billingFulfillment');
const refundService = require('../src/services/refundService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (title, value) =>
  console.log(`\n--- ${title}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`);
const REDACT = /secret|token|session_id|upi_id|customer_phone|customer_email/i;
const redact = (obj) => JSON.parse(JSON.stringify(obj, (k, v) => (REDACT.test(k) ? '[redacted]' : v)));

async function waitFor(check, { timeoutMs, intervalMs = 3000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

// ---------------------------------------------------------------------------
// --cleanup
// ---------------------------------------------------------------------------
async function cleanup(apply) {
  const candidates = await prisma.user.findMany({
    where: { email: { startsWith: 'sandbox-refund-e2e-', endsWith: '@test.codeback' } },
    select: { id: true, email: true },
  });
  const users = candidates.filter((u) => TENANT_EMAIL.test(u.email));
  const tenantIds = users.map((u) => u.id);
  const orderIds = (await prisma.order.findMany({ where: { tenantId: { in: tenantIds } }, select: { cashfreeOrderId: true } })).map(
    (o) => o.cashfreeOrderId
  );

  const scope = {
    refunds: { OR: [{ tenantId: { in: tenantIds } }, { cashfreeOrderId: { in: orderIds } }] },
    paymentAttempts: { cashfreeOrderId: { in: orderIds } },
    creditLedger: { tenantId: { in: tenantIds } },
    renewalReminders: { tenantId: { in: tenantIds } },
    orders: { tenantId: { in: tenantIds } },
  };
  const counts = {
    tenants: users.length,
    refunds: await prisma.refund.count({ where: scope.refunds }),
    paymentAttempts: await prisma.paymentAttempt.count({ where: scope.paymentAttempts }),
    creditLedger: await prisma.creditLedger.count({ where: scope.creditLedger }),
    renewalReminders: await prisma.renewalReminder.count({ where: scope.renewalReminders }),
    orders: await prisma.order.count({ where: scope.orders }),
    entitlements: await prisma.entitlement.count({ where: { userId: { in: tenantIds } } }),
  };

  console.log(`\n  Sandbox e2e data in the local database (host: ${dbHost})`);
  for (const u of users) console.log(`    tenant ${u.id}  ${u.email}`);
  for (const id of orderIds) console.log(`    order  ${id}`);
  console.log(`    ${JSON.stringify(counts)}`);

  if (users.length === 0) {
    console.log('\n  Nothing to clean.\n');
    return 0;
  }
  if (!apply) {
    console.log('\n  Dry run — nothing deleted. Re-run with --cleanup --apply.\n');
    return 0;
  }

  // One transaction: children first. The user delete cascades its entitlement
  // and profile rows; orders, refunds, attempts and ledger rows deliberately
  // have no relation to User, so they are removed explicitly.
  await prisma.$transaction([
    prisma.refund.deleteMany({ where: scope.refunds }),
    prisma.paymentAttempt.deleteMany({ where: scope.paymentAttempts }),
    prisma.creditLedger.deleteMany({ where: scope.creditLedger }),
    prisma.renewalReminder.deleteMany({ where: scope.renewalReminders }),
    prisma.order.deleteMany({ where: scope.orders }),
    prisma.user.deleteMany({ where: { id: { in: tenantIds } } }),
  ]);
  console.log('\n  Deleted.\n');
  return 0;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
async function run() {
  const allowResync = flag('--allow-resync');
  const paymentWebhookWaitMs = numberArg('--payment-webhook-wait', 90) * 1000;
  const refundWebhookWaitMs = numberArg('--refund-webhook-wait', 180) * 1000;
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

  if (process.env.BILLING_ENABLED !== 'true') {
    refuse('BILLING_ENABLED is not "true" — the local webhook route would answer 404.');
  }
  section('environment', {
    database: dbHost,
    cashfree: getBaseUrl(),
    notifyUrl: `${process.env.BACKEND_URL}/webhooks/cashfree`,
    strict: !allowResync,
  });

  const plan = await prisma.plan.findUnique({ where: { code: 'STARTER' }, include: { prices: true } });
  const price = plan?.prices.find((p) => p.billingRegion === 'IN');
  if (!price) throw new Error('The local catalogue has no STARTER price for IN.');

  const user = await prisma.user.create({
    data: { email: `sandbox-refund-e2e-${Date.now()}@test.codeback`, name: 'Sandbox refund e2e', emailVerifiedAt: new Date(), onboardingCompleted: true },
  });
  section('test tenant', { id: user.id, email: user.email });

  // 1. A real sandbox order.
  const orderId = cashfreeOrders.generateOrderId();
  await prisma.order.create({ data: { cashfreeOrderId: orderId, tenantId: user.id, planCode: 'STARTER', amount: price.amount, currency: price.currency } });
  const cfOrder = await cashfreeOrders.createOrder({
    orderId,
    amountInPaise: price.amount,
    currency: price.currency,
    customerId: user.id,
    customerEmail: user.email,
    customerPhone: '9999999999',
    returnUrl: `${process.env.FRONTEND_URL}/billing?order=${orderId}`,
  });
  section('1. createOrder', redact({ order_id: cfOrder.order_id, cf_order_id: cfOrder.cf_order_id, order_status: cfOrder.order_status, order_expiry_time: cfOrder.order_expiry_time }));
  check('createOrder accepted', cfOrder.order_status === 'ACTIVE', cfOrder.order_status);

  // 2. Pay with the public sandbox test UPI id (Order Pay authenticates by session, no client secret).
  const pay = await axios.post(
    `${getBaseUrl()}/pg/orders/sessions`,
    { payment_session_id: cfOrder.payment_session_id, payment_method: { upi: { channel: 'collect', upi_id: 'testsuccess@gocash' } } },
    { headers: { 'Content-Type': 'application/json', 'x-api-version': cashfreeOrders.API_VERSION }, timeout: 20000, transformResponse: [cashfreeResponseParser] }
  );
  section('2. Order Pay', redact({ cf_payment_id: pay.data.cf_payment_id, payment_method: pay.data.payment_method, channel: pay.data.channel }));

  const paidAtCashfree = await waitFor(async () => ((await cashfreeOrders.getOrder(orderId)).order_status === 'PAID' ? true : null), { timeoutMs: 120000 });
  check('Cashfree reports PAID', paidAtCashfree);
  if (!paidAtCashfree) return finish(checks, { orderId, tenantId: user.id });

  // 3. The payment webhook, through the tunnel.
  let local = await waitFor(async () => {
    const o = await prisma.order.findUnique({ where: { cashfreeOrderId: orderId } });
    return o.status === 'PAID' ? o : null;
  }, { timeoutMs: paymentWebhookWaitMs });
  const paymentWebhookArrived = Boolean(local);
  if (!local) {
    const payment = (await cashfreeOrders.getPaymentsForOrder(orderId)).find((p) => p.payment_status === 'SUCCESS') || null;
    await fulfillPaidOrder({ cashfreeOrderId: orderId, payment, rawPayload: JSON.stringify({ reconciledFrom: 'sandbox_e2e', payment }), eventType: 'RECONCILIATION' });
    local = await prisma.order.findUnique({ where: { cashfreeOrderId: orderId } });
  }
  const attempts = await prisma.paymentAttempt.findMany({ where: { cashfreeOrderId: orderId } });
  section('3. fulfilment', {
    via: paymentWebhookArrived ? 'PAYMENT_SUCCESS_WEBHOOK' : 'reconciliation fallback',
    orderStatus: local.status,
    attempts: attempts.map((a) => ({ status: a.status, eventType: a.eventType, cfPaymentId: a.cfPaymentId })),
  });
  check('payment webhook arrived live', paymentWebhookArrived || allowResync, paymentWebhookArrived ? 'yes' : 'no (fallback used)');
  check('order PAID locally', local.status === 'PAID', local.status);
  check('one attempt row per payment (ids exact)', new Set(attempts.map((a) => a.cfPaymentId)).size === attempts.length && attempts.length === 1, attempts.map((a) => a.cfPaymentId).join(', '));
  if (pay.data.cf_payment_id != null) {
    check('stored cf_payment_id equals Cashfree’s, digit for digit', attempts.every((a) => a.cfPaymentId === String(pay.data.cf_payment_id)), `${pay.data.cf_payment_id}`);
  }

  // 4. A real refund.
  const eligibility = await refundService.getRefundEligibility(orderId);
  section('4. eligibility', { refundableAmount: eligibility.refundableAmount, policy: eligibility.policy });
  const started = await refundService.initiateRefund({ cashfreeOrderId: orderId, reason: 'Sandbox end-to-end refund test', initiatedBy: 'sandbox-e2e-script' });
  const { refundId } = started.refund;
  section('5. refund created', { refundId, status: started.refund.status, cfRefundId: started.refund.cfRefundId });
  check('Cashfree accepted the refund', ['PENDING', 'SUCCESS', 'ONHOLD'].includes(started.refund.status), started.refund.status);

  // 5. REFUND_STATUS_WEBHOOK. Wait for it BEFORE any re-sync: a re-sync that
  //    lands SUCCESS first makes a later webhook a no-op, which would hide
  //    whether delivery works at all.
  let refundWebhookSeen = false;
  let settled = await waitFor(async () => {
    const r = await prisma.refund.findUnique({ where: { refundId } });
    if ((r.rawPayload || '').includes('REFUND_STATUS_WEBHOOK')) refundWebhookSeen = true;
    return TERMINAL.includes(r.status) && refundWebhookSeen ? r : null;
  }, { timeoutMs: refundWebhookWaitMs, intervalMs: 5000 });
  let via = 'REFUND_STATUS_WEBHOOK';
  if (!settled) {
    via = 'admin re-sync fallback';
    settled = await waitFor(async () => {
      const result = await refundService.syncRefund(refundId);
      return TERMINAL.includes(result.refund?.status) ? result.refund : null;
    }, { timeoutMs: 300000, intervalMs: 20000 });
  }
  const refund = await prisma.refund.findUnique({ where: { refundId } });
  section('6. refund settled', { via, status: refund.status, arn: refund.arn, revokedAt: refund.revokedAt, revocation: refund.revocation, refundWebhookSeen });
  check('refund webhook arrived live', refundWebhookSeen || allowResync, refundWebhookSeen ? 'yes' : `no — nothing within ${refundWebhookWaitMs / 1000}s; check the dashboard webhook config`);
  check('refund SUCCESS', refund.status === 'SUCCESS', refund.status);
  check('grant revoked once', Boolean(refund.revokedAt), refund.revokedAt?.toISOString() || 'not revoked');

  // 6. Revocation and ledger.
  const e = await prisma.entitlement.findUnique({ where: { userId: user.id } });
  const ledger = await prisma.creditLedger.findMany({ where: { tenantId: user.id, pool: 'REPLY' }, orderBy: { createdAt: 'asc' } });
  const sum = ledger.reduce((s, r) => s + r.delta, 0);
  const held = e ? e.replyCreditsCurrent + e.replyCreditsBanked : 0;
  section('7. entitlement and ledger', {
    entitlement: e && { planCode: e.planCode, status: e.status, validUntil: e.validUntil, credits: held },
    ledger: ledger.map((r) => ({ type: r.type, delta: r.delta, source: r.source, note: r.note })),
  });
  check('access honestly removed (status NONE)', e?.status === 'NONE', e?.status);
  check('ledger sum equals held balance', sum === held, `sum ${sum}, held ${held}`);

  return finish(checks, { orderId, refundId, tenantId: user.id });
}

function finish(checks, ids) {
  console.log('\n--- RESULT');
  for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  console.log(`\n  ${ok ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}  ${JSON.stringify(ids)}`);
  console.log('  Remove this run’s data with: npm run billing:sandbox-e2e -- --cleanup --apply\n');
  return ok ? 0 : 1;
}

(async () => {
  let code = 1;
  try {
    code = flag('--cleanup') ? await cleanup(flag('--apply')) : await run();
  } catch (err) {
    console.error('\n  E2E ERROR:', err.response?.status || '', JSON.stringify(err.response?.data || err.message));
    code = 1;
  } finally {
    await prisma.$disconnect();
  }
  process.exit(code);
})();
