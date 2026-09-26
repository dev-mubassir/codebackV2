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
const { recoverUnprocessedDeliveries, processDelivery, WEBHOOK_QUEUE } = require('../services/webhookDeliveries');

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
  // Webhook deliveries not processed 5 minutes after arrival — a crash
  // mid-processing, a redeploy, a lost queue job, a Redis/AI/DB outage — are
  // processed again from the stored payload (services/webhookDeliveries.js).
  { name: 'webhook_recovery', intervalMs: 2 * MIN, fn: () => recoverUnprocessedDeliveries() },
  // Reclaim analyses stranded in 'processing', and RE-ENQUEUE analyses whose
  // queued job was lost (Redis flush/outage) or that failed during an AI
  // outage — the DM itself is already saved and visible; only its
  // classification is retried.
  {
    name: 'stalled_analysis_sweep',
    intervalMs: 5 * MIN,
    fn: async () => {
      const reset = await sweepStalledAnalyses();
      const requeued = await requeueOrphanedAnalyses();
      return { reset, requeued };
    },
  },
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

    // The durable webhook inbox: one job per stored delivery. Processing is
    // claimed per row and idempotent per message, so a job that also got
    // picked up by the recovery sweep does nothing the second time.
    getJobSystem(WEBHOOK_QUEUE, { concurrency: 5 }).registerProcessor(
      async (job) => {
        if (job.name === 'webhook.process') return processDelivery(job.data.deliveryId);
        console.warn(`[Jobs] Unknown webhook job "${job.name}", ignoring.`);
      },
      { concurrency: 5 }
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

const ENQUEUE_TIMEOUT_MS = 2000;
const ORPHAN_AFTER_MS = 15 * MIN;
const ORPHAN_WINDOW_MS = 24 * HOUR;
const ORPHAN_MAX_ATTEMPTS = 12; // 3 queue attempts x 4 recovery rounds
const ORPHAN_BATCH = 200;

/**
 * Re-enqueue analyses that nothing will ever pick up again:
 *   - 'pending' for 15+ minutes: its queued job was lost (Redis flushed or
 *     unreachable when it was enqueued, an in-process job lost on restart);
 *   - 'failed' in the last 24h with attempts left: an AI outage outlasted the
 *     queue's own retries.
 *
 * The jobKey is the current 15-minute bucket, so each message gets at most one
 * recovery job per bucket however many instances or sweeps run. Messages older
 * than 24h are left alone — and a recovered message never auto-replies late
 * (messageAnalysisJob's recoveredTooLate guard).
 */
async function requeueOrphanedAnalyses({ now = Date.now() } = {}) {
  const prisma = require('../lib/prisma');
  const orphans = await prisma.message.findMany({
    where: {
      direction: 'inbound',
      createdAt: { gte: new Date(now - ORPHAN_WINDOW_MS) },
      OR: [
        { aiStatus: 'pending', createdAt: { lt: new Date(now - ORPHAN_AFTER_MS) } },
        { aiStatus: 'failed', attempts: { lt: ORPHAN_MAX_ATTEMPTS } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: ORPHAN_BATCH,
    select: { id: true },
  });
  const bucket = Math.floor(now / ORPHAN_AFTER_MS);
  for (const { id } of orphans) {
    await enqueueMessageAnalysis(id, { jobKey: `recover${bucket}` });
  }
  if (orphans.length) console.log(`[Sweeper] Re-enqueued ${orphans.length} orphaned or failed analysis job(s).`);
  return orphans.length;
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
  // Bounded: with Redis down, BullMQ would otherwise wait for it forever and
  // hold up the webhook delivery that called this (the DM is already saved).
  // A job that does not get queued is re-enqueued later by the stalled-
  // analysis sweep (requeueOrphanedAnalyses), so giving up here loses nothing.
  let timer;
  try {
    await Promise.race([
      jobSystem.add('message.analysis', { messageId, throttleAttempt }, { jobId, attempts: 3, backoffMs: 3000, delayMs }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('queue did not accept the job in time')), ENQUEUE_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.error('[Jobs] Failed to enqueue message.analysis job (the sweep will retry):', err.message);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { startWorkers, stopWorkers, enqueueMessageAnalysis, requeueOrphanedAnalyses, JOBS };
