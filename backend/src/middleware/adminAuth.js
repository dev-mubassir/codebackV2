/**
 * Admin authorization — every /api/admin route except /login sits behind
 * requireAdmin.
 *
 * The admin identity is an AdminUser (never a User), carried only on the admin
 * session (lib/adminSession.js). There is no other way in: no User.role, no
 * ADMIN_EMAILS, no environment credential, no Google sign-in.
 *
 * NOT-AN-ADMIN IS 404, not 401/403. A logged-in customer, a logged-out
 * visitor and a scanner all get the same answer every unknown URL gets, so the
 * API does not confirm that an admin surface exists. The ONE exception is a
 * request carrying a genuine admin session that has just expired: that caller
 * already holds an admin cookie, so telling them "expired" reveals nothing,
 * and the UI needs it to say why they were signed out.
 */

const prisma = require('../lib/prisma');
const { isAllowedOrigin } = require('../lib/security');
const { notFoundHandler } = require('./errorHandlers');
const {
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_PATH,
  ADMIN_IDLE_MS,
  ADMIN_ABSOLUTE_MS,
  ADMIN_STEP_UP_MS,
} = require('../lib/adminSession');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function endSession(req, res, status, body) {
  const done = () => {
    res.clearCookie(ADMIN_COOKIE_NAME, { path: ADMIN_COOKIE_PATH });
    res.status(status).json(body);
  };
  if (req.session && typeof req.session.destroy === 'function') {
    req.session.destroy(() => done());
  } else {
    done();
  }
}

const EXPIRED = { error: 'Your admin session ended. Sign in again.', code: 'ADMIN_SESSION_EXPIRED' };

async function requireAdmin(req, res, next) {
  const sess = req.session;
  if (!sess || !sess.adminId) return notFoundHandler(req, res);

  const now = Date.now();
  if (
    typeof sess.authenticatedAt !== 'number' ||
    typeof sess.lastActivityAt !== 'number' ||
    now - sess.authenticatedAt > ADMIN_ABSOLUTE_MS ||
    now - sess.lastActivityAt > ADMIN_IDLE_MS
  ) {
    return endSession(req, res, 401, EXPIRED);
  }

  let admin;
  try {
    admin = await prisma.adminUser.findUnique({
      where: { id: sess.adminId },
      // No passwordHash here: req.admin is visible to every handler, and the
      // two that need the hash (step-up, password change) load it themselves.
      select: { id: true, email: true, passwordChangedAt: true, lockedUntil: true },
    });
  } catch (err) {
    console.error('[AdminAuth] Could not load admin:', err.message);
    return res.status(500).json({ error: "Couldn't confirm your access. Try again." });
  }

  // Removed admin, a password change elsewhere, or a lockout since login.
  if (
    !admin ||
    admin.passwordChangedAt.getTime() !== sess.pwdAt ||
    (admin.lockedUntil && admin.lockedUntil.getTime() > now)
  ) {
    return endSession(req, res, 401, EXPIRED);
  }

  req.admin = admin;
  res.setHeader('Cache-Control', 'no-store');
  return next();
}

/**
 * Stricter than the customer originGuard: an admin mutation must carry an
 * Origin header, and it must be on the allowlist. The customer guard lets a
 * missing Origin through for server-to-server callers; nothing legitimate
 * calls the admin API without a browser.
 */
function adminOriginGuard(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin || !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  return next();
}

/** A mutating request is activity; a GET is not. See lib/adminSession.js. */
function trackAdminActivity(req, res, next) {
  if (MUTATING.has(req.method) && req.session) req.session.lastActivityAt = Date.now();
  next();
}

/**
 * Destructive actions need the admin password re-entered within the last
 * five minutes (POST /api/admin/step-up). A hijacked session alone — a cookie
 * lifted from an unlocked laptop — can browse but not destroy.
 */
function requireStepUp(req, res, next) {
  const at = req.session && req.session.stepUpAt;
  if (typeof at === 'number' && Date.now() - at <= ADMIN_STEP_UP_MS) return next();
  return res.status(403).json({
    error: 'Confirm your password to continue.',
    code: 'STEP_UP_REQUIRED',
  });
}

module.exports = { requireAdmin, requireStepUp, adminOriginGuard, trackAdminActivity };
