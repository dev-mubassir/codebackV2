/**
 * Maintenance mode (Gate 7 kill switch `maintenance_mode`).
 *
 * While on, the CUSTOMER surfaces answer 503 { code: 'MAINTENANCE' }:
 * everything under /api (except the admin API, the contact form and the
 * announcements feed) and /auth (except logout). The app shows a
 * "back soon" page on that code.
 *
 * Untouched, by design: Meta webhooks and the data-deletion callbacks (so no
 * DM is lost and Meta's contract holds), the Cashfree webhook, /health, the
 * admin panel, and every background job. Maintenance pauses people, not the
 * pipeline.
 */

const { getSetting } = require('./settings');

const EXEMPT = [/^\/api\/admin(\/|$)/i, /^\/api\/contact(\/|$)/i, /^\/api\/announcements(\/|$)/i, /^\/auth\/logout\/?$/i];
const GUARDED = [/^\/api(\/|$)/i, /^\/auth(\/|$)/i];

function isGuardedPath(path) {
  return GUARDED.some((re) => re.test(path)) && !EXEMPT.some((re) => re.test(path));
}

async function maintenanceGuard(req, res, next) {
  if (!isGuardedPath(req.path)) return next();
  try {
    if (!(await getSetting('maintenance_mode'))) return next();
  } catch {
    return next(); // settings unreadable: fail open, the default is "not in maintenance"
  }
  res.setHeader('Retry-After', '600');
  return res.status(503).json({ error: 'Siffty is being updated. Please try again in a few minutes.', code: 'MAINTENANCE' });
}

module.exports = { maintenanceGuard, isGuardedPath };
