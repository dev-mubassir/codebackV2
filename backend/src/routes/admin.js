/**
 * Admin API — /api/admin/*
 *
 * Mounted in src/index.js behind the ADMIN session middleware (never the
 * customer one). Layout of this file:
 *
 *   1. Public:   POST /login (origin-guarded, rate-limited, lockout).
 *   2. Everything else: requireAdmin (404 to anyone who is not an admin),
 *      then adminOriginGuard (a mutation MUST carry an allowlisted Origin),
 *      then trackAdminActivity (mutations count as activity; GETs never do).
 *   3. Destructive actions additionally need requireStepUp (password
 *      re-entered in the last 5 minutes) and a written reason.
 *
 * Every login attempt and every mutation writes an admin_audit_logs row.
 *
 * PRIVACY: nothing here returns Instagram DM content — no message text, no
 * webhook payloads, no AI summaries. Counts and metadata only. The old
 * support conversation viewer and impersonation are gone for that reason.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const instagram = require('../lib/instagram');
const { readAccountToken, writeAccountToken } = require('../lib/crypto');
const aiService = require('../services/aiService');
const { getAIStats } = aiService;
const { collectHealth } = require('../lib/health');
const { createRateLimiter } = require('../lib/rateLimit');
const { startAuthenticatedSession, destroyUserSessions } = require('../lib/session');
const { disconnectUserSockets } = require('../lib/socket');
const { hashPassword, verifyPassword, burnEquivalentWork } = require('../lib/password');
const { recordAdminAudit, buildAuditRow } = require('../lib/adminAudit');
const refundService = require('../services/refundService');
// Bound as `mailer`, never `email` — see routes/auth.js.
const mailer = require('../lib/email');
const {
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_PATH,
  ADMIN_LOCK_AFTER_FAILURES,
  ADMIN_LOCK_MS,
  ADMIN_MIN_PASSWORD_LENGTH,
  ADMIN_MAX_PASSWORD_LENGTH,
  destroyAdminSessions,
  sessionDeadlines,
} = require('../lib/adminSession');
const { requireAdmin, requireStepUp, adminOriginGuard, trackAdminActivity } = require('../middleware/adminAuth');

// ============================================
// Shared helpers
// ============================================

const GENERIC_LOGIN_ERROR = 'That email or password is not right.';

// Per-IP, on top of the per-ACCOUNT lockout below. The lockout protects one
// admin from distributed guessing; this protects the endpoint from one address.
const adminLoginIpLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-in attempts. Wait a few minutes and try again.',
});
const adminStepUpIpLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts. Wait a few minutes and try again.',
});

/** A written reason, required on every mutation that changes a customer's state. */
function readReason(req, res) {
  const raw = req.body && req.body.reason;
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < 3 || reason.length > 500) {
    res.status(400).json({ error: 'Give a reason (3 to 500 characters).', code: 'REASON_REQUIRED' });
    return null;
  }
  return reason;
}

/**
 * One CSV cell: always quoted, quotes doubled, and a leading = + - @ tab or
 * CR neutralised with an apostrophe so a spreadsheet never evaluates a
 * customer-supplied name as a formula (CSV/formula injection).
 */
