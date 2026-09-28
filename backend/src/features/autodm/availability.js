/**
 * GET /api/public/autodm-availability — unauthenticated, for the landing page
 * and pricing ("Coming soon" badges): { available } is true only when the
 * kill switch is on AND the admin rollout mode is EVERYONE, so the badges go
 * away by themselves when the admin opens Auto DM to everyone — no redeploy.
 *
 * No user data, no cookies needed. Cached 60 s here and in the browser/CDN,
 * rate-limited per IP. Kill switch off = false without a database query.
 */

const express = require('express');
const { createRateLimiter } = require('../../lib/rateLimit');
const config = require('./config');
const { getRolloutMode } = require('./access');

const router = express.Router();
const TTL_MS = 60 * 1000;
let cache = { value: false, at: 0 };

const limiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, message: 'Too many requests.' });

async function isAvailable(now = Date.now()) {
  if (!config.isEnabled()) return false;
  if (now - cache.at < TTL_MS) return cache.value;
  let value = false;
  try {
    value = (await getRolloutMode()) === 'EVERYONE';
  } catch {
    value = false;
  }
  cache = { value, at: now };
  return value;
}

router.get('/autodm-availability', limiter, async (req, res) => {
  const available = await isAvailable();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ available });
});

/** Tests only. */
function resetAvailabilityCache() {
  cache = { value: false, at: 0 };
}

module.exports = router;
module.exports.isAvailable = isAvailable;
module.exports.resetAvailabilityCache = resetAvailabilityCache;
