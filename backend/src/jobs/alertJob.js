/**
 * Admin alert checks (Gate 7) — every 5 minutes, recorded as `admin_alerts`.
 *
 * Each check compares live numbers against an admin-editable threshold
 * (lib/settings.js, group 'alert'). A triggered check emails the admins
 * through the admin email bucket (routine tier — it can never spend the sends
 * held back for lockout alerts) at most ONCE PER HOUR PER TYPE. The cooldown
 * is read from the audit log (ALERT_SENT rows), so it survives a restart.
 *
 *   ai_error_rate      AI error rate over the last 15 min > threshold (≥10 calls)
 *   ai_daily_cost      estimated AI cost today (UTC) > threshold
 *   user_usage_spike   one customer's AI calls in 24h > X × their 7-day daily average (≥50 calls)
 *   no_webhooks        no Meta delivery for N hours while accounts are connected
 *   db_ping            database ping > threshold
 *   job_failure        any scheduled job failed in the last 10 min
 *   ai_fallback        the AI fallback switched on — the router already emails
 *                      at the moment it happens and writes AI_FALLBACK_ACTIVATED,
 *                      which counts as "sent" here, so it is never sent twice.
 *
 * Facts are counts, ids and codes only — no message content, no secrets.
 */

const prisma = require('../lib/prisma');
const { getSetting } = require('../lib/settings');
const { dbPing } = require('../lib/health');
const { sendAdminOpsAlert } = require('../lib/adminAlerts');
const { sanitize } = require('../lib/errorRing');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const COOLDOWN_MS = HOUR;

async function checkAiErrorRate(now) {
  const threshold = await getSetting('alert_ai_error_rate_pct');
  const where = { createdAt: { gte: new Date(now - 15 * MIN) }, jobType: { not: 'admin_test' } };
  const [calls, failures] = await Promise.all([
    prisma.aiCallLog.count({ where }),
    prisma.aiCallLog.count({ where: { ...where, success: false } }),
  ]);
  if (calls < 10) return null;
  const rate = (failures / calls) * 100;
  if (rate <= threshold) return null;
  return {
    type: 'ai_error_rate',
    title: `AI error rate ${rate.toFixed(0)}% in the last 15 minutes`,
    lead: `AI calls are failing above your ${threshold}% threshold.`,
    facts: [`calls: ${calls}`, `failures: ${failures}`],
  };
}

async function checkAiDailyCost(now) {
  const threshold = await getSetting('alert_ai_daily_cost_usd');
  const d = new Date(now);
  const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const agg = await prisma.aiCallLog.aggregate({ where: { createdAt: { gte: dayStart } }, _sum: { estimatedCost: true } });
  const cost = agg._sum.estimatedCost || 0;
  if (cost <= threshold) return null;
  return {
    type: 'ai_daily_cost',
    title: `AI cost today is about $${cost.toFixed(2)}`,
    lead: `Estimated AI spend today (UTC) is above your $${threshold} limit.`,
    facts: [`estimated cost: $${cost.toFixed(4)}`],
  };
}

async function checkUserUsageSpike(now) {
  const multiplier = await getSetting('alert_user_usage_multiplier');
  const recent = await prisma.aiCallLog.groupBy({
    by: ['tenantId'],
    where: { createdAt: { gte: new Date(now - DAY) }, tenantId: { not: null } },
    _count: { _all: true },
    having: { tenantId: { _count: { gte: 50 } } },
  });
  const spikes = [];
  for (const r of recent) {
    const prior = await prisma.aiCallLog.count({
      where: { tenantId: r.tenantId, createdAt: { gte: new Date(now - 8 * DAY), lt: new Date(now - DAY) } },
    });
    const avg = prior / 7;
    if (avg > 0 && r._count._all > multiplier * avg) spikes.push({ tenantId: r.tenantId, today: r._count._all, avg });
  }
  if (!spikes.length) return null;
  return {
    type: 'user_usage_spike',
    title: `${spikes.length} customer(s) using AI far above their normal`,
    lead: `AI calls in the last 24 hours are above ${multiplier}× the customer's 7-day daily average.`,
    facts: spikes.slice(0, 5).map((s) => `customer ${s.tenantId}: ${s.today} calls vs ~${s.avg.toFixed(1)}/day`),
  };
}

async function checkNoWebhooks(now) {
  const hours = await getSetting('alert_no_webhook_hours');
  const connected = await prisma.instagramAccount.count({ where: { connectionStatus: 'CONNECTED' } });
  if (connected === 0) return null;
  const latest = await prisma.webhookDelivery.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } });
  if (latest && now - latest.receivedAt.getTime() <= hours * HOUR) return null;
  return {
    type: 'no_webhooks',
    title: `No Meta deliveries for over ${hours} hour(s)`,
    lead: 'Instagram accounts are connected, but no webhook delivery has arrived. Check the Meta app subscription and the webhook URL.',
    facts: [`connected accounts: ${connected}`, `last delivery: ${latest ? latest.receivedAt.toISOString() : 'never (within the 7-day window)'}`],
  };
}

async function checkDbPing() {
  const threshold = await getSetting('alert_db_ping_ms');
  let ms;
  try {
    ms = await dbPing({ timeoutMs: Math.max(threshold * 4, 2000) });
  } catch {
    return { type: 'db_ping', title: 'Database did not answer', lead: 'The database ping failed or timed out.', facts: [] };
  }
  if (ms <= threshold) return null;
  return { type: 'db_ping', title: `Database ping ${Math.round(ms)} ms`, lead: `Above your ${threshold} ms threshold.`, facts: [`ping: ${Math.round(ms)} ms`] };
}

