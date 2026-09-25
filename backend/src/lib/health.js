/**
 * Everything GET /api/admin/health reports (Gate 3), gathered in one place.
 *
 * Counts, timings and statuses only — no DM content, no tokens, no secrets.
 * Each section is computed independently and a failing section reports
 * { error: true } instead of failing the whole page: the health page is most
 * needed exactly when something is broken.
 */

const { monitorEventLoopDelay } = require('perf_hooks');
const prisma = require('./prisma');
const { getIO } = require('./socket');
const { aiStatsSince } = require('./ai/callLog');
const { latestRunPerJob } = require('../jobs/jobRuns');
const { recentErrors } = require('./errorRing');

// Started once at load; resolution 20ms is plenty for a lag gauge.
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** SELECT 1, timed. Rejects on failure or after `timeoutMs`. */
async function dbPing({ timeoutMs = 2000 } = {}) {
  const started = process.hrtime.bigint();
  await Promise.race([
    prisma.$queryRaw`SELECT 1`,
    new Promise((_, reject) => setTimeout(() => reject(new Error('db ping timed out')), timeoutMs).unref()),
  ]);
  return Number(process.hrtime.bigint() - started) / 1e6;
}

async function section(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error('[Health] A health section failed:', err.message);
    return { error: true };
  }
}

function processStats() {
  const mem = process.memoryUsage();
  const toMb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;
  return {
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: { rss: toMb(mem.rss), heapUsed: toMb(mem.heapUsed), heapTotal: toMb(mem.heapTotal) },
    eventLoopLagMs: {
      mean: Math.round(loopDelay.mean / 1e4) / 100,
      p99: Math.round(loopDelay.percentile(99) / 1e4) / 100,
      max: Math.round(loopDelay.max / 1e4) / 100,
    },
  };
}

function socketStats() {
  const io = getIO();
  return { connectedClients: io ? io.of('/').sockets.size : 0 };
}

async function webhookStats(now) {
  const [latest, count24h] = await Promise.all([
    prisma.webhookDelivery.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
    prisma.webhookDelivery.count({ where: { receivedAt: { gte: new Date(now - DAY_MS) } } }),
  ]);
  return { lastReceivedAt: latest ? latest.receivedAt : null, received24h: count24h };
}

async function tokenStats(now) {
  const soon = new Date(now + 7 * DAY_MS);
  const weekAgo = new Date(now - 7 * DAY_MS);
  const [expiringSoon, needsReconnect, refreshFailures, lastRefresh] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { connectionStatus: 'CONNECTED', tokenExpiresAt: { lte: soon } },
      orderBy: { tokenExpiresAt: 'asc' },
      take: 50,
      select: { id: true, igUsername: true, tokenExpiresAt: true, tokenStatus: true },
    }),
    prisma.instagramAccount.count({ where: { connectionStatus: 'CONNECTED', tokenStatus: { not: 'VALID' } } }),
    // Auto-refresh failures in the last 7 days (Gate 3B). Safe codes only.
    prisma.instagramAccount.findMany({
      where: { tokenRefreshFailedAt: { gte: weekAgo } },
      orderBy: { tokenRefreshFailedAt: 'desc' },
      take: 50,
      select: { id: true, igUsername: true, tokenRefreshFailedAt: true, tokenRefreshError: true, tokenStatus: true },
    }),
    prisma.instagramAccount.findFirst({
      where: { tokenRefreshedAt: { not: null } },
      orderBy: { tokenRefreshedAt: 'desc' },
      select: { tokenRefreshedAt: true },
    }),
  ]);
  return {
    expiringWithin7Days: expiringSoon,
    needsReconnect,
    refreshFailures,
    lastSuccessfulRefreshAt: lastRefresh ? lastRefresh.tokenRefreshedAt : null,
  };
}

/**
 * @param {object} deps  injected so tests can stub what is not in the DB
 * @param {() => object} deps.aiConfig       active provider/model (aiService)
 * @param {() => object} deps.emailFailures  lib/email sendFailureStats
 */
async function collectHealth({ aiConfig, emailFailures }) {
  const now = Date.now();
  const [db, jobs, webhooks, ai1h, ai24h, tokens] = await Promise.all([
    section(async () => ({ ok: true, pingMs: Math.round((await dbPing()) * 10) / 10 })),
    section(latestRunPerJob),
    section(() => webhookStats(now)),
    section(() => aiStatsSince(new Date(now - HOUR_MS))),
    section(() => aiStatsSince(new Date(now - DAY_MS))),
    section(() => tokenStats(now)),
  ]);

  return {
    generatedAt: new Date(now).toISOString(),
    process: processStats(),
    database: db.error ? { ok: false } : db,
    sockets: socketStats(),
    jobs,
    webhooks,
    ai: { lastHour: ai1h, last24Hours: ai24h, active: aiConfig(), costsAreEstimates: true },
    email: emailFailures(),
    instagramTokens: tokens,
    recentErrors: recentErrors(),
  };
}

/**
 * GET /health — for an external uptime monitor. Says ok or error and nothing
 * else: no version, no timestamp, no dependency detail. The database is
 * pinged (bounded), so "ok" means the service can actually serve.
 */
async function publicHealthHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await dbPing();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
}

module.exports = { collectHealth, dbPing, publicHealthHandler };
