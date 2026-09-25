/**
 * Wires the `ai-processing` queue to its job processor and exposes a single
 * `enqueueMessageAnalysis()` helper for producers (the webhook route).
 *
 * Call `startWorkers()` once from src/index.js at boot. This keeps the
 * webhook route decoupled from queue/worker internals — it just calls
 * enqueueMessageAnalysis(messageId) and returns immediately.
 */

const { getJobSystem } = require('../lib/queue');
const { processMessageAnalysis, sweepStalledAnalyses } = require('./messageAnalysisJob');
const { pruneWebhookPayloads } = require('./retentionJob');
const { expireFinishedTrials, sendTrialEndingWarnings } = require('./trialJob');
const { runHousekeeping } = require('./purgeJob');
const { reconcileRecentOrders } = require('./billingReconciliationJob');
const { sweepElapsedCycles } = require('./entitlementCycleJob');
const { sendRenewalReminders } = require('./renewalReminderJob');
const { isBillingEnabled } = require('../lib/billingFlags');
const { recordJobRun } = require('./jobRuns');
const { rollupAiUsage } = require('./aiUsageJob');
const { runTokenMaintenance } = require('./tokenRefreshJob');
const { runAlertChecks } = require('./alertJob');

// Every scheduled run is recorded in job_runs (./jobRuns.js) for the admin
// health page and the Gate 7 alert cron. `track` keeps each job's existing
// catch-and-log: recordJobRun re-throws, the .catch below logs as before.
const track = (name, fn) => () => recordJobRun(name, fn);

const QUEUE_NAME = 'ai-processing';
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TRIAL_INTERVAL_MS = 60 * 60 * 1000;        // hourly: a 3-day trial needs finer granularity than the retention sweep
const HOUSEKEEPING_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BILLING_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // nightly
const ENTITLEMENT_CYCLE_INTERVAL_MS = 60 * 60 * 1000;  // hourly: a cycle boundary should not sit unrolled for long
const RENEWAL_REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000; // 4x/day: day-27/29/expiry/grace windows only need day resolution
const AI_USAGE_ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily: roll up ai_call_logs, purge raw rows > 30 days
const TOKEN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily: refresh IG tokens within 10 days of expiry
const ALERT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // admin threshold alerts (Gate 7)
let started = false;
let sweepTimer = null;
let retentionTimer = null;
let trialTimer = null;
let housekeepingTimer = null;
let billingReconciliationTimer = null;
let entitlementCycleTimer = null;
let renewalReminderTimer = null;
let aiUsageTimer = null;
let tokenRefreshTimer = null;
let alertTimer = null;