function csvCell(value) {
  let s = value instanceof Date ? value.toISOString() : String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
const csvRow = (cells) => `${cells.map(csvCell).join(',')}\n`;

function clampInt(raw, { min, max, fallback }) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// The only shapes of User / InstagramAccount the admin API returns. Explicit
// selects, never `include: true`, which would pull passwordHash or the
// encrypted Meta token into the response.
const USER_ADMIN_SELECT = {
  id: true,
  name: true,
  email: true,
  isSuspended: true,
  emailVerifiedAt: true,
  onboardingCompleted: true,
  lastSeenAt: true,
  createdAt: true,
};
const ACCOUNT_ADMIN_SELECT = {
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
};

/**
 * First line only, bounded. WebhookLog.errorMessage can hold a Prisma
 * invocation error, whose later lines dump the arguments — including a
 * message's text. The first line never does.
 */
function safeErrorLine(message) {
  if (!message) return null;
  return String(message).split('\n')[0].slice(0, 200);
}

/** Fire-and-forget admin alert through the admin email bucket. Never throws. */
function alertAdmin(to, kind, facts) {
  if (!to) return;
  Promise.resolve()
    .then(() => mailer.sendAdminSecurityAlert(to, { kind, facts }))
    .catch((err) => console.error(`[Admin] ${kind} alert email failed:`, err.message));
}

function requestFacts(req, when = new Date()) {
  return {
    time: when.toISOString(),
    ip: req.ip || 'unknown',
    'user agent': String(req.get('user-agent') || 'unknown').slice(0, 300),
  };
}

/**
 * Count one wrong password against an admin, and lock at the threshold.
 *
 * Shared by login and step-up: a hijacked session must not be able to guess
 * the password through the step-up endpoint any faster than a stranger can
 * through login.
 *
 * Returns true when THIS failure locked the account.
 */
async function registerFailure(admin, req, source) {
  const now = new Date();

  // A lock that has run out starts the count afresh.
  if (admin.lockedUntil && admin.lockedUntil <= now) {
    await prisma.adminUser.update({ where: { id: admin.id }, data: { failedAttempts: 0, lockedUntil: null } });
  }

  const { failedAttempts } = await prisma.adminUser.update({
    where: { id: admin.id },
    data: { failedAttempts: { increment: 1 } },
    select: { failedAttempts: true },
  });

  if (failedAttempts < ADMIN_LOCK_AFTER_FAILURES) return false;

  // Conditional, so two concurrent failures produce ONE lock, one audit row
  // and one email.
  const lockedUntil = new Date(now.getTime() + ADMIN_LOCK_MS);
  const locked = await prisma.adminUser.updateMany({
    where: { id: admin.id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { lockedUntil },
  });
  if (locked.count !== 1) return false;

  await recordAdminAudit(req, {
    action: 'ADMIN_LOCKOUT',
    adminId: admin.id,
    targetType: 'ADMIN_USER',
    targetId: admin.id,
    after: { lockedUntil: lockedUntil.toISOString(), failedAttempts, source },
  });
  // A lock ends every live session too: if the guesses came through step-up,
  // the session doing the guessing is the one to cut.
  await destroyAdminSessions(admin.id).catch((err) =>
    console.error('[Admin] Could not clear sessions on lockout:', err.message)
  );
  alertAdmin(admin.email, 'lockout', { ...requestFacts(req, now), 'locked until': lockedUntil.toISOString() });
  return true;
}

// ============================================
// 1. PUBLIC — sign in
// ============================================

// POST /api/admin/login — { email, password }
//
// Every failure answers identically (status, body, and — via
// burnEquivalentWork — timing), whether the address is unknown, the password
// is wrong, or the account is locked. The real admin learns about a lockout
// from the alert email, not from this response.
router.post('/login', adminOriginGuard, adminLoginIpLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }
  if (password.length > ADMIN_MAX_PASSWORD_LENGTH) {
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }

  const normalizedEmail = email.trim().toLowerCase().slice(0, 254);
  const failAudit = (adminId, why) =>
    recordAdminAudit(req, {
      action: 'ADMIN_LOGIN_FAILURE',
      adminId,
      targetType: 'ADMIN_USER',
      targetId: adminId,
      after: { email: normalizedEmail, why },
    });

  try {
    const admin = await prisma.adminUser.findUnique({ where: { email: normalizedEmail } });
    const now = new Date();

    if (!admin) {
      await burnEquivalentWork(password);
      await failAudit(null, 'unknown_email');
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    if (admin.lockedUntil && admin.lockedUntil > now) {
      await burnEquivalentWork(password);
      await failAudit(admin.id, 'locked');
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const { valid, needsRehash } = await verifyPassword(password, admin.passwordHash);
    if (!valid) {
      await failAudit(admin.id, 'wrong_password');
      await registerFailure(admin, req, 'login');
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
        lastLoginIp: req.ip || null,
        ...(needsRehash ? { passwordHash: await hashPassword(password) } : {}),
      },
    });

    // A FRESH session id (lib/session.js). The admin cookie is its own jar, so
    // there is nothing to carry across from any customer login.
    await startAuthenticatedSession(req, {
      adminId: admin.id,
      authenticatedAt: now.getTime(),
      lastActivityAt: now.getTime(),
      pwdAt: admin.passwordChangedAt.getTime(),
    });

    await recordAdminAudit(req, {
      action: 'ADMIN_LOGIN_SUCCESS',
      adminId: admin.id,
      targetType: 'ADMIN_USER',
      targetId: admin.id,
    });
    alertAdmin(admin.email, 'login', requestFacts(req, now));

    return res.json({ authenticated: true, email: admin.email, ...sessionDeadlines(req.session) });
  } catch (error) {
    console.error('[Admin] Login error:', error.message);
    return res.status(500).json({ error: "Couldn't sign you in. Try again." });
  }
});

