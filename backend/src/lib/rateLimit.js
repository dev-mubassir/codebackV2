/**
 * Minimal in-memory fixed-window rate limiter (no external dependency).
 *
 * Suitable for single-instance deployments and local dev. For multi-instance
 * production, back this with Redis instead — the middleware interface is the
 * same. Keyed by client IP + route so brute-forcing one endpoint does not
 * consume another endpoint's budget.
 */

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

  // Periodically evict expired buckets so the map does not grow unbounded.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, limitWindow);
  if (typeof timer.unref === 'function') timer.unref();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    // `keyBy` lets a limiter bucket on something other than the IP — e.g. the
    // target email, so that distributed credential stuffing against ONE
    // account is throttled even though every request comes from a new address.
    const subject = typeof keyBy === 'function' ? keyBy(req) || ip : ip;
    const key = `${subject}:${normalisePath(req)}`;

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + limitWindow };
      hits.set(key, entry);
    }
    entry.count += 1;

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

module.exports = { createRateLimiter, normalisePath };
