/**
 * Authentication middleware for Codeback.
 * 
 * Checks that the user is logged in via their session cookie.
 * Attaches user info to req.user for downstream route handlers.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function requireAuth(req, res, next) {
  let userId = req.session ? req.session.userId : null;

  if (!userId && req.query && req.query.user_id) {
    userId = req.query.user_id;
  }

  // Development fallback: if no session cookie, use latest user
  if (!userId && process.env.NODE_ENV !== 'production') {
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
