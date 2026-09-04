/**
 * Admin Authentication Middleware — protects /api/admin routes.
 * 
 * Verifies that:
 * 1. User is authenticated via session cookie
 * 2. User has role 'ADMIN' OR email/username is in ADMIN_EMAILS
 * 3. User account is not suspended
 */

const prisma = require('../lib/prisma');

async function requireAdmin(req, res, next) {
  // Allow dedicated admin session (Username/Password login)
  if (req.session && req.session.isAdmin) {
    req.adminUserId = req.session.adminUserId || 'admin-super';
    req.adminUser = { name: req.session.adminUsername || 'Mubassir', role: 'ADMIN' };
    return next();
  }

  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Log in to the admin panel to continue.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      // Only igUsername is read below. `true` would also load accessToken
      // (encrypted Meta token) into memory on every admin-gated request.
      include: { instagramAccounts: { select: { igUsername: true } } },
    });

    if (!user) {
      req.session.destroy();
      return res.status(401).json({ error: 'That account no longer exists.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ error: 'This account is suspended. Contact support.' });
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

    // Grant access only to an explicit ADMIN role or a configured ADMIN_EMAILS
    // match. The old "first user is automatically admin" rule was removed — it
    // silently handed super-admin to the first registrant on any fresh deploy.
    if (user.role === 'ADMIN' || isEmailAdmin) {
      // Auto-promote a configured admin email to the ADMIN role if needed.
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

    return res.status(403).json({ error: 'This area is restricted to administrators.' });
  } catch (error) {
    console.error('[AdminAuth] Error verifying admin access:', error.message);
    res.status(500).json({ error: "Couldn't confirm your access. Try again." });
  }
}

module.exports = { requireAdmin };