function startWorkers() {
  const jobSystem = getJobSystem(QUEUE_NAME, { concurrency: 3 });

  if (!started) {
    jobSystem.registerProcessor(
      async (job) => {
        if (job.name === 'message.analysis') {
          return processMessageAnalysis(job);
        }
        console.warn(`[Jobs] Unknown job name "${job.name}", ignoring.`);
      },
      { concurrency: 3 }
    );

    // Reclaim messages whose worker died mid-analysis. Without this they sit
    // in 'processing' forever and are never classified.
    //
    // UNVERIFIED for multi-instance: with N instances this interval runs N
    // times. The sweep itself is an idempotent conditional updateMany so the
    // duplicate runs are harmless, but it has only been exercised
    // single-instance. Revisit when Redis lands (H1/H2/H11).
    const runSweep = track('stalled_analysis_sweep', sweepStalledAnalyses);
    runSweep().catch((err) =>
      console.error('[Jobs] Initial stalled-analysis sweep failed:', err.message)
    );
    sweepTimer = setInterval(() => {
      runSweep().catch((err) =>
        console.error('[Jobs] Stalled-analysis sweep failed:', err.message)
      );
    }, SWEEP_INTERVAL_MS);
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

    // Enforce the published 30-day limit on stored webhook payloads, which
    // contain customers' message text. Previously this was a manual admin
    // button, so in practice nothing ever expired.
    //
    // UNVERIFIED for multi-instance, same as the sweeper above: idempotent
    // conditional updateMany, so N concurrent runs are harmless, but only
    // exercised single-instance.
    const runRetention = () =>
      track('webhook_payload_retention', pruneWebhookPayloads)().catch((err) =>
        console.error('[Jobs] Webhook payload retention sweep failed:', err.message)
      );
    runRetention();
    retentionTimer = setInterval(runRetention, RETENTION_INTERVAL_MS);
    if (typeof retentionTimer.unref === 'function') retentionTimer.unref();

    // Trial lifecycle. Hourly, because a 3-day trial expiring up to six hours
    // late is a user still being charged nothing while auto-reply keeps
    // sending on their behalf.
    //
    // Re-enabled (Gate 4), now gated on BILLING_ENABLED rather than commented
    // out. These sweeps email trial countdown/expiry notices, and the reason
    // they were disabled still holds while the flag is off: a Meta reviewer
    // connecting an account must not receive billing mail for a product with
    // no billing. The flag restores that guarantee without leaving dead code
    // in the tree.
    if (isBillingEnabled()) {
      const runTrials = async () => {
        try {
          await recordJobRun('trial_sweep', async () => {
            await expireFinishedTrials();
            await sendTrialEndingWarnings({ intervalMs: TRIAL_INTERVAL_MS });
          });
        } catch (err) {
          console.error('[Jobs] Trial sweep failed:', err.message);
        }
      };
      runTrials();
      trialTimer = setInterval(runTrials, TRIAL_INTERVAL_MS);
      if (typeof trialTimer.unref === 'function') trialTimer.unref();
    }

    // Housekeeping: webhook_deliveries (MANDATORY — every inbound DM writes a
    // row, see FINDINGS.md D4), expired auth tokens, spent OAuth nonces, and
    // ledger rows past their retention date.
    const runHousekeep = () =>
      track('housekeeping', runHousekeeping)().catch((err) =>
        console.error('[Jobs] Housekeeping sweep failed:', err.message)
      );
    runHousekeep();
    housekeepingTimer = setInterval(runHousekeep, HOUSEKEEPING_INTERVAL_MS);
    if (typeof housekeepingTimer.unref === 'function') housekeepingTimer.unref();

    // Nightly billing reconciliation — the backstop for a dropped Cashfree
    // webhook (see jobs/billingReconciliationJob.js). Gated on
    // BILLING_ENABLED so it does nothing (not even a query) while billing
    // is dark — there can be no Order rows to reconcile yet, but this
    // avoids a scheduled task doing pointless work pre-launch.
    if (isBillingEnabled()) {
      const runBillingReconciliation = () =>
        track('billing_reconciliation', reconcileRecentOrders)().catch((err) =>
          console.error('[Jobs] Billing reconciliation sweep failed:', err.message)
        );
      runBillingReconciliation();
      billingReconciliationTimer = setInterval(runBillingReconciliation, BILLING_RECONCILIATION_INTERVAL_MS);
      if (typeof billingReconciliationTimer.unref === 'function') billingReconciliationTimer.unref();

      // Cycle boundaries for tenants who did NOT renew — the only thing that
      // resets the classification burst guard on the clock rather than on a
      // payment. See jobs/entitlementCycleJob.js.
      const runEntitlementCycle = () =>
        track('entitlement_cycle', sweepElapsedCycles)().catch((err) =>
          console.error('[Jobs] Entitlement cycle sweep failed:', err.message)
        );
      runEntitlementCycle();
      entitlementCycleTimer = setInterval(runEntitlementCycle, ENTITLEMENT_CYCLE_INTERVAL_MS);
      if (typeof entitlementCycleTimer.unref === 'function') entitlementCycleTimer.unref();

      // Renewal reminder sequence (day 27/29/expiry/grace-day-2). Registered
      // here by Wave 0 so Gate 7 implements jobs/renewalReminderJob.js
      // without touching this shared file. A no-op stub until then.
      const runRenewalReminders = () =>
        track('renewal_reminders', sendRenewalReminders)().catch((err) =>
          console.error('[Jobs] Renewal reminder sweep failed:', err.message)
        );
      runRenewalReminders();
      renewalReminderTimer = setInterval(runRenewalReminders, RENEWAL_REMINDER_INTERVAL_MS);
      if (typeof renewalReminderTimer.unref === 'function') renewalReminderTimer.unref();
    }

    // Daily AI usage roll-up + raw log purge (Gate 3). Runs whatever
    // BILLING_ENABLED says: it is monitoring, not billing.
    const runAiUsage = () =>
      track('ai_usage_rollup', () => rollupAiUsage())().catch((err) =>
        console.error('[Jobs] AI usage roll-up failed:', err.message)
      );
    runAiUsage();
    aiUsageTimer = setInterval(runAiUsage, AI_USAGE_ROLLUP_INTERVAL_MS);
    if (typeof aiUsageTimer.unref === 'function') aiUsageTimer.unref();

    // Instagram long-lived token refresh + expired-token flagging (Gate 3B).
    // Not behind BILLING_ENABLED: a dead token stops DMs for everyone.
    const runTokens = () =>
      track('instagram_token_refresh', runTokenMaintenance)().catch((err) =>
        console.error('[Jobs] Instagram token maintenance failed:', err.message)
      );
    runTokens();
    tokenRefreshTimer = setInterval(runTokens, TOKEN_REFRESH_INTERVAL_MS);
    if (typeof tokenRefreshTimer.unref === 'function') tokenRefreshTimer.unref();

    // Admin threshold alerts (Gate 7), every 5 minutes. Not run at boot: a
    // fresh process has no recent data, and a deploy should not page anyone.
    const runAlerts = () =>
      track('admin_alerts', () => runAlertChecks())().catch((err) =>
        console.error('[Jobs] Admin alert checks failed:', err.message)
      );
    alertTimer = setInterval(runAlerts, ALERT_CHECK_INTERVAL_MS);
    if (typeof alertTimer.unref === 'function') alertTimer.unref();

    started = true;
    console.log(`[Jobs] AI processing worker started (mode: ${jobSystem.mode}).`);
  }

  return jobSystem;
}

