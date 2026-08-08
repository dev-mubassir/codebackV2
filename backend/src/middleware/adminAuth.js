/**
 * Admin Authentication Middleware — protects /api/admin routes.
 * 
 * Verifies that:
 * 1. User is authenticated via session cookie
 * 2. User has role 'ADMIN' OR email/username is in ADMIN_EMAILS
 * 3. User account is not suspended
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function requireAdmin(req, res, next) {
  // Allow dedicated admin session (Username/Password login)
  if (req.session && req.session.isAdmin) {
    req.adminUserId = req.session.adminUserId || 'admin-super';
    req.adminUser = { name: req.session.adminUsername || 'Mubassir', role: 'ADMIN' };
    return next();
  }

  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized. Admin session required.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      include: { instagramAccounts: true },
    });

    if (!user) {
      req.session.destroy();
      return res.status(401).json({ error: 'User not found.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ error: 'Your account has been suspended by an administrator.' });
    }

    // Configured admin emails or usernames
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = user.email ? user.email.toLowerCase() : '';
    const igUsernames = user.instagramAccounts.map(a => (a.igUsername || '').toLowerCase());

    const isEmailAdmin = adminEmails.length > 0 && (
      adminEmails.includes(userEmail) ||
      igUsernames.some(u => adminEmails.includes(u) || adminEmails.includes(`@${u}`))
    );

    // Grant access if role is ADMIN or matched ADMIN_EMAILS or if it's the very first user (for local dev setup)
    const totalUsers = await prisma.user.count();
    const isFirstUser = totalUsers === 1;

    if (user.role === 'ADMIN' || isEmailAdmin || isFirstUser) {
      // Auto-promote to ADMIN role in database if not already
      if (user.role !== 'ADMIN') {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: 'ADMIN' },
        });
      }

      req.adminUser = user;
      req.adminUserId = user.id;
      return next();
    }

    return res.status(403).json({ error: 'Forbidden. Access restricted to Super Admins.' });
  } catch (error) {
    console.error('[AdminAuth] Error verifying admin access:', error.message);
    res.status(500).json({ error: 'Internal server error during authorization.' });
  }
}

module.exports = { requireAdmin };
