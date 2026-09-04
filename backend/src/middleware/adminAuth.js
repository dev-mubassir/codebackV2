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
    // Explicit select. The Instagram relation is no longer loaded at all —
    // admin identity no longer looks at igUsername, and `true` would have
    // pulled the encrypted Meta token into memory on every admin request.
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuspended: true,
        emailVerifiedAt: true,
      },
    });

    if (!user) {
      req.session.destroy();
      return res.status(401).json({ error: 'That account no longer exists.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ error: 'This account is suspended. Contact support.' });
    }

    // Configured admin emails.
    //
    // INSTAGRAM USERNAMES ARE NO LONGER ACCEPTED HERE. Matching ADMIN_EMAILS
    // against a connected account's igUsername keyed super-admin — which can
    // impersonate any tenant — on a MUTABLE, EXTERNALLY CONTROLLED attribute,
    // and then wrote role: 'ADMIN' to that user's row permanently. Instagram
    // handles are globally unique so a live one cannot be squatted, but a
    // renamed or released handle can be claimed by anyone. Admin identity now
    // keys only on a verified email address.
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = user.email ? user.email.toLowerCase() : '';

    // The address must also be PROVEN. An unverified email is an unproven
    // claim, and granting admin on one would let anyone who registers with a
    // configured address take the panel without ever receiving mail there.
    const isEmailAdmin =
      adminEmails.length > 0 &&
      Boolean(userEmail) &&
      Boolean(user.emailVerifiedAt) &&
      adminEmails.includes(userEmail);

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
