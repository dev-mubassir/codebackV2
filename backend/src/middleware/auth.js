/**
 * Authentication middleware for Codeback.
 *
 * ONE query, three checks. Deliberately not three middlewares and not three
 * queries — they all need the same row, and splitting them would triple the
 * per-request cost for no benefit:
 *
 *   1. does the user still EXIST?
 *      A session outlives the row it points at. After DELETE /auth/account on
 *      another device, or an admin deleting the user, the stale session used
 *      to sail straight through and later 500 on a dangling foreign key.
 *
 *   2. is the user SUSPENDED?
 *      Suspension used to be enforced only at the login boundary, so a user
 *      suspended while logged in kept full access to every /api route and
 *      their socket room until the 7-day cookie expired.
 *
 *   3. does the session's sessionVersion still MATCH?
 *      This is how a password reset kills every other session without
 *      enumerating a session store. Reset bumps User.sessionVersion; every
 *      session minted before the bump now mismatches and is rejected on its
 *      next request.
 *
 * The cost is one indexed primary-key lookup per authenticated request.
 */

const prisma = require('../lib/prisma');

async function requireAuth(req, res, next) {
  // Identity comes ONLY from the server-side session. A client-supplied
  // `user_id` (query/body/header) is never trusted — doing so was a full
  // authentication bypass that let anyone act as any account by id.
  const userId = req.session ? req.session.userId : null;

  if (!userId) {
    // lib/sessionIdle.js ended this session on THIS request. Say so, so the
    // app can show "you were signed out for inactivity" instead of a bare
    // login page.
    if (req.sessionExpired === 'idle') {
      return res.status(401).json({ error: 'You were signed out after a period of inactivity. Log in again.', code: 'SESSION_IDLE_EXPIRED' });
    }
    if (req.sessionExpired === 'absolute') {
      return res.status(401).json({ error: 'Your session expired. Log in again.', code: 'SESSION_EXPIRED' });
    }
    return res.status(401).json({ error: 'Log in to continue.' });
  }

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        isSuspended: true,
        sessionVersion: true,
        role: true,
      },
    });
  } catch (error) {
    console.error('[Auth] Session validation failed:', error.message);
    return res.status(500).json({ error: "Couldn't verify your session. Try again." });
  }

  // (1) The row is gone.
  if (!user) {
    if (req.session) req.session.destroy(() => {});
    return res.status(401).json({ error: 'Log in to continue.' });
  }

  // (2) Suspended — enforced on every request, not just at login.
  if (user.isSuspended) {
    if (req.session) req.session.destroy(() => {});
    return res.status(403).json({ error: 'This account is suspended. Contact support.' });
  }

  // (3) Session predates a password reset (or another forced logout).
  //
  // A session minted before sessionVersion existed carries `undefined`, which
  // is treated as 0 so that pre-existing sessions are not all invalidated the
  // moment this ships.
  const sessionVersion = typeof req.session.sessionVersion === 'number' ? req.session.sessionVersion : 0;
  if (sessionVersion !== user.sessionVersion) {
    if (req.session) req.session.destroy(() => {});
    return res.status(401).json({ error: 'Your password changed. Log in again.' });
  }

  req.userId = user.id;
  req.user = user;
  next();
}

/**
 * Gate for routes that need a CONFIRMED email address.
 *
 * Two populations cannot pass:
 *   - null-email users, created by the old Instagram-signup path that no
 *     longer exists. They must add an email before they can do anything else.
 *   - users who registered but never clicked the verification link.
 *
 * A trial cannot be granted to either, so the Instagram connect flow sits
 * behind this. The response distinguishes the two cases so the frontend can
 * route to "add your email" versus "check your inbox" — this is post-auth, so
 * it reveals nothing to an unauthenticated caller.
 *
 * Must run AFTER requireAuth.
 */
function requireVerifiedEmail(req, res, next) {
  if (!req.user) {
    return res.status(500).json({ error: 'requireVerifiedEmail must run after requireAuth.' });
  }

  if (!req.user.email) {
    return res.status(403).json({
      error: 'Add an email address to your account first.',
      code: 'EMAIL_REQUIRED',
    });
  }

  if (!req.user.emailVerifiedAt) {
    return res.status(403).json({
      error: 'Confirm your email address first. Check your inbox for the link.',
      code: 'EMAIL_UNVERIFIED',
    });
  }

  next();
}

module.exports = { requireAuth, requireVerifiedEmail };
