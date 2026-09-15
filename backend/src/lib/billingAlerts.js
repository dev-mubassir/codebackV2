/**
 * CRITICAL billing alerts to a human, through lib/email, to SUPPORT_EMAIL.
 *
 * One path for every "money moved and something is not right" event, so each
 * new case is a kind in this list rather than another hand-rolled
 * SUPPORT_EMAIL lookup:
 *
 *   paidAfterExpiry         a confirmed payment on an order already EXPIRED —
 *                           money taken, nothing granted
 *   staleOrdersExpired      the reconciliation job's 7-day safety net fired;
 *                           with 60-minute Cashfree expiry it should never need to
 *   partialRefund           a partial refund succeeded — money left, access stays
 *   refundOutsideSiffty     a refund we did not initiate (e.g. from the Cashfree
 *                           dashboard) reached the webhook
 *   refundSnapshotMissing   a refunded order was fulfilled before grant snapshots
 *                           existed, so revocation fell back to a best estimate
 *
 * (The downgrade anomaly keeps its own long-standing path in
 * entitlementService.alertPlanAnomaly.)
 *
 * NEVER THROWS. Every caller has already done the money-moving part; a failed
 * alert must not undo it or fail a webhook. The full detail is always logged
 * first, so a missing SUPPORT_EMAIL or a failed send still leaves a record.
 */

// Bound as `mailer`, never `email` — see routes/auth.js.
const mailer = require('./email');

async function alertBillingOps(kind, details) {
  console.error(`[BillingAlert] ${kind}:`, JSON.stringify(details));
  const to = (process.env.SUPPORT_EMAIL || '').trim();
  if (!to) {
    console.error(`[BillingAlert] SUPPORT_EMAIL is not set — the ${kind} alert above reached no human.`);
    return false;
  }
  try {
    await mailer.sendBillingOpsAlert(to, { kind, details });
    return true;
  } catch (err) {
    console.error(`[BillingAlert] Failed to send the ${kind} alert — detail logged above:`, err.message);
    return false;
  }
}

module.exports = { alertBillingOps };
