/**
 * /api/autodm — the customer API for Auto DM.
 *
 *   GET /status   always answers (the sidebar reads it; no NEXT_PUBLIC_ flag)
 *   everything else: 404 AUTODM_DISABLED unless AUTODM_ENABLED is on AND the
 *   caller is on the scope allowlist (or AUTODM_SCOPE_ALL).
 *
 * Tenant isolation: requireAuth + requireWorkspace resolve the caller's owned
 * Instagram account ids once; every query below filters by req.userId, and a
 * foreign id is a plain 404 (never 403, which would confirm it exists).
 */

const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireWorkspace } = require('../../middleware/authorize');
const { createRateLimiter } = require('../../lib/rateLimit');
const config = require('./config');

const router = express.Router();

// Per user (per IP when logged out). Generous for a UI that polls a run log,
// tight enough that a script cannot hammer the Graph proxy (media list).
const autodmLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many Auto DM requests. Wait a minute and try again.',
  keyBy: (req) => (req.session && req.session.userId ? `u:${req.session.userId}` : null),
});

router.use(autodmLimiter);
router.use(requireAuth);

// GET /api/autodm/status
router.get('/status', (req, res) => {
  const enabled = config.isEnabled();
  res.json({
    enabled,
    // `available` drives the sidebar item: on only for users who may use it.
    available: enabled && config.isScopeAllowed(req.user && req.user.email),
  });
});

// Everything below: feature on, and this user allowed.
function requireAutoDm(req, res, next) {
  if (!config.isEnabled() || !config.isScopeAllowed(req.user && req.user.email)) {
    return res.status(404).json({ error: 'Auto DM is not available.', code: 'AUTODM_DISABLED' });
  }
  return next();
}

router.use(requireAutoDm);
router.use(requireWorkspace);

module.exports = router;
module.exports.requireAutoDm = requireAutoDm;
