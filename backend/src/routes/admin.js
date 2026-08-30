/**
 * Admin API Routes — Codeback Instagram DM Inbox SaaS Admin Panel
 * 
 * Heavily protected by requireAdmin middleware.
 * All modifying actions are recorded via logAdminAction audit logger.
 * Never exposes raw access tokens in responses for security.
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAdmin } = require('../middleware/adminAuth');
const { logAdminAction } = require('../lib/auditLogger');
const instagram = require('../lib/instagram');
const { encrypt, decrypt } = require('../lib/crypto');
const { getAIStats } = require('../services/aiService');
const { createRateLimiter } = require('../lib/rateLimit');
const { startAuthenticatedSession } = require('../lib/session');

// Strip password hashes (and any other secrets) before returning user rows.
function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return user;
  const { passwordHash, ...safe } = user;
  return safe;
}
const sanitizeUsers = (users) => (Array.isArray(users) ? users.map(sanitizeUser) : users);

// Constant-time string comparison that also hides length differences.
function timingSafeStrEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const adminLoginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts. Wait a few minutes and try again.',
});

// ============================================
// Public Admin Authentication Routes (No requireAdmin needed)
// ============================================

// POST /api/admin/login — Dedicated admin credentials from the environment.
//
// ADMIN_PASSWORD_HASH (a bcrypt hash) is the only accepted form in
// production. Plaintext ADMIN_PASSWORD remains available for local
// development only, and the server refuses to start if it is set in
// production (see the startup gate in src/index.js).
//
// This matters more than a normal credential: an admin session can
// impersonate any tenant (POST /api/admin/users/:id/impersonate), so a single
// leaked environment variable is silent read access to every tenant's
// customer DMs.
router.post('/login', adminLoginLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  const isProduction = process.env.NODE_ENV === 'production';
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
  // Never consult the plaintext variable in production, even if it is set.
  const adminPassword = isProduction ? null : process.env.ADMIN_PASSWORD;

  if (!adminUsername || (!adminPassword && !adminPasswordHash)) {
    console.error('[Admin Login] Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH.');
    return res.status(503).json({ error: 'Admin login is not set up on this server.' });
  }

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Enter a username and password.' });
  }

  const usernameOk = timingSafeStrEqual(username, adminUsername);
  let passwordOk = false;
  if (adminPasswordHash) {
    passwordOk = await bcrypt.compare(password, adminPasswordHash).catch(() => false);
  } else {
    passwordOk = timingSafeStrEqual(password, adminPassword);
  }

  if (!usernameOk || !passwordOk) {
    return res.status(401).json({ error: 'That username or password is not right.' });
  }

  // Find or create admin user in database
  let adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' }
  });

  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        name: `${adminUsername} (Admin)`,
        email: 'admin@codeback.internal',
        role: 'ADMIN',
      }
    });
  }

  // Elevating to admin is a privilege transition, so it gets a FRESH session
  // id (see lib/session.js).
  //
  // regenerate() discards all existing session data, so any regular-user
  // login already on this cookie is carried across explicitly. Admin and user
  // sessions share one cookie, and dropping userId here would silently log a
  // signed-in user out of the main app the moment they opened the admin
  // panel — the behaviour scripts/test-isolation.js asserts against.
  //
  // NOTE: we still never SET userId from admin credentials. Admin identity
  // lives only in isAdmin/adminUserId.
  const carriedUserId = req.session ? req.session.userId : undefined;
  const carriedUserEmail = req.session ? req.session.userEmail : undefined;
  const carriedIgUsername = req.session ? req.session.igUsername : undefined;

  try {
    await startAuthenticatedSession(req, {
      isAdmin: true,
      adminUsername,
      adminUserId: adminUser.id,
      ...(carriedUserId ? { userId: carriedUserId } : {}),
      ...(carriedUserEmail ? { userEmail: carriedUserEmail } : {}),
      ...(carriedIgUsername ? { igUsername: carriedIgUsername } : {}),
    });
  } catch (err) {
    console.error('[Admin Login] Session save error:', err);
    return res.status(500).json({ error: "Couldn't start your session. Try again." });
  }

  return res.json({
    success: true,
    message: 'Logged in',
    username: adminUsername,
    user: sanitizeUser(adminUser),
  });
});

// GET /api/admin/me — Check if active session is authenticated as Admin
router.get('/me', async (req, res) => {
  const isAdminSession = Boolean(req.session && req.session.isAdmin);

  if (isAdminSession) {
    return res.json({
      authenticated: true,
      isAdmin: true,
      username: req.session.adminUsername || 'Mubassir',
    });
  }

  // Also check if logged in via user session with ADMIN role
  if (req.session && req.session.userId) {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
      if (user && user.role === 'ADMIN') {
        return res.json({
          authenticated: true,
          isAdmin: true,
          username: user.name || user.email || 'Admin',
        });
      }
    } catch (e) {}
  }

  return res.json({ authenticated: false, isAdmin: false });
});

// POST /api/admin/logout — Log out of Admin panel
router.post('/logout', (req, res) => {
  if (req.session) {
    delete req.session.isAdmin;
    delete req.session.adminUsername;
    delete req.session.adminUserId;
    // Safety net: clean up userId if a stale session had it set by the
    // old admin-login code (which used to set req.session.userId too).
    // This prevents a logged-out admin from accidentally staying
    // authenticated as the admin user on regular-user API routes.
    if (req.session.userId && !req.session.igUsername) {
      delete req.session.userId;
    }
  }
  res.json({ success: true, message: 'Logged out' });
});

// Apply requireAdmin to all remaining admin endpoints
router.use(requireAdmin);

// ============================================
// 1. GET /api/admin/stats
// Platform-wide dashboard overview metrics & System Alerts
// ============================================
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await prisma.user.count();
    const totalAccounts = await prisma.instagramAccount.count();
    
    // Active vs Expired tokens
    const now = new Date();
    const activeAccounts = await prisma.instagramAccount.count({
      where: {
        tokenStatus: 'VALID',
        OR: [
          { tokenExpiresAt: null },
          { tokenExpiresAt: { gt: now } }
        ]
      }
    });

    const expiredAccounts = totalAccounts - activeAccounts;

    // Messages received today & this week
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    const messagesToday = await prisma.message.count({
      where: { createdAt: { gte: startOfToday } }
    });

    const messagesThisWeek = await prisma.message.count({
      where: { createdAt: { gte: startOfWeek } }
    });

    // Failed webhooks in the last 24h
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failedWebhooks24h = await prisma.webhookLog.count({
      where: {
        status: 'FAILED',
        createdAt: { gte: last24h }
      }
    });

    // System Alerts Generation
    const alerts = [];
    if (failedWebhooks24h > 5) {
      alerts.push({ level: 'WARNING', title: 'Deliveries failing', message: `Meta failed to deliver ${failedWebhooks24h} times in the last 24 hours.` });
    }
    if (expiredAccounts > 0) {
      alerts.push({ level: 'ERROR', title: 'Accounts need reconnecting', message: `${expiredAccounts} connected account(s) stopped receiving messages.` });
    }
    if (totalAccounts === 0) {
      alerts.push({ level: 'INFO', title: 'No connected accounts', message: 'No customer has connected an Instagram account yet.' });
    }

    // Recent signups (last 5)
    const recentSignups = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        instagramAccounts: {
          select: { id: true, igUsername: true, igProfilePic: true }
        }
      }
    });

    // AI Call Stats & Category counts from DB
    const aiStats = getAIStats();
    const categoryBreakdown = await prisma.conversation.groupBy({
      by: ['category'],
      _count: { id: true },
    });

    const totalBrandDeals = await prisma.brandDeal.count();
    const pendingAiMessages = await prisma.message.count({ where: { aiStatus: { in: ['pending', 'processing'] } } });
    const failedAiMessages = await prisma.message.count({ where: { aiStatus: 'failed' } });
    const { getJobSystem } = require('../lib/queue');
    const queueMode = getJobSystem('ai-processing').mode;

    res.json({
      totalUsers,
      totalAccounts,
      activeAccounts,
      expiredAccounts,
      messagesToday,
      messagesThisWeek,
      failedWebhooks24h,
      alerts,
      recentSignups: sanitizeUsers(recentSignups),
      aiStats,
      categoryBreakdown,
      totalBrandDeals,
      pendingAiMessages,
      failedAiMessages,
      queueMode,
    });
  } catch (error) {
    console.error('[Admin API] Error fetching stats:', error.message);
    res.status(500).json({ error: "Couldn't load platform stats. Refresh to try again." });
  }
});

// ============================================
// 2. USERS MANAGEMENT
// ============================================

// GET /api/admin/users — List all users (search & pagination)
router.get('/users', async (req, res) => {
  try {
    const { search = '', page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const whereClause = search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        {
          instagramAccounts: {
            some: { igUsername: { contains: search, mode: 'insensitive' } }
          }
        }
      ]
    } : {};

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          instagramAccounts: {
            select: {
              id: true,
              igUserId: true,
              igUsername: true,
              igName: true,
              igProfilePic: true,
              tokenStatus: true,
              connectionStatus: true,
              tokenExpiresAt: true,
              lastWebhookAt: true,
            }
          }
        }
      }),
      prisma.user.count({ where: whereClause })
    ]);

    res.json({
      users: sanitizeUsers(users),
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      }
    });
  } catch (error) {
    console.error('[Admin API] Error listing users:', error.message);
    res.status(500).json({ error: "Couldn't load customers. Refresh to try again." });
  }
});

// GET /api/admin/users/export/csv — Export users list as CSV
router.get('/users/export/csv', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { instagramAccounts: true }
    });

    let csv = 'User ID,Name,Email,Role,Is Suspended,Connected Accounts,Created At\n';
    users.forEach(u => {
      const accUsernames = u.instagramAccounts.map(a => a.igUsername).join('; ');
      csv += `"${u.id}","${u.name || ''}","${u.email || ''}","${u.role}",${u.isSuspended},"${accUsernames}","${u.createdAt.toISOString()}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=codeback_users.csv');
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ error: "Couldn't export that CSV. Try again." });
  }
});

// GET /api/admin/users/:id — View single user details
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        instagramAccounts: {
          select: {
            id: true,
            igUserId: true,
            igUsername: true,
            igName: true,
            igProfilePic: true,
            tokenStatus: true,
            connectionStatus: true,
            tokenExpiresAt: true,
            lastWebhookAt: true,
            createdAt: true,
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'That customer no longer exists.' });
    }

    res.json(sanitizeUser(user));
  } catch (error) {
    console.error('[Admin API] Error fetching user detail:', error.message);
    res.status(500).json({ error: "Couldn't load that customer. Try again." });
  }
});

// POST /api/admin/users/:id/suspend — Suspend / Unsuspend user
router.post('/users/:id/suspend', async (req, res) => {
  try {
    const { id } = req.params;
    const { suspend = true } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: 'That customer no longer exists.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isSuspended: Boolean(suspend) }
    });

    await logAdminAction(
      req.adminUserId,
      suspend ? 'USER_SUSPEND' : 'USER_UNSUSPEND',
      'USER',
      id,
      { userName: user.name || user.email },
      req.ip
    );

    res.json({
      message: `User ${suspend ? 'suspended' : 'unsuspended'} successfully`,
      user: sanitizeUser(updatedUser)
    });
  } catch (error) {
    console.error('[Admin API] Error toggling user suspension:', error.message);
    res.status(500).json({ error: "Couldn't change that customer's status. Try again." });
  }
});

// DELETE /api/admin/users/:id — Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: 'That customer no longer exists.' });
    }

    await prisma.user.delete({ where: { id } });

    await logAdminAction(
      req.adminUserId,
      'USER_DELETE',
      'USER',
      id,
      { deletedUserName: user.name || user.email },
      req.ip
    );

    res.json({ message: 'Customer deleted' });
  } catch (error) {
    console.error('[Admin API] Error deleting user:', error.message);
    res.status(500).json({ error: "Couldn't delete that customer. Try again." });
  }
});

// POST /api/admin/users/:id/impersonate — Log in as user (Support override)
router.post('/users/:id/impersonate', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: 'That customer no longer exists.' });
    }

    // Set impersonation state without destroying original admin user session
    req.session.adminOriginalUserId = req.adminUserId;
    req.session.impersonatedUserId = user.id;
    req.session.userId = user.id;

    await logAdminAction(
      req.adminUserId,
      'USER_IMPERSONATE_START',
      'USER',
      id,
      { impersonatedUserName: user.name || user.email },
      req.ip
    );

    res.json({
      message: `Started impersonating user ${user.name || user.id}`,
      redirectUrl: '/dashboard'
    });
  } catch (error) {
    console.error('[Admin API] Error impersonating user:', error.message);
    res.status(500).json({ error: "Couldn't open the customer view. Try again." });
  }
});

// POST /api/admin/impersonate/exit — Stop impersonating user and return to Admin
router.post('/impersonate/exit', async (req, res) => {
  try {
    const originalAdminId = req.session?.adminOriginalUserId;
    // Captured before the session fields are cleared. The exit record used to
    // log the ADMIN's own id as the target, which made it impossible to pair
    // a start with its end and so to bound which tenant was accessed and for
    // how long — the whole point of auditing impersonation.
    const impersonatedUserId = req.session?.impersonatedUserId || null;

    if (originalAdminId) {
      req.session.userId = originalAdminId;
      delete req.session.adminOriginalUserId;
      delete req.session.impersonatedUserId;

      await logAdminAction(
        originalAdminId,
        'USER_IMPERSONATE_EXIT',
        'USER',
        impersonatedUserId,
        { status: 'Exited impersonation mode', impersonatedUserId, adminUserId: originalAdminId },
        req.ip
      );
    }

    res.json({ message: 'Returned to the admin panel', redirectUrl: '/admin' });
  } catch (error) {
    res.status(500).json({ error: "Couldn't leave the customer view. Reload the page." });
  }
});

// ============================================
// 3. INSTAGRAM ACCOUNTS MANAGEMENT
// ============================================

// GET /api/admin/accounts — List all connected Instagram accounts across platform
router.get('/accounts', async (req, res) => {
  try {
    const { search = '', status = '' } = req.query;

    const whereClause = {};
    if (search) {
      whereClause.OR = [
        { igUsername: { contains: search, mode: 'insensitive' } },
        { igName: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } }
      ];
    }

    if (status) {
      whereClause.tokenStatus = status;
    }

    const accounts = await prisma.instagramAccount.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        igUserId: true,
        igUsername: true,
        igName: true,
        igProfilePic: true,
        tokenStatus: true,
        connectionStatus: true,
        tokenExpiresAt: true,
        lastWebhookAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, email: true } },
        _count: {
          select: { conversations: true, contacts: true }
        }
      }
    });

    res.json(accounts);
  } catch (error) {
    console.error('[Admin API] Error listing accounts:', error.message);
    res.status(500).json({ error: "Couldn't load connected accounts. Refresh to try again." });
  }
});

// GET /api/admin/accounts/export/csv — Export accounts list as CSV
router.get('/accounts/export/csv', async (req, res) => {
  try {
    const accounts = await prisma.instagramAccount.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: true, _count: { select: { conversations: true } } }
    });

    let csv = 'Account ID,IG Username,IG User ID,Owner,Token Status,Token Expires At,Last Webhook At,Conversations,Created At\n';
    accounts.forEach(a => {
      csv += `"${a.id}","${a.igUsername || ''}","${a.igUserId}","${a.user?.name || a.user?.email || ''}","${a.tokenStatus}","${a.tokenExpiresAt ? a.tokenExpiresAt.toISOString() : ''}","${a.lastWebhookAt ? a.lastWebhookAt.toISOString() : ''}",${a._count.conversations},"${a.createdAt.toISOString()}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=codeback_instagram_accounts.csv');
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ error: "Couldn't export that CSV. Try again." });
  }
});

// POST /api/admin/accounts/:id/refresh-token — Force token refresh with Meta
router.post('/accounts/:id/refresh-token', async (req, res) => {
  try {
    const { id } = req.params;
    const account = await prisma.instagramAccount.findUnique({ where: { id } });
    if (!account) {
      return res.status(404).json({ error: 'That account no longer exists.' });
    }

    const currentToken = decrypt(account.accessToken);
    const longTokenData = await instagram.exchangeForLongLivedToken(
      currentToken,
      process.env.INSTAGRAM_APP_SECRET
    );

    const tokenExpiresAt = new Date(Date.now() + (longTokenData.expires_in * 1000));
    const updated = await prisma.instagramAccount.update({
      where: { id },
      data: {
        accessToken: encrypt(longTokenData.access_token),
        tokenExpiresAt: tokenExpiresAt,
        tokenStatus: 'VALID',
      }
    });

    await logAdminAction(
      req.adminUserId,
      'TOKEN_REFRESH',
      'INSTAGRAM_ACCOUNT',
      id,
      { igUsername: account.igUsername },
      req.ip
    );

    res.json({
      message: 'Access refreshed',
      account: {
        id: updated.id,
        igUsername: updated.igUsername,
        tokenStatus: updated.tokenStatus,
        tokenExpiresAt: updated.tokenExpiresAt,
      }
    });
  } catch (error) {
    console.error('[Admin API] Token refresh error:', error.message);
    await prisma.instagramAccount.update({
      where: { id: req.params.id },
      data: { tokenStatus: 'NEEDS_RECONNECT' }
    });

    res.status(502).json({
      error: "Couldn't refresh access with Meta.",
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// POST /api/admin/accounts/:id/resubscribe-webhook — Re-subscribe account webhooks
router.post('/accounts/:id/resubscribe-webhook', async (req, res) => {
  try {
    const { id } = req.params;
    const account = await prisma.instagramAccount.findUnique({ where: { id } });
    if (!account) {
      return res.status(404).json({ error: 'That account no longer exists.' });
    }

    const token = decrypt(account.accessToken);
    await instagram.subscribeToWebhooks(account.igUserId, token);

    await logAdminAction(
      req.adminUserId,
      'WEBHOOK_RESUBSCRIBE',
      'INSTAGRAM_ACCOUNT',
      id,
      { igUsername: account.igUsername },
      req.ip
    );

    res.json({ message: `Successfully re-subscribed webhooks for @${account.igUsername}` });
  } catch (error) {
    console.error('[Admin API] Webhook resubscribe error:', error.message);
    res.status(502).json({
      error: "Couldn't resubscribe with Meta.",
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// POST /api/admin/accounts/:id/mark-needs-reconnect
router.post('/accounts/:id/mark-needs-reconnect', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await prisma.instagramAccount.update({
      where: { id },
      data: { tokenStatus: 'NEEDS_RECONNECT' }
    });

    await logAdminAction(
      req.adminUserId,
      'ACCOUNT_MARK_NEEDS_RECONNECT',
      'INSTAGRAM_ACCOUNT',
      id,
      { igUsername: updated.igUsername },
      req.ip
    );

    res.json({ message: 'Account marked as needing reconnection', account: updated });
  } catch (error) {
    res.status(500).json({ error: "Couldn't update that account. Try again." });
  }
});

// DELETE /api/admin/accounts/:id — Disconnect Instagram Account
router.delete('/accounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const account = await prisma.instagramAccount.findUnique({ where: { id } });
    if (!account) {
      return res.status(404).json({ error: 'That account no longer exists.' });
    }

    await prisma.instagramAccount.delete({ where: { id } });

    await logAdminAction(
      req.adminUserId,
      'ACCOUNT_DISCONNECT',
      'INSTAGRAM_ACCOUNT',
      id,
      { igUsername: account.igUsername },
      req.ip
    );

    res.json({ message: 'Account disconnected' });
  } catch (error) {
    console.error('[Admin API] Error disconnecting account:', error.message);
    res.status(500).json({ error: "Couldn't disconnect that account. Try again." });
  }
});

// ============================================
// 4. SYSTEM HEALTH & LOGS
// ============================================

// GET /api/admin/logs/webhooks — Webhook payload inspector
router.get('/logs/webhooks', async (req, res) => {
  try {
    const { limit = 50, status = '' } = req.query;
    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

    const whereClause = status ? { status } : {};

    const logs = await prisma.webhookLog.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      include: {
        instagramAccount: {
          select: { igUsername: true }
        }
      }
    });

    res.json(logs);
  } catch (error) {
    console.error('[Admin API] Error fetching webhook logs:', error.message);
    res.status(500).json({ error: "Couldn't load delivery logs. Refresh to try again." });
  }
});

// POST /api/admin/logs/prune — Auto retention cleanup (delete logs older than X days)
router.post('/logs/prune', async (req, res) => {
  try {
    const { days = 30 } = req.body;
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const deleted = await prisma.webhookLog.deleteMany({
      where: { createdAt: { lt: cutoffDate } }
    });

    await logAdminAction(
      req.adminUserId,
      'LOG_PRUNE',
      'SYSTEM',
      null,
      { retentionDays: days, deletedCount: deleted.count },
      req.ip
    );

    res.json({ message: `Pruned ${deleted.count} webhook logs older than ${days} days.` });
  } catch (error) {
    res.status(500).json({ error: "Couldn't clear those logs. Try again." });
  }
});

// GET /api/admin/logs/audit — Admin audit logs
router.get('/logs/audit', async (req, res) => {
  try {
    const logs = await prisma.adminLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        adminUser: { select: { name: true, email: true } }
      }
    });

    res.json(logs);
  } catch (error) {
    console.error('[Admin API] Error fetching audit logs:', error.message);
    res.status(500).json({ error: "Couldn't load the audit log. Refresh to try again." });
  }
});

// ============================================
// 5. SUPPORT TOOLS
// ============================================

// GET /api/admin/support/search — Unified instant search
router.get('/support/search', async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (!q || !q.trim()) {
      return res.json({ users: [], accounts: [] });
    }

    const query = q.trim();

    const [users, accounts] = await Promise.all([
      prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ]
        },
        take: 5,
        include: {
          instagramAccounts: {
            select: { id: true, igUsername: true, igProfilePic: true, tokenStatus: true }
          }
        }
      }),
      prisma.instagramAccount.findMany({
        where: {
          OR: [
            { igUsername: { contains: query, mode: 'insensitive' } },
            { igName: { contains: query, mode: 'insensitive' } },
            { igUserId: { contains: query, mode: 'insensitive' } },
          ]
        },
        take: 5,
        select: {
          id: true,
          igUserId: true,
          igUsername: true,
          igName: true,
          igProfilePic: true,
          tokenStatus: true,
          tokenExpiresAt: true,
          user: { select: { id: true, name: true, email: true } }
        }
      })
    ]);

    res.json({ users: sanitizeUsers(users), accounts });
  } catch (error) {
    console.error('[Admin API] Support search error:', error.message);
    res.status(500).json({ error: "Couldn't run that search. Try again." });
  }
});

// GET /api/admin/support/conversations/:id — Read-only conversation viewer for support
router.get('/support/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        contact: true,
        instagramAccount: {
          select: { id: true, igUsername: true, igName: true }
        },
        messages: { orderBy: { createdAt: 'asc' } }
      }
    });

    if (!conversation) {
      return res.status(404).json({ error: 'That conversation no longer exists.' });
    }

    res.json(conversation);
  } catch (error) {
    console.error('[Admin API] Error loading support conversation:', error.message);
    res.status(500).json({ error: "Couldn't open that conversation. Try again." });
  }
});

// ============================================
// 6. ADMIN SETTINGS & ENVIRONMENT
// ============================================
router.get('/settings', async (req, res) => {
  try {
    const adminUsers = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true, name: true, email: true, createdAt: true }
    });

    res.json({
      adminUsers,
      environment: {
        port: process.env.PORT || 5000,
        frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
        redirectUri: process.env.REDIRECT_URI || 'Not configured',
        skipSignatureVerification: process.env.SKIP_SIGNATURE_VERIFICATION === 'true',
        nodeEnv: process.env.NODE_ENV || 'development',
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Couldn't load server configuration. Refresh to try again." });
  }
});

module.exports = router;
