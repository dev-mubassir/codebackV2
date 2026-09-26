/**
 * Process-level error handling — nothing hidden, nothing left half-alive.
 *
 *   unhandledRejection  logged and COUNTED. A stray rejection from a
 *                       background library (Redis client, queue, adapter)
 *                       must not kill an instance that is serving fine, but
 *                       it must not be invisible either: the count is shown
 *                       on the admin health page, and more than
 *                       UNHANDLED_ALERT_THRESHOLD across all instances in 10
 *                       minutes raises an admin alert (jobs/alertJob.js).
 *
 *   uncaughtException   logged, then a GRACEFUL SHUTDOWN with exit code 1, so
 *                       the platform replaces the instance with a clean one.
 *                       After an uncaught exception the process state is
 *                       undefined; it is never kept running.
 *
 * Counts are shared through Redis (a sorted set of timestamps) when it is
 * configured, so the alert sees every instance; otherwise per instance.
 */

const crypto = require('crypto');
const { getRedis, isRedisReady } = require('./redis');

const WINDOW_MS = 10 * 60 * 1000;
const UNHANDLED_ALERT_THRESHOLD = 5;
const KEY = 'process:unhandled_rejections';

const local = []; // timestamps, this instance
let totalSinceBoot = 0;

function describe(reason) {
  if (reason && reason.message) return String(reason.message).split('\n')[0].slice(0, 300);
  return String(reason).split('\n')[0].slice(0, 300);
}

function recordUnhandled(now = Date.now()) {
  totalSinceBoot += 1;
  local.push(now);
  while (local.length && local[0] < now - WINDOW_MS) local.shift();
  const client = getRedis();
  if (client && isRedisReady()) {
    client
      .multi()
      .zadd(KEY, now, `${now}-${crypto.randomBytes(4).toString('hex')}`)
      .zremrangebyscore(KEY, 0, now - WINDOW_MS)
      .pexpire(KEY, WINDOW_MS * 2)
      .exec()
      .catch(() => {});
  }
}

/** Unhandled rejections in the last 10 minutes — all instances when Redis is up. */
async function unhandledLast10m(now = Date.now()) {
  const client = getRedis();
  if (client && isRedisReady()) {
    try {
      return await client.zcount(KEY, now - WINDOW_MS, '+inf');
    } catch {
      /* fall through to this instance's count */
    }
  }
  return local.filter((t) => t >= now - WINDOW_MS).length;
}

function stats() {
  const now = Date.now();
  return { thisInstanceLast10m: local.filter((t) => t >= now - WINDOW_MS).length, thisInstanceSinceBoot: totalSinceBoot };
}

/**
 * @param {object} opts
 * @param {(reason: string, exitCode: number) => Promise<void>} opts.shutdown  graceful shutdown
 */
function installProcessGuards({ shutdown }) {
  process.on('unhandledRejection', (reason) => {
    recordUnhandled();
    console.error(`[Server] Unhandled promise rejection (#${totalSinceBoot} since boot; counted and alerted on):`, describe(reason));
  });
  process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught exception — shutting down so a clean instance replaces this one:', describe(err));
    if (err && err.stack) console.error(err.stack.split('\n').slice(0, 8).join('\n'));
    Promise.resolve(shutdown('uncaughtException', 1)).catch(() => process.exit(1));
  });
}

module.exports = { installProcessGuards, unhandledLast10m, stats, recordUnhandled, UNHANDLED_ALERT_THRESHOLD };
