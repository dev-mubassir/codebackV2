/**
 * Authentication middleware for Codeback.
 * 
 * Checks that the user is logged in via their session cookie.
 * Attaches user info to req.user for downstream route handlers.
 */

async function requireAuth(req, res, next) {
  // Identity comes ONLY from the server-side session. A client-supplied
  // `user_id` (query/body/header) is never trusted — doing so was a full
  // authentication bypass that let anyone act as any account by id.
  const userId = req.session ? req.session.userId : null;

  if (!userId) {
    return res.status(401).json({ error: 'Log in to continue.' });
  }

  req.userId = userId;
  next();
}

module.exports = { requireAuth };
