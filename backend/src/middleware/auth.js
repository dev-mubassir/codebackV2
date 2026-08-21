/**
 * Authentication middleware for Codeback.
 * 
 * Checks that the user is logged in via their session cookie.
 * Attaches user info to req.user for downstream route handlers.
 */

const prisma = require('../lib/prisma');

const isProduction = process.env.NODE_ENV === 'production';

async function requireAuth(req, res, next) {
  let userId = req.session ? req.session.userId : null;

  // SECURITY: a client-supplied `user_id` must never be trusted to
  // authenticate as another account. This escape hatch only exists for
  // local development/debugging and is hard-disabled in production.
  if (!userId && !isProduction && req.query && req.query.user_id) {
    console.warn('[Auth] Using query-supplied user_id fallback (non-production only). Never trust this in production.');
    userId = req.query.user_id;
  }

  // NOTE: The old dev-mode fallback that auto-picked the latest user has
  // been removed. It silently authenticated every unauthenticated request
  // as the most recently created user, which completely broke multi-user
  // testing and tenant isolation. Use the ?user_id= query param above for
  // explicit debugging instead.

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }

  req.userId = userId;
  next();
}

module.exports = { requireAuth };
