/**
 * The canonical authorization chain.
 *
 * requireAuth -> requireVerifiedEmail -> requireWorkspace -> requireRole
 *
 * The point is that no route defines its own ad-hoc check. Before this, four
 * separate variants of "is the user logged in" existed — one middleware and
 * three hand-rolled copies inside routes/auth.js — and the copies silently
 * skipped the sessionVersion comparison, so a session invalidated by a
 * password reset still worked against them. Anything that drifts, drifts
 * insecurely.
 *
 * requireAuth and requireVerifiedEmail live in ./auth.js. This module adds the
 * two that depend on tenant state.
 */

const prisma = require('../lib/prisma');

/**
 * Resolve the caller's OWNED Instagram account ids once, and attach them.
 *
 * Routes then scope every query with `instagramAccountId: { in: req.ownedAccountIds }`
 * instead of re-deriving ownership per handler. A route that forgets the
 * filter returns nothing rather than someone else's data, because the list is
 * always the caller's own.
 *
 * An `accountId` supplied by the client is INTERSECTED against this list, never
 * trusted: a foreign id collapses the filter to an empty set and matches zero
 * rows. Failing closed is the property that matters — a filter that silently
 * widens is how cross-tenant reads happen.
 *
 * Must run AFTER requireAuth.
 */
async function requireWorkspace(req, res, next) {
  if (!req.userId) {
    return res.status(500).json({ error: 'requireWorkspace must run after requireAuth.' });
  }

  try {
    const accounts = await prisma.instagramAccount.findMany({
      where: { userId: req.userId },
      select: { id: true, igUserId: true, connectionStatus: true },
    });

    req.ownedAccountIds = accounts.map((a) => a.id);
    req.ownedAccounts = accounts;

    // Deliberately NOT an error when empty. A newly registered user with no
    // connected account must still be able to load their dashboard; the empty
    // list simply means every scoped query matches nothing.
    return next();
  } catch (error) {
    console.error('[Authz] Failed to resolve workspace:', error.message);
    return res.status(500).json({ error: "Couldn't load your account. Try again." });
  }
}

/**
 * Narrow a client-supplied account id to one the caller actually owns.
 * Returns the owned id list to filter by — never the raw input.
 */
function scopeAccountIds(req, requestedAccountId) {
  const owned = req.ownedAccountIds || [];
  if (!requestedAccountId) return owned;
  // Array-valued query params (?accountId=a&accountId=b) collapse to [] here,
  // which is the correct fail-closed outcome.
  if (typeof requestedAccountId !== 'string') return [];
  return owned.includes(requestedAccountId) ? [requestedAccountId] : [];
}

/**
 * Role gate. Separate from the admin panel's own credential path — a normal
 * user session can never satisfy this by accident, because role is not
 * settable through any user-facing route.
 *
 * Must run AFTER requireAuth.
 */
function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles);
  return function roleGate(req, res, next) {
    if (!req.user) {
      return res.status(500).json({ error: 'requireRole must run after requireAuth.' });
    }
    if (!allowed.has(req.user.role)) {
      // 403, not 404: this is function-level authorization, and the route's
      // existence is not a secret. The 404-not-403 rule applies to RESOURCES,
      // where a 403 would confirm that a specific id exists.
      return res.status(403).json({ error: 'You do not have access to that.' });
    }
    return next();
  };
}

module.exports = { requireWorkspace, requireRole, scopeAccountIds };