// ============================================
// 2. EVERYTHING BELOW REQUIRES AN ADMIN SESSION
// ============================================
router.use(requireAdmin);
router.use(adminOriginGuard);
router.use(trackAdminActivity);

// GET /api/admin/me — the session, for the UI. A GET: does not count as activity.
router.get('/me', (req, res) => {
  res.json({ authenticated: true, email: req.admin.email, ...sessionDeadlines(req.session) });
});

// POST /api/admin/activity — the UI's heartbeat on real clicks and keystrokes.
router.post('/activity', (req, res) => {
  res.json(sessionDeadlines(req.session));
});

// POST /api/admin/logout
router.post('/logout', async (req, res) => {
  await recordAdminAudit(req, { action: 'ADMIN_LOGOUT', targetType: 'ADMIN_USER', targetId: req.admin.id });
  req.session.destroy((err) => {
    if (err) console.error('[Admin] Error destroying session on logout:', err.message);
    res.clearCookie(ADMIN_COOKIE_NAME, { path: ADMIN_COOKIE_PATH });
    res.json({ success: true });
  });
});

// POST /api/admin/step-up — { password }. Opens a 5-minute window for
// destructive actions. Wrong passwords count toward the lockout.
router.post('/step-up', adminStepUpIpLimiter, async (req, res) => {
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || !password || password.length > ADMIN_MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'Enter your password.' });
  }
  try {
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.id } });
    const { valid } = await verifyPassword(password, admin.passwordHash);
    if (!valid) {
      await recordAdminAudit(req, { action: 'ADMIN_STEP_UP_FAILURE', targetType: 'ADMIN_USER', targetId: admin.id });
      const locked = await registerFailure(admin, req, 'step_up');
      if (locked) {
        return req.session.destroy(() => {
          res.clearCookie(ADMIN_COOKIE_NAME, { path: ADMIN_COOKIE_PATH });
          res.status(401).json({ error: 'Your admin session ended. Sign in again.', code: 'ADMIN_SESSION_EXPIRED' });
        });
      }
      return res.status(403).json({ error: 'That password is not right.', code: 'STEP_UP_FAILED' });
    }
    await prisma.adminUser.update({ where: { id: admin.id }, data: { failedAttempts: 0 } });
    req.session.stepUpAt = Date.now();
    await recordAdminAudit(req, { action: 'ADMIN_STEP_UP', targetType: 'ADMIN_USER', targetId: admin.id });
    return res.json(sessionDeadlines(req.session));
  } catch (error) {
    console.error('[Admin] Step-up error:', error.message);
    return res.status(500).json({ error: "Couldn't confirm your password. Try again." });
  }
});

