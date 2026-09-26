/**
 * Fixed-window rate limiter, shared across instances through Redis.
 *
 * With REDIS_URL configured the counters live in Redis, so N instances enforce
 * ONE limit rather than N of them. Without it — or while Redis is unreachable —
 * the same window runs in this process's memory, which is exactly right for a
 * single instance and local dev, and a safe degradation for a Redis outage
 * (the limit loosens to per-instance; requests never hang or fail on it).
 *
 * Keyed by client IP + route so brute-forcing one endpoint does not consume
 * another endpoint's budget. Redis keys hash the subject, so an email-keyed
 * limiter never stores the address itself.
 */

const crypto = require('crypto');
const { getRedis, isRedisReady } = require('./redis');

// INCR, start the window on the first hit, return [count, ms left]. One round
// trip and atomic, so two instances can never both see "first hit".
const FIXED_WINDOW_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
return {c, t}
`;

/**
 * Count one hit against `key` in Redis. Resolves { count, resetAt }, or null
 * when Redis is not usable right now (the caller then counts in memory).
 */
async function redisHit(key, windowMs) {
  const client = getRedis();
  if (!client || !isRedisReady()) return null;
  try {
    const [count, ttl] = await client.eval(FIXED_WINDOW_LUA, 1, key, windowMs);
    return { count: Number(count), resetAt: Date.now() + Math.max(0, Number(ttl)) };
  } catch (err) {
    console.warn('[RateLimit] Redis unavailable, counting in memory:', err.message);
    return null;
  }
}

const hashKey = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);

/** Which store the limiters are using right now — for the admin health page. */
function rateLimitStore() {
  return getRedis() && isRedisReady() ? 'redis' : 'memory';
}

/**
 * Normalise a request path into a stable bucket key.
 *
 * THE BUG THIS FIXES. The key used to be `${ip}:${req.baseUrl}${req.path}`
 * verbatim. Express routers are created with default options, so caseSensitive
 * and strict are both false — /auth/login, /auth/LOGIN and /auth/login/ all
 * reach the same handler, but req.path returns whatever the client sent. That
 * produced a SEPARATE COUNTER PER SPELLING: an attacker got the full limit
 * again for every casing or trailing-slash variant, which is unlimited login
 * attempts against one account for the cost of a trivial mutation.
 *
 * The same trick inserted an unbounded number of distinct keys into the map,
 * which only expire after windowMs (an hour for registration) — a memory
 * growth vector on top of the bypass.
 *
 * Lowercasing and stripping the trailing slash collapses every variant onto
 * one bucket, which is what the limiter always intended.
 */
function normalisePath(req) {
  const raw = `${req.baseUrl || ''}${req.path || ''}`;
  return raw.toLowerCase().replace(/\/+$/, '') || '/';
}

function createRateLimiter({ windowMs, max, message, keyBy } = {}) {
  const limitWindow = windowMs || 15 * 60 * 1000;
  const limitMax = max || 20;
  const hits = new Map(); // key -> { count, resetAt }
  // Stable across instances (same code, same options), distinct between two
  // limiters stacked on one route, so their Redis counters never merge.
  const limiterId = hashKey(`${limitWindow}|${limitMax}|${message || ''}|${keyBy ? 'custom' : 'ip'}`).slice(0, 8);

  // Periodically evict expired buckets so the map does not grow unbounded.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, limitWindow);
  if (typeof timer.unref === 'function') timer.unref();

  function memoryHit(key, now) {
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + limitWindow };
      hits.set(key, entry);
    }
    entry.count += 1;
    return entry;
  }

  return async function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    // `keyBy` lets a limiter bucket on something other than the IP — e.g. the
    // target email, so that distributed credential stuffing against ONE
    // account is throttled even though every request comes from a new address.
    const subject = typeof keyBy === 'function' ? keyBy(req) || ip : ip;
    const key = `${subject}:${normalisePath(req)}`;

    const entry =
      (await redisHit(`rl:${limiterId}:${hashKey(key)}`, limitWindow)) || memoryHit(key, now);

    res.setHeader('X-RateLimit-Limit', limitMax);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limitMax - entry.count));

    if (entry.count > limitMax) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: message || 'Too many requests. Please try again later.',
      });
    }

    return next();
  };
}

module.exports = { createRateLimiter, normalisePath, redisHit, rateLimitStore };
