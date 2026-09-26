/**
 * In-process scheduling that stays correct with any number of instances.
 *
 * Every API instance runs the same timers. Two things turn "N instances each
 * run every job" into "each job runs once per interval":
 *
 *   1. A Postgres advisory lock (pg_try_advisory_lock) per job. Only the
 *      instance that wins it runs the job; everyone else skips that tick. The
 *      lock is SESSION-level on a dedicated connection held for the whole run,
 *      so two runs of one job can never overlap — and if an instance dies
 *      mid-run, Postgres drops its connection and the lock with it. No stale
 *      claim to clean up.
 *
 *   2. A due-check inside the lock: the job only runs if its last SUCCESSFUL
 *      run (job_runs) started at least DUE_FRACTION of its interval ago. That
 *      is what stops a deploy, a restart or a scale-out from re-running every
 *      job at boot, and what stops instance B running a job instance A
 *      finished a minute ago.
 *
 * Timers tick more often than the interval (see tickMs), so a job runs close
 * to on time regardless of which instance's phase gets there first, and a
 * failed run is retried after RETRY_AFTER_FAILURE_MS rather than a full
 * interval later.
 *
 * RUN_IN_PROCESS_SCHEDULER=false turns every timer off (the queue worker keeps
 * running) — staging uses that, and it is the kill switch if a job misbehaves.
 */

const { Pool } = require('pg');
const prisma = require('../lib/prisma');
const { recordJobRun } = require('./jobRuns');

const DUE_FRACTION = 0.9;
const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;
const LOCK_NAMESPACE = 726354; // first key of the two-int advisory lock: "our scheduler"
const LOCK_POOL_MAX = 2;       // per instance; counted in the pool budget (lib/prisma.js)

let lockPool = null;

function getLockPool() {
  if (!lockPool) {
    lockPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: LOCK_POOL_MAX,
      // Busy means another job on this instance holds both connections; skip
      // the tick rather than queue behind it.
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 60 * 1000,
    });
    lockPool.on('error', (err) => console.error('[Scheduler] Lock pool error:', err.message));
  }
  return lockPool;
}

async function closeLockPool() {
  const pool = lockPool;
  lockPool = null;
  if (pool) await pool.end().catch(() => {});
}

function schedulerEnabled() {
  return String(process.env.RUN_IN_PROCESS_SCHEDULER ?? 'true').trim().toLowerCase() !== 'false';
}

/** How often a job's timer fires: a sixth of its interval, at least a minute. */
function tickMs(intervalMs) {
  return Math.min(intervalMs, Math.max(60 * 1000, Math.floor(intervalMs / 6)));
}

/**
 * Is `jobName` due? Due when the last successful run started at least 90% of
 * the interval ago AND the last attempt of any outcome is not too recent (so a
 * failing job retries on a sensible cadence instead of every tick).
 */
async function isDue(jobName, intervalMs, now = Date.now()) {
  const [lastSuccess, lastAttempt] = await Promise.all([
    prisma.jobRun.findFirst({
      where: { jobName, success: true },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    }),
    prisma.jobRun.findFirst({
      where: { jobName },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    }),
  ]);
  const sinceSuccess = lastSuccess ? now - lastSuccess.startedAt.getTime() : Infinity;
  const sinceAttempt = lastAttempt ? now - lastAttempt.startedAt.getTime() : Infinity;
  return (
    sinceSuccess >= DUE_FRACTION * intervalMs &&
    sinceAttempt >= Math.min(DUE_FRACTION * intervalMs, RETRY_AFTER_FAILURE_MS)
  );
}

/**
 * Run `fn` as `jobName` if this instance wins the lock and the job is due.
 *
 * @returns {Promise<{ran: boolean, reason?: 'locked'|'not_due'|'busy'|'disabled', result?: any}>}
 *   Rejects only if the job itself threw (after recording the failure).
 */
async function runIfDue(jobName, intervalMs, fn, { pool = getLockPool(), enabled } = {}) {
  if (enabled && !enabled()) return { ran: false, reason: 'disabled' };

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.warn(`[Scheduler] ${jobName}: no lock connection this tick (${err.message}); skipping.`);
    return { ran: false, reason: 'busy' };
  }

  let locked = false;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked', [
      LOCK_NAMESPACE,
      `job:${jobName}`,
    ]);
    locked = rows[0].locked === true;
    if (!locked) return { ran: false, reason: 'locked' };

    // Checked INSIDE the lock: another instance may have finished this job
    // between our tick and our lock.
    if (!(await isDue(jobName, intervalMs))) return { ran: false, reason: 'not_due' };

    const result = await recordJobRun(jobName, fn);
    return { ran: true, result };
  } finally {
    if (locked) {
      await client
        .query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK_NAMESPACE, `job:${jobName}`])
        .catch((err) => console.error(`[Scheduler] ${jobName}: unlock failed:`, err.message));
    }
    client.release();
  }
}

const timers = [];

/**
 * Register a job on this instance's timers.
 *
 * @param {object} job
 * @param {string} job.name
 * @param {number} job.intervalMs
 * @param {() => Promise<any>} job.fn
 * @param {() => boolean} [job.enabled]  checked at RUN time (e.g. isBillingEnabled)
 * @param {number} [job.firstTickMs]     delay before the first tick
 */
function schedule({ name, intervalMs, fn, enabled, firstTickMs }) {
  const tick = () =>
    runIfDue(name, intervalMs, fn, { enabled }).catch((err) =>
      console.error(`[Jobs] ${name} failed:`, err.message)
    );
  // A small random offset on the first tick, so instances booted together do
  // not all reach for the same lock in the same millisecond.
  const first = setTimeout(tick, firstTickMs ?? 5000 + Math.floor(Math.random() * 25000));
  const every = setInterval(tick, tickMs(intervalMs));
  for (const t of [first, every]) {
    if (typeof t.unref === 'function') t.unref();
    timers.push(t);
  }
}

/** Stop every timer registered here. In-flight runs finish on their own. */
function stopScheduler() {
  for (const t of timers.splice(0)) {
    clearTimeout(t);
    clearInterval(t);
  }
}

module.exports = {
  runIfDue,
  isDue,
  schedule,
  stopScheduler,
  schedulerEnabled,
  closeLockPool,
  tickMs,
  DUE_FRACTION,
  LOCK_POOL_MAX,
};
