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

  // Development fallback: if no session cookie, use latest user
  if (!userId && !isProduction) {
    try {
      const defaultUser = await prisma.user.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      if (defaultUser) {
        userId = defaultUser.id;
        if (req.session) {
          req.session.userId = userId;
        }
      }
    } catch (e) {}
  }

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }

  req.userId = userId;
  next();
}

module.exports = { requireAuth };
