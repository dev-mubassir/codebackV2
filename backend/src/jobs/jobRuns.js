/**
 * Records every scheduled job run in job_runs (Gate 3) — the admin health
 * page's "last run and status per cron job", and the alert cron's "any cron
 * job failure" (Gate 7).
 *
 * recordJobRun(name, fn) writes a started row, runs fn, then stamps finished,
 * success and — on failure — the FIRST LINE of the error, bounded. A job's
 * error text can come from Prisma, whose later lines dump query arguments
 * (message text included); the first line never does.
 *
 * `details` stores what fn returns when it is a number or a flat object of
 * numbers (e.g. { refreshed: 3 }) — counts only, never data.
 *
 * Never throws for bookkeeping reasons: a failed job_runs write must not stop
 * the job it describes. The job's own error is re-thrown, so existing
 * callers' catch-and-log behaviour is unchanged.
 */

const prisma = require('../lib/prisma');

const RETENTION_DAYS = 30;

function safeErrorLine(err) {
  return String((err && err.message) || err || 'error').split('\n')[0].slice(0, 300);
}

function countsOnly(result) {
  if (typeof result === 'number' && Number.isFinite(result)) return { count: result };
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

async function recordJobRun(jobName, fn) {
  const run = await prisma.jobRun
    .create({ data: { jobName }, select: { id: true } })
    .catch((err) => {
      console.error(`[JobRun] Could not record the start of ${jobName}:`, err.message);
      return null;
    });

  const finish = (data) =>
    run
      ? prisma.jobRun
          .update({ where: { id: run.id }, data: { finishedAt: new Date(), ...data } })
          .catch((err) => console.error(`[JobRun] Could not record the end of ${jobName}:`, err.message))
      : null;

  try {
    const result = await fn();
    await finish({ success: true, details: countsOnly(result) });
    return result;
  } catch (err) {
    await finish({ success: false, error: safeErrorLine(err) });
    throw err;
  }
}

/** Latest run of every job, for the health page. */
async function latestRunPerJob() {
  return prisma.jobRun.findMany({
    distinct: ['jobName'],
    orderBy: [{ jobName: 'asc' }, { startedAt: 'desc' }],
    select: { jobName: true, startedAt: true, finishedAt: true, success: true, error: true, details: true },
  });
}

async function purgeOldJobRuns({ olderThanDays = RETENTION_DAYS } = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.jobRun.deleteMany({ where: { startedAt: { lt: cutoff } } });
  return count;
}

module.exports = { recordJobRun, latestRunPerJob, purgeOldJobRuns, safeErrorLine, countsOnly };