/**
 * Enqueue AI analysis for a message. Safe to call multiple times for the
 * same message — the jobId keeps it idempotent at the queue level, and the
 * processor itself double-checks `aiStatus` before doing any work.
 *
 * @param {string} messageId
 * @param {object} [opts]
 * @param {number} [opts.delayMs]          defer the first run (hourly-throttle requeue)
 * @param {number} [opts.throttleAttempt]  which requeue this is; also varies the jobId
 * @param {string} [opts.jobKey]           varies the jobId for a deliberate re-run of a message
 *                                          that was already enqueued once (skipped-message recovery)
 *
 * THE jobId MUST VARY PER REQUEUE. Both queue backends dedupe on jobId —
 * the in-process one keeps a `_seenJobIds` set that is never cleared — so
 * re-adding `analyze-<id>` for a message that has already been enqueued
 * once is silently dropped. For an ordinary duplicate that is exactly the
 * behaviour we want; for a deliberate throttle requeue it would lose the
 * message permanently. Suffixing the attempt keeps normal dedupe intact
 * while letting the retry through.
 */
async function enqueueMessageAnalysis(messageId, { delayMs = 0, throttleAttempt = 0, jobKey = null } = {}) {
  const jobSystem = startWorkers();
  let jobId = throttleAttempt > 0 ? `analyze-${messageId}-t${throttleAttempt}` : `analyze-${messageId}`;
  if (jobKey) jobId = `${jobId}-${jobKey}`;
  try {
    await jobSystem.add(
      'message.analysis',
      { messageId, throttleAttempt },
      { jobId, attempts: 3, backoffMs: 3000, delayMs }
    );
  } catch (err) {
    console.error('[Jobs] Failed to enqueue message.analysis job:', err.message);
  }
}

module.exports = { startWorkers, enqueueMessageAnalysis };