async function checkJobFailures(now) {
  const failed = await prisma.jobRun.findMany({
    where: { success: false, startedAt: { gte: new Date(now - 10 * MIN) }, jobName: { not: 'admin_alerts' } },
    select: { jobName: true, error: true, startedAt: true },
    take: 10,
  });
  if (!failed.length) return null;
  return {
    type: 'job_failure',
    title: `${failed.length} scheduled job run(s) failed`,
    lead: 'One or more background jobs failed in the last 10 minutes.',
    // Error text is masked (URLs, keys, tokens, emails) before it leaves by email.
    facts: failed.map((f) => `${f.jobName} at ${f.startedAt.toISOString()}: ${sanitize(f.error || 'error')}`),
  };
}

async function checkAiFallback(now) {
  const row = await prisma.adminAuditLog.findFirst({
    where: { action: 'AI_FALLBACK_ACTIVATED', createdAt: { gte: new Date(now - 10 * MIN) } },
    select: { after: true },
  });
  if (!row) return null;
  return { type: 'ai_fallback', title: 'AI fallback activated', lead: 'Traffic moved to the fallback AI model.', facts: [] };
}

/** DMs Meta was told we received that are still not in the inbox. */
async function checkWebhookBacklog(now) {
  const { olderThan10Min, unprocessed, oldestReceivedAt } = await require('../services/webhookDeliveries').backlogStats({ now });
  if (!olderThan10Min) return null;
  return {
    type: 'webhook_backlog',
    title: `${olderThan10Min} webhook deliveries unprocessed for over 10 minutes`,
    lead: 'Stored Instagram deliveries are not reaching the inbox. The recovery sweep retries them every 2 minutes; check the logs for the last error.',
    facts: [`unprocessed: ${unprocessed}`, `oldest: ${oldestReceivedAt ? oldestReceivedAt.toISOString() : 'n/a'}`],
  };
}

/** Redis configured but unusable for over 2 minutes. */
async function checkRedisDown(now) {
  const downMs = require('../lib/redis').redisDownForMs(now);
  if (downMs < 2 * MIN) return null;
  return {
    type: 'redis_down',
    title: `Redis unavailable for ${Math.round(downMs / MIN)} minute(s)`,
    lead: 'The API keeps serving: rate limits and email quota are per-instance, webhooks are saved and processed in-process, live socket events only reach users on the same instance.',
    facts: [`down for: ${Math.round(downMs / 1000)}s`],
  };
}

/** More than the threshold of unhandled promise rejections in 10 minutes, all instances. */
async function checkUnhandledRejections(now) {
  const guards = require('../lib/processGuards');
  const count = await guards.unhandledLast10m(now);
  if (count <= guards.UNHANDLED_ALERT_THRESHOLD) return null;
  return {
    type: 'unhandled_rejections',
    title: `${count} unhandled promise rejections in the last 10 minutes`,
    lead: 'A background library is failing without a handler. Instances keep serving, but the cause needs fixing — search the logs for "Unhandled promise rejection".',
    facts: [`last 10 min: ${count}`, `threshold: ${guards.UNHANDLED_ALERT_THRESHOLD}`],
  };
}

const CHECKS = [checkUnhandledRejections, checkAiErrorRate, checkAiDailyCost, checkUserUsageSpike, checkNoWebhooks, checkDbPing, checkJobFailures, checkAiFallback, checkWebhookBacklog, checkRedisDown];

async function recentlySent(type, now, db = prisma) {
  const since = new Date(now - COOLDOWN_MS);
  const where =
    type === 'ai_fallback'
      ? { OR: [{ action: 'ALERT_SENT', targetId: type }, { action: 'AI_FALLBACK_ACTIVATED' }], createdAt: { gte: since } }
      : { action: 'ALERT_SENT', targetId: type, createdAt: { gte: since } };
  return (await db.adminAuditLog.count({ where })) > 0;
}

const ALERT_LOCK_NAMESPACE = 726355; // the scheduler uses 726354

/**
 * Claim the right to send `alert`: check the cooldown and write the ALERT_SENT
 * row as ONE step, under a per-type transaction lock. Checking and writing
 * separately let two concurrent runs both see "not sent yet" and both mail
 * the admins. Resolves true if this caller should send.
 */
async function claimAlert(alert, now) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ALERT_LOCK_NAMESPACE}::int, hashtext(${`alert:${alert.type}`}))`;
    if (await recentlySent(alert.type, now, tx)) return false;
    await tx.adminAuditLog.create({
      data: { action: 'ALERT_SENT', targetType: 'SYSTEM', targetId: alert.type, after: { title: alert.title, facts: alert.facts } },
    });
    return true;
  });
}

/**
 * Run every check; send what triggered and is not cooling down.
 * @returns {Promise<{triggered: number, sent: number, suppressed: number}>}
 */
async function runAlertChecks({ now = Date.now() } = {}) {
  let triggered = 0;
  let sent = 0;
  let suppressed = 0;
  for (const check of CHECKS) {
    let alert = null;
    try {
      alert = await check(now);
    } catch (err) {
      console.error(`[Alerts] ${check.name} failed:`, err.message);
      continue;
    }
    if (!alert) continue;
    triggered += 1;
    if (!(await claimAlert(alert, now))) {
      suppressed += 1;
      continue;
    }
    if ((await sendAdminOpsAlert(alert)) > 0) sent += 1;
  }
  return { triggered, sent, suppressed };
}

module.exports = { runAlertChecks, CHECKS, COOLDOWN_MS };
