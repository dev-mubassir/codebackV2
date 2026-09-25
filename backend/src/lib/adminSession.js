/**
 * The admin session — a separate cookie, a separate store, separate rules.
 *
 * WHY SEPARATE. The old panel put admin state on the CUSTOMER cookie
 * (codeback.sid): 7 days, SameSite=Lax, no idle timeout, and an admin login
 * deliberately carried a customer login across. One stolen customer cookie
 * could be the admin cookie. Now:
 *
 *   cookie     siffty.admin.sid, HttpOnly, Secure (production), SameSite=Strict,
 *              Path=/api/admin — the browser never sends it anywhere else,
 *              and the customer cookie is never loaded on /api/admin.
 *   store      admin_sessions, a table of its own (see schema.prisma).
 *   idle       30 minutes since the last ACTIVITY (see below).
 *   absolute   8 hours since login, however active.
 *
 * ACTIVITY IS FAIL-CLOSED. Only a mutating request or an explicit
 * POST /api/admin/activity heartbeat (sent by the admin UI on real clicks and
 * keystrokes) advances lastActivityAt. A GET never does — so a dashboard that
 * auto-refreshes cannot keep an unattended session alive, and a background
 * request someone forgets to mark can only make the session end SOONER.
 *
 * Both limits are enforced server-side in requireAdmin from values stored in
 * the session, not from cookie expiry, which the client controls.
 */

const crypto = require('crypto');
const session = require('express-session');
const prisma = require('./prisma');

const ADMIN_COOKIE_NAME = 'siffty.admin.sid';
const ADMIN_COOKIE_PATH = '/api/admin';

const ADMIN_IDLE_MS = 30 * 60 * 1000;
const ADMIN_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const ADMIN_STEP_UP_MS = 5 * 60 * 1000;

const ADMIN_LOCK_AFTER_FAILURES = 5;
const ADMIN_LOCK_MS = 15 * 60 * 1000;

const ADMIN_MIN_PASSWORD_LENGTH = 16;
// Argon2 happily hashes megabytes; a cap keeps one request from burning CPU.
const ADMIN_MAX_PASSWORD_LENGTH = 1024;

/**
 * The admin cookie's signing key, DERIVED from SESSION_SECRET rather than a
 * new environment variable.
 *
 * HMAC with a fixed label yields a key that is independent of the customer
 * key for all practical purposes (knowing one does not give the other), while
 * adding nothing to configure. The only coupling is that rotating
 * SESSION_SECRET also signs admins out — harmless, unlike the token-key
 * coupling that lib/crypto.js removed.
 */
function adminSessionSecret(base = process.env.SESSION_SECRET) {
  return crypto.createHmac('sha256', String(base || '')).update('siffty-admin-session-v1').digest('hex');
}

/**
 * Is this request addressed to the admin API?
 *
 * Case-insensitive and boundary-aware, because Express routing is both: a
 * request for /API/Admin/users reaches the admin router, so it must also be
 * recognised here, while /api/administrator must not be.
 */
function isAdminPath(req) {
  const path = String(req.path || req.url || '').toLowerCase();
  return path === ADMIN_COOKIE_PATH || path.startsWith(`${ADMIN_COOKIE_PATH}/`);
}

/**
 * Wrap the CUSTOMER session middleware so it never runs on admin paths.
 *
 * Without this both middlewares would run on /api/admin and the second would
 * overwrite req.session — and the customer store would be touched (its expiry
 * extended) by admin traffic.
 */
function skipOnAdminPaths(middleware) {
  return function customerSessionUnlessAdmin(req, res, next) {
    if (isAdminPath(req)) return next();
    return middleware(req, res, next);
  };
}

const ADMIN_DB_POOL_MAX = 2;

/** The Postgres-backed admin store. Tests pass their own (MemoryStore). */
function buildAdminStore() {
  const pgSession = require('connect-pg-simple')(session);
  const { Pool } = require('pg');
  // Capped: admin traffic is one person. See the connection budget in lib/prisma.js.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: ADMIN_DB_POOL_MAX });
  pool.on('error', (err) => console.error('[AdminSession] Postgres pool error:', err.message));
  const store = new pgSession({
    pool,
    tableName: 'admin_sessions',
    // Created by migration 20260924120000_admin_users_audit_sessions.
    createTableIfMissing: false,
    pruneSessionInterval: 60 * 60,
  });
  // For graceful shutdown: the store does not end a pool it was handed.
  store.dbPool = pool;
  return store;
}

/**
 * @param {object} [opts]
 * @param {import('express-session').Store} [opts.store]  omitted = MemoryStore (tests only)
 * @param {boolean} [opts.secure]                          defaults to NODE_ENV === 'production'
 */
function buildAdminSessionMiddleware({ store, secure } = {}) {
  return session({
    name: ADMIN_COOKIE_NAME,
    store,
    secret: adminSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: typeof secure === 'boolean' ? secure : process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: ADMIN_COOKIE_PATH,
      // The cookie outlives nothing the server would accept: requireAdmin
      // enforces the 8-hour absolute limit itself.
      maxAge: ADMIN_ABSOLUTE_MS,
    },
  });
}

/**
 * Delete every stored session for one admin, optionally sparing the caller's.
 *
 * Used on password change and on lockout. Belt and braces: requireAdmin also
 * rejects any session whose passwordChangedAt snapshot is stale, which is what
 * makes this hold under a MemoryStore too.
 */
async function destroyAdminSessions(adminId, { exceptSid = null } = {}) {
  if (!adminId) return 0;
  try {
    if (exceptSid) {
      return await prisma.$executeRaw`DELETE FROM "admin_sessions" WHERE sess->>'adminId' = ${adminId} AND sid <> ${exceptSid}`;
    }
    return await prisma.$executeRaw`DELETE FROM "admin_sessions" WHERE sess->>'adminId' = ${adminId}`;
  } catch (err) {
    if (/does not exist/i.test(err.message || '')) return 0;
    throw err;
  }
}

/** When this session will stop being accepted, for the UI's countdown. */
function sessionDeadlines(sess, now = Date.now()) {
  return {
    idleExpiresAt: new Date((sess.lastActivityAt || now) + ADMIN_IDLE_MS).toISOString(),
    absoluteExpiresAt: new Date((sess.authenticatedAt || now) + ADMIN_ABSOLUTE_MS).toISOString(),
    stepUpValidUntil:
      sess.stepUpAt && now - sess.stepUpAt <= ADMIN_STEP_UP_MS
        ? new Date(sess.stepUpAt + ADMIN_STEP_UP_MS).toISOString()
        : null,
  };
}

module.exports = {
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_PATH,
  ADMIN_IDLE_MS,
  ADMIN_ABSOLUTE_MS,
  ADMIN_STEP_UP_MS,
  ADMIN_LOCK_AFTER_FAILURES,
  ADMIN_LOCK_MS,
  ADMIN_MIN_PASSWORD_LENGTH,
  ADMIN_MAX_PASSWORD_LENGTH,
  adminSessionSecret,
  isAdminPath,
  skipOnAdminPaths,
  buildAdminStore,
  buildAdminSessionMiddleware,
  destroyAdminSessions,
  sessionDeadlines,
};
