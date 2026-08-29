/**
 * Minimal in-memory fixed-window rate limiter (no external dependency).
 *
 * Suitable for single-instance deployments and local dev. For multi-instance
 * production, back this with Redis instead — the middleware interface is the
 * same. Keyed by client IP + route so brute-forcing one endpoint does not
 * consume another endpoint's budget.
 */

function createRateLimiter({ windowMs, max, message } = {}) {
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
    const key = `${ip}:${req.baseUrl || ''}${req.path || ''}`;

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

module.exports = { createRateLimiter };
