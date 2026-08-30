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

const QUEUE_NAME = 'ai-processing';
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
let started = false;
let sweepTimer = null;
let retentionTimer = null;

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
    sweepStalledAnalyses().catch((err) =>
      console.error('[Jobs] Initial stalled-analysis sweep failed:', err.message)
    );
    sweepTimer = setInterval(() => {
      sweepStalledAnalyses().catch((err) =>
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
      pruneWebhookPayloads().catch((err) =>
        console.error('[Jobs] Webhook payload retention sweep failed:', err.message)
      );
    runRetention();
    retentionTimer = setInterval(runRetention, RETENTION_INTERVAL_MS);
    if (typeof retentionTimer.unref === 'function') retentionTimer.unref();

    started = true;
    console.log(`[Jobs] AI processing worker started (mode: ${jobSystem.mode}).`);
  }

  return jobSystem;
}

/**
 * Enqueue AI analysis for a message. Safe to call multiple times for the
 * same message — the jobId keeps it idempotent at the queue level, and the
 * processor itself double-checks `aiStatus` before doing any work.
 */
async function enqueueMessageAnalysis(messageId) {
  const jobSystem = startWorkers();
  try {
    await jobSystem.add(
      'message.analysis',
      { messageId },
      { jobId: `analyze-${messageId}`, attempts: 3, backoffMs: 3000 }
    );
  } catch (err) {
    console.error('[Jobs] Failed to enqueue message.analysis job:', err.message);
  }
}

module.exports = { startWorkers, enqueueMessageAnalysis };
