/**
 * Wires the `ai-processing` queue to its job processor and exposes a single
 * `enqueueMessageAnalysis()` helper for producers (the webhook route).
 *
 * Call `startWorkers()` once from src/index.js at boot. This keeps the
 * webhook route decoupled from queue/worker internals — it just calls
 * enqueueMessageAnalysis(messageId) and returns immediately.
 */

const { getJobSystem, closeQueues } = require('../lib/queue');
const { processMessageAnalysis, sweepStalledAnalyses } = require('./messageAnalysisJob');
const { pruneWebhookPayloads } = require('./retentionJob');
const { expireFinishedTrials, sendTrialEndingWarnings } = require('./trialJob');
const { runHousekeeping } = require('./purgeJob');
const { reconcileRecentOrders } = require('./billingReconciliationJob');
const { sweepElapsedCycles } = require('./entitlementCycleJob');
const { sendRenewalReminders } = require('./renewalReminderJob');
const { isBillingEnabled } = require('../lib/billingFlags');
const { rollupAiUsage } = require('./aiUsageJob');
const { runTokenMaintenance } = require('./tokenRefreshJob');
const { runAlertChecks } = require('./alertJob');
const { schedule, stopScheduler, schedulerEnabled, closeLockPool } = require('./scheduler');

const QUEUE_NAME = 'ai-processing';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * Every scheduled job. Each runs at most once per interval ACROSS ALL
 * INSTANCES — see ./scheduler.js (due-check + advisory lock) — and every run
 * is recorded in job_runs for the admin health page and the alert cron.
 *
 * `enabled` is evaluated at RUN time, not at boot: the billing jobs follow the
 * live BILLING_ENABLED / enforce_subscriptions setting, so an admin flipping it
 * takes effect on the next tick instead of on the next deploy. (At boot the
 * settings cache has not loaded yet, so a boot-time check would only ever see
 * the env default.)
 */
const JOBS = [
  // Reclaim messages whose worker died mid-analysis (or whose queued job was
  // lost — e.g. a Redis flush). Without this they sit unclassified forever.
  { name: 'stalled_analysis_sweep', intervalMs: 5 * MIN, fn: sweepStalledAnalyses },
  // Enforce the published 30-day limit on stored webhook payloads, which
  // contain customers' message text.
  { name: 'webhook_payload_retention', intervalMs: 6 * HOUR, fn: pruneWebhookPayloads },
  // Trial lifecycle. Hourly: a 3-day trial expiring hours late is a user still
  // getting auto-replies for free. Gated on billing: these send countdown
  // emails, which must not go out while billing is dark.
  {
    name: 'trial_sweep',
    intervalMs: HOUR,
    enabled: isBillingEnabled,
    fn: async () => {
      await expireFinishedTrials();
      await sendTrialEndingWarnings({ intervalMs: HOUR });
    },
  },
  // webhook_deliveries (every inbound DM writes a row), expired auth tokens,
  // spent OAuth nonces, ledger rows past retention.
  { name: 'housekeeping', intervalMs: 6 * HOUR, fn: runHousekeeping },
  // Nightly backstop for a dropped Cashfree webhook.
  { name: 'billing_reconciliation', intervalMs: 24 * HOUR, enabled: isBillingEnabled, fn: reconcileRecentOrders },
  // Cycle boundaries for tenants who did NOT renew.
  { name: 'entitlement_cycle', intervalMs: HOUR, enabled: isBillingEnabled, fn: sweepElapsedCycles },
  // Renewal reminder sequence (day 27/29/expiry/grace-day-2).
  { name: 'renewal_reminders', intervalMs: 6 * HOUR, enabled: isBillingEnabled, fn: sendRenewalReminders },
  // Daily AI usage roll-up + raw log purge. Monitoring, not billing.
  { name: 'ai_usage_rollup', intervalMs: 24 * HOUR, fn: () => rollupAiUsage() },
  // Instagram long-lived token refresh + expired-token flagging. Not behind
  // billing: a dead token stops DMs for everyone.
  { name: 'instagram_token_refresh', intervalMs: 24 * HOUR, fn: runTokenMaintenance },
  // Admin threshold alerts. First tick a full interval after boot: a fresh
  // process has no recent data, and a deploy should not page anyone.
  { name: 'admin_alerts', intervalMs: 5 * MIN, fn: () => runAlertChecks(), firstTickMs: 5 * MIN },
];

let started = false;

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

    if (schedulerEnabled()) {
      for (const job of JOBS) schedule(job);
      console.log(`[Jobs] In-process scheduler ON: ${JOBS.length} jobs, each once per interval across all instances.`);
    } else {
      console.log('[Jobs] In-process scheduler OFF (RUN_IN_PROCESS_SCHEDULER=false). Queue worker still runs.');
    }

    started = true;
    console.log(`[Jobs] AI processing worker started (mode: ${jobSystem.mode}).`);
  }

  return jobSystem;
}

/**
 * Graceful shutdown: stop the timers, let the queue worker finish or hand back
 * what it holds, close the scheduler's lock connections.
 */
async function stopWorkers() {
  stopScheduler();
  await closeQueues();
  await closeLockPool();
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

module.exports = { startWorkers, stopWorkers, enqueueMessageAnalysis, JOBS };
