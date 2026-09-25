/**
 * Redis connections, in one place.
 *
 * Redis is OPTIONAL. With REDIS_URL unset every caller falls back to its
 * in-process behaviour (memory rate limits, memory queue, in-memory Socket.io
 * adapter) — that is the local-dev path and the production rollback path
 * (unlink the Redis addon and the app still runs, single-instance-correct).
 *
 * Two kinds of connection:
 *
 *   getRedis()               the shared command connection for rate limits,
 *                            throttles and email quota. Fails FAST when Redis
 *                            is down (no offline queue, one retry), so a Redis
 *                            outage degrades those features to per-instance
 *                            memory instead of hanging requests.
 *
 *   createRedisConnection()  a dedicated connection, for the things that must
 *                            own one: BullMQ (blocking commands) and the
 *                            Socket.io adapter's pub/sub pair.
 *
 * Every connection made here is closed by closeRedis() on shutdown.
 *
 * TLS: a rediss:// URL enables TLS automatically. REDIS_TLS_INSECURE=true skips
 * certificate verification, for a provider whose internal endpoint presents a
 * certificate the Node trust store does not know. The URL itself is never
 * logged — only whether one is configured.
 */

const IORedis = require('ioredis');

const connections = new Set();
let shared = null;

function redisUrl() {
  const url = (process.env.REDIS_URL || '').trim();
  return url || null;
}

function isRedisConfigured() {
  return redisUrl() !== null;
}

function baseOptions() {
  const opts = { connectTimeout: 5000 };
  if (redisUrl()?.startsWith('rediss://') && process.env.REDIS_TLS_INSECURE === 'true') {
    opts.tls = { rejectUnauthorized: false };
  }
  return opts;
}

/** A new, dedicated connection. Returns null when Redis is not configured. */
function createRedisConnection(label, extra = {}) {
  const url = redisUrl();
  if (!url) return null;
  const conn = new IORedis(url, { ...baseOptions(), ...extra });
  let lastLogged = 0;
  conn.on('error', (err) => {
    // A down Redis emits an error per reconnect attempt; one line a minute is enough.
    const now = Date.now();
    if (now - lastLogged > 60 * 1000) {
      lastLogged = now;
      console.error(`[Redis:${label}] connection error:`, err.message);
    }
  });
  connections.add(conn);
  conn.once('end', () => connections.delete(conn));
  return conn;
}

/** The shared fail-fast command connection, or null without REDIS_URL. */
function getRedis() {
  if (!isRedisConfigured()) return null;
  if (!shared) {
    shared = createRedisConnection('shared', {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
  }
  return shared;
}

/** True when the shared connection can take a command right now. */
function isRedisReady() {
  return Boolean(shared && shared.status === 'ready');
}

/** PING with a bound. Resolves the round-trip in ms; rejects on failure. */
async function pingRedis({ timeoutMs = 1000 } = {}) {
  const client = getRedis();
  if (!client) throw new Error('redis not configured');
  const started = process.hrtime.bigint();
  let timer;
  try {
    await Promise.race([
      client.ping(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('redis ping timed out')), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return Number(process.hrtime.bigint() - started) / 1e6;
}

/** Close every connection made here. Safe to call more than once. */
async function closeRedis() {
  const all = [...connections];
  connections.clear();
  shared = null;
  await Promise.all(
    all.map((conn) =>
      conn.quit().catch(() => {
        conn.disconnect();
      })
    )
  );
}

module.exports = {
  isRedisConfigured,
  getRedis,
  isRedisReady,
  pingRedis,
  createRedisConnection,
  closeRedis,
};
