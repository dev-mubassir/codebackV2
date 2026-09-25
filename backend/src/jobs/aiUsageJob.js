/**
 * Daily AI usage roll-up (Gate 3).
 *
 * Recomputes ai_usage_daily for the last few UTC days from ai_call_logs and
 * upserts it — a RECOMPUTE, not an increment, so running it twice (or on two
 * instances) gives the same numbers. Then deletes raw ai_call_logs rows older
 * than 30 days. Days older than the raw window are never recomputed, so their
 * roll-up rows keep the totals they had before the raw rows went.
 */

const prisma = require('../lib/prisma');

const RAW_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function rollupDay(dayStart) {
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const where = { createdAt: { gte: dayStart, lt: dayEnd } };
  const by = ['provider', 'model', 'jobType'];

  const [totals, failures] = await Promise.all([
    prisma.aiCallLog.groupBy({
      by,
      where,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, estimatedCost: true, latencyMs: true },
    }),
    prisma.aiCallLog.groupBy({ by, where: { ...where, success: false }, _count: { _all: true } }),
  ]);

  const key = (r) => `${r.provider}\u0000${r.model}\u0000${r.jobType}`;
  const failed = new Map(failures.map((r) => [key(r), r._count._all]));

  for (const r of totals) {
    const data = {
      calls: r._count._all,
      failures: failed.get(key(r)) || 0,
      inputTokens: r._sum.inputTokens || 0,
      outputTokens: r._sum.outputTokens || 0,
      estimatedCost: r._sum.estimatedCost || 0,
      totalLatencyMs: BigInt(r._sum.latencyMs || 0),
    };
    await prisma.aiUsageDaily.upsert({
      where: { day_provider_model_jobType: { day: dayStart, provider: r.provider, model: r.model, jobType: r.jobType } },
      create: { day: dayStart, provider: r.provider, model: r.model, jobType: r.jobType, ...data },
      update: data,
    });
  }
  return totals.length;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.days=2]  how many UTC days back to recompute, today included
 */
async function rollupAiUsage({ days = 2, now = new Date() } = {}) {
  let groups = 0;
  const today = utcDayStart(now);
  for (let i = 0; i < days; i += 1) {
    groups += await rollupDay(new Date(today.getTime() - i * DAY_MS));
  }
  const cutoff = new Date(now.getTime() - RAW_RETENTION_DAYS * DAY_MS);
  const { count: purged } = await prisma.aiCallLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { groups, purged };
}

module.exports = { rollupAiUsage, rollupDay, utcDayStart, RAW_RETENTION_DAYS };