// POST /api/admin/password — { currentPassword, newPassword }
// Keeps THIS session; every other admin session is ended.
router.post('/password', adminStepUpIpLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > ADMIN_MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: 'Enter your current password.' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < ADMIN_MIN_PASSWORD_LENGTH || newPassword.length > ADMIN_MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Use at least ${ADMIN_MIN_PASSWORD_LENGTH} characters for the new password.` });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'Choose a password different from the current one.' });
  }

  try {
    const admin = await prisma.adminUser.findUnique({ where: { id: req.admin.id } });
    const { valid } = await verifyPassword(currentPassword, admin.passwordHash);
    if (!valid) {
      await recordAdminAudit(req, { action: 'ADMIN_PASSWORD_CHANGE_FAILURE', targetType: 'ADMIN_USER', targetId: admin.id });
      const locked = await registerFailure(admin, req, 'password_change');
      if (locked) {
        return req.session.destroy(() => {
          res.clearCookie(ADMIN_COOKIE_NAME, { path: ADMIN_COOKIE_PATH });
          res.status(401).json({ error: 'Your admin session ended. Sign in again.', code: 'ADMIN_SESSION_EXPIRED' });
        });
      }
      return res.status(403).json({ error: 'That current password is not right.' });
    }

    const changedAt = new Date();
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: changedAt, failedAttempts: 0, lockedUntil: null },
    });

    // This session survives; its snapshot moves to the new value. Every other
    // session now mismatches in requireAdmin, and is also deleted outright.
    req.session.pwdAt = changedAt.getTime();
    const ended = await destroyAdminSessions(admin.id, { exceptSid: req.sessionID }).catch((err) => {
      console.error('[Admin] Could not clear other sessions after password change:', err.message);
      return 0;
    });

    await recordAdminAudit(req, {
      action: 'ADMIN_PASSWORD_CHANGE',
      targetType: 'ADMIN_USER',
      targetId: admin.id,
      after: { otherSessionsEnded: Number(ended) || 0 },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('[Admin] Password change error:', error.message);
    return res.status(500).json({ error: "Couldn't change your password. Try again." });
  }
});

// ============================================
// 3. OVERVIEW
// ============================================

// GET /api/admin/stats — counts only.
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalAccounts,
      activeAccounts,
      messagesToday,
      messagesThisWeek,
      failedWebhooks24h,
      recentSignups,
      categoryBreakdown,
      totalBrandDeals,
      pendingAiMessages,
      failedAiMessages,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.instagramAccount.count(),
      prisma.instagramAccount.count({
        where: { tokenStatus: 'VALID', OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: now } }] },
      }),
      prisma.message.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.message.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.webhookLog.count({ where: { status: 'FAILED', createdAt: { gte: dayAgo } } }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          instagramAccounts: { select: { id: true, igUsername: true, igProfilePic: true } },
        },
      }),
      prisma.conversation.groupBy({ by: ['category'], _count: { id: true } }),
      prisma.brandDeal.count(),
      prisma.message.count({ where: { aiStatus: { in: ['pending', 'processing'] } } }),
      prisma.message.count({ where: { aiStatus: 'failed' } }),
    ]);

    const expiredAccounts = totalAccounts - activeAccounts;
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

    const { getJobSystem } = require('../lib/queue');
    res.json({
      totalUsers,
      totalAccounts,
      activeAccounts,
      expiredAccounts,
      messagesToday,
      messagesThisWeek,
      failedWebhooks24h,
      alerts,
      recentSignups,
      aiStats: getAIStats(),
      categoryBreakdown,
      totalBrandDeals,
      pendingAiMessages,
      failedAiMessages,
      queueMode: getJobSystem('ai-processing').mode,
    });
  } catch (error) {
    console.error('[Admin] Error fetching stats:', error.message);
    res.status(500).json({ error: "Couldn't load platform stats. Refresh to try again." });
  }
});

// ============================================
// 3b. HEALTH (Gate 3)
// ============================================

// GET /api/admin/health — process, DB, sockets, jobs, webhooks, AI, email,
// Instagram tokens, recent errors. A GET: the dashboard polls it every 30s
// and that must not count as admin activity (it does not).
router.get('/health', async (req, res) => {
  try {
    res.json(
      await collectHealth({
        aiConfig: () => aiService.activeAiConfig(),
        emailFailures: () => mailer.sendFailureStats(),
      })
    );
  } catch (error) {
    console.error('[Admin] Health error:', error.message);
    res.status(500).json({ error: "Couldn't load system health. Refresh to try again." });
  }
});

const aiTestLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Wait a minute before testing the AI provider again.',
});

// POST /api/admin/health/ai-test — one minimal call to the active provider.
// A fixed prompt with no customer data. Answers ok/latency/model or a safe
// error code — never the provider's error text. Audit-logged (it spends money).
router.post('/health/ai-test', aiTestLimiter, async (req, res) => {
  const started = Date.now();
  let result;
  try {
    const out = await aiService.callAIWithFailover({
      prompt: 'Reply with the single word OK.',
      isJson: false,
      timeout: 10000,
      jobType: 'admin_test',
    });
    result = { ok: true, provider: out.provider, model: out.model, latencyMs: Date.now() - started };
  } catch (err) {
    result = {
      ok: false,
      latencyMs: Date.now() - started,
      errorCode: err.code === 'NO_PROVIDERS_CONFIGURED' ? 'NO_PROVIDERS_CONFIGURED' : 'PROVIDER_FAILED',
    };
  }
  await recordAdminAudit(req, { action: 'AI_TEST', targetType: 'SYSTEM', after: result });
  res.status(result.ok ? 200 : 502).json(result);
});

// ============================================
// 4. CUSTOMERS
// ============================================

function userSearchWhere(search) {
  if (!search) return {};
  return {
    OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { instagramAccounts: { some: { igUsername: { contains: search, mode: 'insensitive' } } } },
    ],
  };
}

// GET /api/admin/users?search=&page=&limit=
router.get('/users', async (req, res) => {
  try {
    const search = str(req.query.search, 100);
    const page = clampInt(req.query.page, { min: 1, max: 100000, fallback: 1 });
    const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 10 });
    const where = userSearchWhere(search);

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { ...USER_ADMIN_SELECT, instagramAccounts: { select: ACCOUNT_ADMIN_SELECT } },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) } });
  } catch (error) {
    console.error('[Admin] Error listing users:', error.message);
    res.status(500).json({ error: "Couldn't load customers. Refresh to try again." });
  }
});

// GET /api/admin/users/export/csv — bulk personal data, so step-up and audit.
router.get('/users/export/csv', requireStepUp, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, isSuspended: true, createdAt: true, instagramAccounts: { select: { igUsername: true } } },
    });

    let csv = csvRow(['User ID', 'Name', 'Email', 'Suspended', 'Connected accounts', 'Created at']);
    for (const u of users) {
      csv += csvRow([u.id, u.name, u.email, u.isSuspended, u.instagramAccounts.map((a) => a.igUsername).join('; '), u.createdAt]);
    }

    await recordAdminAudit(req, { action: 'DATA_EXPORT', targetType: 'USER', after: { rows: users.length, export: 'users_csv' } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=siffty_users.csv');
    res.status(200).send(csv);
  } catch (error) {
    console.error('[Admin] Users CSV export failed:', error.message);
    res.status(500).json({ error: "Couldn't export that CSV. Try again." });
  }
});

// GET /api/admin/users/:id
router.get('/users/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { ...USER_ADMIN_SELECT, instagramAccounts: { select: ACCOUNT_ADMIN_SELECT } },
    });
    if (!user) return res.status(404).json({ error: 'That customer no longer exists.' });
    res.json(user);
  } catch (error) {
    console.error('[Admin] Error fetching user detail:', error.message);
    res.status(500).json({ error: "Couldn't load that customer. Try again." });
  }
});

// POST /api/admin/users/:id/suspend — { suspend: boolean, reason }
//
// Suspending ends the customer's sessions and live sockets at once, rather
// than waiting for requireAuth to notice on their next request.
router.post('/users/:id/suspend', async (req, res) => {
  const suspend = req.body && req.body.suspend;
  if (typeof suspend !== 'boolean') {
    return res.status(400).json({ error: 'Say whether to suspend (true) or restore (false).' });
  }
  const reason = readReason(req, res);
  if (!reason) return undefined;

  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, isSuspended: true } });
    if (!existing) return res.status(404).json({ error: 'That customer no longer exists.' });

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: {
          isSuspended: suspend,
          // Bumping sessionVersion invalidates every session in requireAuth
          // regardless of store; destroyUserSessions below removes the rows.
          ...(suspend ? { sessionVersion: { increment: 1 } } : {}),
        },
        select: USER_ADMIN_SELECT,
      }),
      prisma.adminAuditLog.create({
        data: buildAuditRow(req, {
          action: suspend ? 'USER_SUSPEND' : 'USER_UNSUSPEND',
          targetType: 'USER',
          targetId: existing.id,
          reason,
          before: { isSuspended: existing.isSuspended },
          after: { isSuspended: suspend },
        }),
      }),
    ]);

    if (suspend) {
      await destroyUserSessions(existing.id).catch((err) =>
        console.error('[Admin] Could not clear sessions for suspended user:', err.message)
      );
      disconnectUserSockets(existing.id);
    }

    res.json({ message: suspend ? 'Customer suspended' : 'Customer restored', user: updated });
  } catch (error) {
    console.error('[Admin] Error changing suspension:', error.message);
    res.status(500).json({ error: "Couldn't change that customer's status. Try again." });
  }
});

// ============================================
// 5. INSTAGRAM ACCOUNTS
// ============================================

const TOKEN_STATUSES = new Set(['VALID', 'EXPIRED', 'NEEDS_RECONNECT']);

// GET /api/admin/accounts?search=&status=
router.get('/accounts', async (req, res) => {
  try {
    const search = str(req.query.search, 100);
    const status = str(req.query.status, 30);
    const where = {};
    if (search) {
      where.OR = [
        { igUsername: { contains: search, mode: 'insensitive' } },
        { igName: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (TOKEN_STATUSES.has(status)) where.tokenStatus = status;

    const accounts = await prisma.instagramAccount.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        ...ACCOUNT_ADMIN_SELECT,
        updatedAt: true,
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { conversations: true, contacts: true } },
      },
    });
    res.json(accounts);
  } catch (error) {
    console.error('[Admin] Error listing accounts:', error.message);
    res.status(500).json({ error: "Couldn't load connected accounts. Refresh to try again." });
  }
});

// GET /api/admin/accounts/export/csv — step-up and audit, like the users export.
router.get('/accounts/export/csv', requireStepUp, async (req, res) => {
  try {
    const accounts = await prisma.instagramAccount.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        igUsername: true,
        igUserId: true,
        tokenStatus: true,
        tokenExpiresAt: true,
        lastWebhookAt: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        _count: { select: { conversations: true } },
      },
    });

    let csv = csvRow(['Account ID', 'IG username', 'IG user ID', 'Owner', 'Token status', 'Token expires at', 'Last webhook at', 'Conversations', 'Created at']);
    for (const a of accounts) {
      csv += csvRow([
        a.id,
        a.igUsername,
        a.igUserId,
        a.user?.name || a.user?.email || '',
        a.tokenStatus,
        a.tokenExpiresAt || '',
        a.lastWebhookAt || '',
        a._count.conversations,
        a.createdAt,
      ]);
    }

    await recordAdminAudit(req, { action: 'DATA_EXPORT', targetType: 'INSTAGRAM_ACCOUNT', after: { rows: accounts.length, export: 'accounts_csv' } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=siffty_instagram_accounts.csv');
    res.status(200).send(csv);
  } catch (error) {
    console.error('[Admin] Accounts CSV export failed:', error.message);
    res.status(500).json({ error: "Couldn't export that CSV. Try again." });
  }
});

async function findAccountOr404(req, res) {
  const account = await prisma.instagramAccount.findUnique({ where: { id: req.params.id } });
  if (!account) {
    res.status(404).json({ error: 'That account no longer exists.' });
    return null;
  }
  return account;
}

// POST /api/admin/accounts/:id/refresh-token — { reason }
router.post('/accounts/:id/refresh-token', async (req, res) => {
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const account = await findAccountOr404(req, res);
    if (!account) return undefined;

    let refreshed;
    try {
      refreshed = await instagram.refreshLongLivedToken(readAccountToken(account));
    } catch (metaError) {
      // Logged server-side only. Meta's error text never reaches the browser.
      console.error('[Admin] Token refresh rejected by Meta:', metaError.message);
      const tokenDead = instagram.isTokenInvalidError(metaError);
      if (tokenDead) {
        await prisma.instagramAccount
          .update({ where: { id: account.id }, data: { tokenStatus: 'NEEDS_RECONNECT' } })
          .catch((e) => console.error('[Admin] Could not flag account:', e.message));
      }
      await recordAdminAudit(req, {
        action: 'TOKEN_REFRESH_FAILED',
        targetType: 'INSTAGRAM_ACCOUNT',
        targetId: account.id,
        reason,
        before: { tokenStatus: account.tokenStatus },
        after: { tokenStatus: tokenDead ? 'NEEDS_RECONNECT' : account.tokenStatus },
      });
      return res.status(502).json({
        error: tokenDead
          ? 'Meta rejected this token. The customer needs to reconnect.'
          : "Couldn't refresh access with Meta. Try again later.",
        code: tokenDead ? 'TOKEN_INVALID' : 'META_UNAVAILABLE',
      });
    }

    const tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    const updated = await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { ...writeAccountToken(refreshed.access_token), tokenExpiresAt, tokenStatus: 'VALID' },
      select: ACCOUNT_ADMIN_SELECT,
    });

    await recordAdminAudit(req, {
      action: 'TOKEN_REFRESH',
      targetType: 'INSTAGRAM_ACCOUNT',
      targetId: account.id,
      reason,
      before: { tokenStatus: account.tokenStatus, tokenExpiresAt: account.tokenExpiresAt },
      after: { tokenStatus: updated.tokenStatus, tokenExpiresAt: updated.tokenExpiresAt },
    });
    res.json({ message: 'Access refreshed', account: updated });
  } catch (error) {
    console.error('[Admin] Token refresh error:', error.message);
    res.status(500).json({ error: "Couldn't refresh that account. Try again." });
  }
});

// POST /api/admin/accounts/:id/resubscribe-webhook — { reason }
router.post('/accounts/:id/resubscribe-webhook', async (req, res) => {
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const account = await findAccountOr404(req, res);
    if (!account) return undefined;

    try {
      await instagram.subscribeToWebhooks(account.igUserId, readAccountToken(account));
    } catch (metaError) {
      console.error('[Admin] Webhook resubscribe rejected by Meta:', metaError.message);
      await recordAdminAudit(req, { action: 'WEBHOOK_RESUBSCRIBE_FAILED', targetType: 'INSTAGRAM_ACCOUNT', targetId: account.id, reason });
      return res.status(502).json({ error: "Couldn't resubscribe with Meta. Try again later.", code: 'META_UNAVAILABLE' });
    }

    await recordAdminAudit(req, { action: 'WEBHOOK_RESUBSCRIBE', targetType: 'INSTAGRAM_ACCOUNT', targetId: account.id, reason });
    res.json({ message: `Resubscribed webhooks for @${account.igUsername || account.igUserId}` });
  } catch (error) {
    console.error('[Admin] Webhook resubscribe error:', error.message);
    res.status(500).json({ error: "Couldn't resubscribe that account. Try again." });
  }
});

// POST /api/admin/accounts/:id/mark-needs-reconnect — { reason }
router.post('/accounts/:id/mark-needs-reconnect', async (req, res) => {
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const account = await findAccountOr404(req, res);
    if (!account) return undefined;

    const [updated] = await prisma.$transaction([
      prisma.instagramAccount.update({
        where: { id: account.id },
        data: { tokenStatus: 'NEEDS_RECONNECT' },
        // Safe fields only — never the token columns.
        select: ACCOUNT_ADMIN_SELECT,
      }),
      prisma.adminAuditLog.create({
        data: buildAuditRow(req, {
          action: 'ACCOUNT_MARK_NEEDS_RECONNECT',
          targetType: 'INSTAGRAM_ACCOUNT',
          targetId: account.id,
          reason,
          before: { tokenStatus: account.tokenStatus },
          after: { tokenStatus: 'NEEDS_RECONNECT' },
        }),
      }),
    ]);
    res.json({ message: 'Account marked as needing reconnection', account: updated });
  } catch (error) {
    console.error('[Admin] Mark needs-reconnect error:', error.message);
    res.status(500).json({ error: "Couldn't update that account. Try again." });
  }
});

// ============================================
// 6. LOGS — metadata only
// ============================================

const WEBHOOK_STATUSES = new Set(['SUCCESS', 'FAILED', 'SKIPPED']);

// GET /api/admin/logs/webhooks?limit=&status=
// Never returns `payload`: it holds the customer's message text.
router.get('/logs/webhooks', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 50 });
    const status = str(req.query.status, 20);
    const logs = await prisma.webhookLog.findMany({
      where: WEBHOOK_STATUSES.has(status) ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        instagramAccountId: true,
        igUserId: true,
        eventType: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        instagramAccount: { select: { igUsername: true } },
      },
    });
    res.json(logs.map((l) => ({ ...l, errorMessage: safeErrorLine(l.errorMessage) })));
  } catch (error) {
    console.error('[Admin] Error fetching webhook logs:', error.message);
    res.status(500).json({ error: "Couldn't load delivery logs. Refresh to try again." });
  }
});

// POST /api/admin/logs/prune — { days: 7..365, reason }. Step-up.
router.post('/logs/prune', requireStepUp, async (req, res) => {
  const days = req.body && req.body.days;
  if (!Number.isInteger(days) || days < 7 || days > 365) {
    return res.status(400).json({ error: 'Days must be a whole number from 7 to 365.' });
  }
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deleted = await prisma.webhookLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    await recordAdminAudit(req, {
      action: 'LOG_PRUNE',
      targetType: 'SYSTEM',
      reason,
      after: { retentionDays: days, deletedCount: deleted.count },
    });
    res.json({ message: `Removed ${deleted.count} delivery log(s) older than ${days} days.`, deletedCount: deleted.count });
  } catch (error) {
    console.error('[Admin] Log prune error:', error.message);
    res.status(500).json({ error: "Couldn't clear those logs. Try again." });
  }
});

// GET /api/admin/logs/audit?page=&limit=&action=
router.get('/logs/audit', async (req, res) => {
  try {
    const page = clampInt(req.query.page, { min: 1, max: 100000, fallback: 1 });
    const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 50 });
    const action = str(req.query.action, 60);
    const where = action ? { action } : {};
    const [logs, totalCount] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { admin: { select: { email: true } } },
      }),
      prisma.adminAuditLog.count({ where }),
    ]);
    res.json({ logs, pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) } });
  } catch (error) {
    console.error('[Admin] Error fetching audit log:', error.message);
    res.status(500).json({ error: "Couldn't load the audit log. Refresh to try again." });
  }
});

// ============================================
// 7. SUPPORT — metadata search only
// ============================================

// GET /api/admin/support/search?q=
router.get('/support/search', async (req, res) => {
  try {
    const q = str(req.query.q, 100);
    if (!q) return res.json({ users: [], accounts: [] });

    const [users, accounts] = await Promise.all([
      prisma.user.findMany({
        where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
        take: 5,
        select: {
          ...USER_ADMIN_SELECT,
          instagramAccounts: { select: { id: true, igUsername: true, igProfilePic: true, tokenStatus: true } },
        },
      }),
      prisma.instagramAccount.findMany({
        where: {
          OR: [
            { igUsername: { contains: q, mode: 'insensitive' } },
            { igName: { contains: q, mode: 'insensitive' } },
            { igUserId: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: { ...ACCOUNT_ADMIN_SELECT, user: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    res.json({ users, accounts });
  } catch (error) {
    console.error('[Admin] Support search error:', error.message);
    res.status(500).json({ error: "Couldn't run that search. Try again." });
  }
});

// ============================================
// 8. SETTINGS
// ============================================

// GET /api/admin/settings
router.get('/settings', async (req, res) => {
  try {
    const admins = await prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, lastLoginAt: true, passwordChangedAt: true, createdAt: true },
    });
    res.json({
      admins,
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
      },
    });
  } catch (error) {
    console.error('[Admin] Settings error:', error.message);
    res.status(500).json({ error: "Couldn't load server configuration. Refresh to try again." });
  }
});

// ============================================
// 9. BILLING — REFUNDS
//
// Admin-initiated only. The refund policy is REPORTED with the usage numbers
// it was decided on, never a hard refusal: an ineligible refund needs
// overridePolicy: true and an overrideReason. See services/refundService.js.
// Initiating one moves money, so it needs step-up.
// ============================================

function sendRefundError(res, error, fallback) {
  if (error.status && error.body) return res.status(error.status).json(error.body);
  console.error(`[Admin] ${fallback}:`, error.message);
  return res.status(500).json({ error: `${fallback}. Try again.` });
}

// GET /api/admin/billing/orders/:cashfreeOrderId/refund-eligibility
router.get('/billing/orders/:cashfreeOrderId/refund-eligibility', async (req, res) => {
  try {
    res.json(await refundService.getRefundEligibility(req.params.cashfreeOrderId));
  } catch (error) {
    sendRefundError(res, error, "Couldn't check that order's refund eligibility");
  }
});

// POST /api/admin/billing/orders/:cashfreeOrderId/refunds
// body: { amount?: integer (smallest unit), reason: string, overridePolicy?: boolean, overrideReason?: string }
router.post('/billing/orders/:cashfreeOrderId/refunds', requireStepUp, async (req, res) => {
  const { amount, reason, overridePolicy, overrideReason } = req.body || {};
  try {
    const result = await refundService.initiateRefund({
      cashfreeOrderId: req.params.cashfreeOrderId,
      amount: amount == null ? undefined : amount,
      reason,
      overridePolicy,
      overrideReason,
      initiatedBy: req.admin.id,
    });

    await recordAdminAudit(req, {
      action: 'BILLING_REFUND_INITIATE',
      targetType: 'ORDER',
      targetId: req.params.cashfreeOrderId,
      reason: typeof reason === 'string' ? reason : null,
      after: {
        refundId: result.refund.refundId,
        amount: result.refund.amount,
        status: result.refund.status,
        overridePolicy: result.refund.overridePolicy,
        eligible: result.policy.eligible,
      },
    });
    res.status(201).json(result);
  } catch (error) {
    sendRefundError(res, error, "Couldn't start that refund");
  }
});

// POST /api/admin/billing/refunds/:refundId/sync — re-read a refund from Cashfree
router.post('/billing/refunds/:refundId/sync', async (req, res) => {
  try {
    const result = await refundService.syncRefund(req.params.refundId);
    await recordAdminAudit(req, {
      action: 'BILLING_REFUND_SYNC',
      targetType: 'REFUND',
      targetId: req.params.refundId,
      after: { outcome: result.outcome },
    });
    res.json(result);
  } catch (error) {
    sendRefundError(res, error, "Couldn't re-sync that refund");
  }
});

module.exports = router;
// Exposed for tests.
module.exports.csvCell = csvCell;
