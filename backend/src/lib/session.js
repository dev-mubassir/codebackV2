/**
 * Session helpers for privilege transitions.
 *
 * Every login, registration, and OAuth completion must issue a NEW session
 * id. Writing `userId` onto the session id the client already presented lets
 * an attacker who planted a valid signed cookie ride the victim's login —
 * session fixation. express-session does not regenerate on its own.
 */

const prisma = require('./prisma');

/** Promise wrapper around req.session.regenerate(). */
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.regenerate !== 'function') return resolve();
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/** Promise wrapper around req.session.save(). */
function saveSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.save !== 'function') return resolve();
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Regenerate the session, then apply `values` to the fresh one and persist it.
 * regenerate() discards all existing session data, so anything that must
 * survive the transition has to be passed in here.
 */
async function startAuthenticatedSession(req, values = {}) {
  await regenerateSession(req);
  // Signing in is activity, and starts the 7-day absolute clock
  // (lib/sessionIdle.js). The admin login passes its own values for both.
  const now = Date.now();
  Object.assign(req.session, { authenticatedAt: now, lastActivityAt: now }, values);
  await saveSession(req);
}

/**
 * Delete every row in the Postgres-backed session store belonging to one
 * user, by the `userId` embedded in each session's JSON blob.
 *
 * Exists for deletions that have NO req.session to destroy — Meta's data
 * deletion callback is server-to-server, unlike DELETE /auth/account, which
 * destroys only the caller's own session via req.session.destroy(). This is
 * what actually evicts every OTHER live session (another device, another
 * browser) for a user whose account Meta just told us to erase.
 *
 * connect-pg-simple's table (`user_sessions`) is deliberately absent from
 * schema.prisma (see index.js buildSessionStore) so Prisma has no model for
 * it; this goes through a raw query against the same database Prisma is
 * already connected to. Safe to call in an environment where that table has
 * never been created (e.g. a Postgres session store was never initialized) —
 * account deletion must never fail because of this.
 */
async function destroyUserSessions(userId) {
  if (!userId) return 0;
  try {
    return await prisma.$executeRaw`DELETE FROM "user_sessions" WHERE sess->>'userId' = ${userId}`;
  } catch (err) {
    if (/does not exist/i.test(err.message || '')) return 0;
    throw err;
  }
}

module.exports = { regenerateSession, saveSession, startAuthenticatedSession, destroyUserSessions };
