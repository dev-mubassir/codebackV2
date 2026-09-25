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
const { isRedisConfigured, pingRedis, redisDownForMs } = require('./redis');
const { socketAdapterMode } = require('./socketAdapter');
const { queueDriver } = require('./queue');
const { rateLimitStore } = require('./rateLimit');

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

/**
 * Redis and everything that switches on it. `configured` without `connected`
 * means REDIS_URL is set but Redis is not answering — rate limits and quota
 * have fallen back to per-instance memory, and the queue/adapter are stalled.
 */
async function redisStats() {
  const configured = isRedisConfigured();
  let connected = false;
  let pingMs = null;
  if (configured) {
    try {
      pingMs = Math.round((await pingRedis({ timeoutMs: 1000 })) * 10) / 10;
      connected = true;
    } catch {
      connected = false;
    }
  }
  // Lazily required: jobs/scheduler -> jobs/jobRuns, which this file loads too.
  const { schedulerEnabled } = require('../jobs/scheduler');
  return {
    configured,
    connected,
    // 'healthy' | 'degraded' (configured but not answering: the app keeps
    // serving — rate limits/quota in memory, webhooks processed in-process)
    // | 'not_configured'.
    status: !configured ? 'not_configured' : connected ? 'healthy' : 'degraded',
    downForSeconds: connected ? 0 : Math.round(redisDownForMs() / 1000),
    pingMs,
    socketAdapter: socketAdapterMode(),
    sessionStore: 'postgres',
    queueDriver: queueDriver(),
    rateLimitStore: rateLimitStore(),
    scheduler: { inProcess: schedulerEnabled() },
  };
}

/** Postgres's connection ceiling and current use — the pool budget's reality check. */
async function dbConnectionStats() {
  const rows = await prisma.$queryRaw`
    SELECT current_setting('max_connections')::int AS "max",
           (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS "active"`;
  return { maxConnections: rows[0].max, activeConnections: rows[0].active };
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
  const [db, jobs, webhooks, ai1h, ai24h, tokens, redis, dbConns, inbox] = await Promise.all([
    section(async () => ({ ok: true, pingMs: Math.round((await dbPing()) * 10) / 10 })),
    section(latestRunPerJob),
    section(() => webhookStats(now)),
    section(() => aiStatsSince(new Date(now - HOUR_MS))),
    section(() => aiStatsSince(new Date(now - DAY_MS))),
    section(() => tokenStats(now)),
    section(redisStats),
    section(dbConnectionStats),
    section(() => require('../services/webhookDeliveries').backlogStats({ now })),
  ]);

  return {
    generatedAt: new Date(now).toISOString(),
    process: processStats(),
    database: db.error ? { ok: false } : { ...db, ...(dbConns.error ? {} : dbConns) },
    redis,
    sockets: socketStats(),
    jobs,
    webhooks: webhooks.error ? webhooks : { ...webhooks, inbox },
    ai: { lastHour: ai1h, last24Hours: ai24h, active: await section(aiConfig), costsAreEstimates: true },
    email: emailFailures(),
    instagramTokens: tokens,
    recentErrors: recentErrors(),
  };
}

let shuttingDown = false;

/** Called on SIGTERM: /health answers 503 so the load balancer drains us. */
function markShuttingDown() {
  shuttingDown = true;
}

function isShuttingDown() {
  return shuttingDown;
}

/**
 * GET /health — readiness, and the external uptime monitor's check. Says ok or
 * error and nothing else: no version, no timestamp, no dependency detail.
 *
 * DATABASE ONLY. Redis is deliberately not checked: with Redis down every
 * instance still serves (rate limits and quota fall back to memory, webhooks
 * are saved to Postgres and processed in-process), so failing readiness on it
 * would take the whole API out of rotation for an outage it survives. Redis
 * shows as "degraded" on the admin health page and raises an admin alert.
 *
 * While shutting down it answers 503, which takes the instance out of
 * rotation before it stops.
 */
async function publicHealthHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (shuttingDown) return res.status(503).json({ status: 'error' });
  try {
    await dbPing();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
}

/**
 * GET /livez — liveness. Touches no dependency: "the process is up and the
 * event loop answers". A database or Redis outage must NOT fail this, or the
 * platform would restart every instance at once for a problem restarts cannot
 * fix.
 */
function livezHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
}

module.exports = { collectHealth, dbPing, publicHealthHandler, livezHandler, markShuttingDown, isShuttingDown, redisStats };
