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
const { readAccountToken } = require('../lib/crypto');
const { refreshAccountToken } = require('../lib/tokenRefresh');
const aiService = require('../services/aiService');
const { getAIStats } = aiService;
const { collectHealth } = require('../lib/health');
const aiRouter = require('../lib/ai/router');
const aiModels = require('../lib/ai/models');
const { runModelTest, findPassingTest } = require('../lib/ai/modelTest');
const { deleteUserAccount } = require('../services/accountDeletion');
const adminBilling = require('../services/adminBilling');
const coupons = require('../services/coupons');
const settings = require('../lib/settings');
const { effectiveStatus } = require('../services/entitlementService');
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
// 3c. AI PROVIDER (Gate 4)
//
// Security-first: provider + model ONLY from the code allowlist
// (lib/ai/models.js); keys ONLY from environment variables — no endpoint
// accepts, stores or returns one; no base URL or free-text model anywhere.
// Request bodies are checked field by field: an unexpected field (a
// "baseUrl", an "apiKey") is a 400, not silently ignored.
// ============================================

/** Refuse any body field outside `allowed`. */
function onlyFields(req, res, allowed) {
  const extra = Object.keys(req.body || {}).filter((k) => !allowed.includes(k));
  if (extra.length) {
    res.status(400).json({ error: 'Unexpected field in the request.', code: 'UNEXPECTED_FIELD' });
    return false;
  }
  return true;
}

function allowedTarget(provider, model) {
  return aiModels.isAllowed(provider, model) ? { provider, model } : null;
}

// GET /api/admin/ai/config — current choice, fallback state, the allowlist
// with "key configured: yes/no". Never a key.
router.get('/ai/config', async (req, res) => {
  try {
    const config = await aiRouter.getAiConfig({ fresh: true });
    let updatedByEmail = null;
    if (config.updatedBy) {
      const who = await prisma.adminUser.findUnique({ where: { id: config.updatedBy }, select: { email: true } });
      updatedByEmail = who ? who.email : null;
    }
    res.json({
      active: config.active,
      fallback: config.fallback,
      fallbackEnabled: config.fallbackEnabled,
      previous: config.previous,
      isDefault: config.isDefault,
      updatedAt: config.updatedAt,
      updatedBy: updatedByEmail,
      fallbackState: aiRouter.fallbackState(),
      providers: aiModels.catalogue(),
    });
  } catch (error) {
    console.error('[Admin] AI config error:', error.message);
    res.status(500).json({ error: "Couldn't load the AI settings. Refresh to try again." });
  }
});

const aiModelTestLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Wait a few minutes before running another model test.',
});

// POST /api/admin/ai/test — { provider, model }: the 10 synthetic samples.
router.post('/ai/test', aiModelTestLimiter, async (req, res) => {
  if (!onlyFields(req, res, ['provider', 'model'])) return undefined;
  const target = allowedTarget(req.body.provider, req.body.model);
  if (!target) return res.status(400).json({ error: 'Pick a provider and model from the list.', code: 'NOT_ALLOWED' });
  if (!aiModels.keyConfigured(target.provider)) {
    return res.status(400).json({ error: 'That provider has no API key configured.', code: 'NOT_CONFIGURED' });
  }
  try {
    res.json(await runModelTest({ ...target, adminId: req.admin.id, req }));
  } catch (error) {
    console.error('[Admin] AI model test error:', error.message);
    res.status(500).json({ error: "Couldn't run the model test. Try again." });
  }
});

// POST /api/admin/ai/activate — step-up + reason + a PASSING test run.
// body: { provider, model, testRunId, fallbackEnabled?, fallbackProvider?,
//         fallbackModel?, fallbackTestRunId?, reason }
router.post('/ai/activate', requireStepUp, async (req, res) => {
  const fields = ['provider', 'model', 'testRunId', 'fallbackEnabled', 'fallbackProvider', 'fallbackModel', 'fallbackTestRunId', 'reason'];
  if (!onlyFields(req, res, fields)) return undefined;
  const reason = readReason(req, res);
  if (!reason) return undefined;
  const b = req.body;

  const target = allowedTarget(b.provider, b.model);
  if (!target) return res.status(400).json({ error: 'Pick a provider and model from the list.', code: 'NOT_ALLOWED' });
  if (!aiModels.keyConfigured(target.provider)) {
    return res.status(400).json({ error: 'That provider has no API key configured.', code: 'NOT_CONFIGURED' });
  }
  if (b.fallbackEnabled !== undefined && typeof b.fallbackEnabled !== 'boolean') {
    return res.status(400).json({ error: 'fallbackEnabled must be true or false.' });
  }

  let fallback = null;
  if (b.fallbackProvider !== undefined || b.fallbackModel !== undefined) {
    fallback = allowedTarget(b.fallbackProvider, b.fallbackModel);
    if (!fallback) return res.status(400).json({ error: 'Pick the fallback from the list.', code: 'NOT_ALLOWED' });
  }
  if (b.fallbackEnabled && !fallback) return res.status(400).json({ error: 'Choose a fallback model to enable fallback.' });

  try {
    if (!(await findPassingTest(b.testRunId, target))) {
      return res.status(409).json({
        error: 'Run the model test first. It must pass on all 10 samples, for this exact model, in the last 30 minutes.',
        code: 'TEST_REQUIRED',
      });
    }
    if (b.fallbackEnabled) {
      if (!aiModels.keyConfigured(fallback.provider)) {
        return res.status(400).json({ error: 'The fallback provider has no API key configured.', code: 'NOT_CONFIGURED' });
      }
      if (!(await findPassingTest(b.fallbackTestRunId, fallback))) {
        return res.status(409).json({ error: 'The fallback model needs a passing test too.', code: 'TEST_REQUIRED' });
      }
    }

    const before = await aiRouter.getAiConfig({ fresh: true });
    const data = {
      activeProvider: target.provider,
      activeModel: target.model,
      fallbackProvider: fallback ? fallback.provider : null,
      fallbackModel: fallback ? fallback.model : null,
      fallbackEnabled: Boolean(b.fallbackEnabled),
      previousProvider: before.active.provider,
      previousModel: before.active.model,
      updatedBy: req.admin.id,
    };
    await prisma.$transaction([
      prisma.aiConfig.upsert({ where: { id: 'active' }, create: { id: 'active', ...data }, update: data }),
      prisma.adminAuditLog.create({
        data: buildAuditRow(req, {
          action: 'AI_PROVIDER_ACTIVATE',
          targetType: 'AI_CONFIG',
          targetId: 'active',
          reason,
          before: { active: before.active, fallback: before.fallback, fallbackEnabled: before.fallbackEnabled },
          after: { active: target, fallback, fallbackEnabled: Boolean(b.fallbackEnabled), testRunId: b.testRunId },
        }),
      }),
    ]);
    aiRouter.clearAiConfigCache();
    aiRouter._resetRouterState();
    res.json({ success: true, active: target, fallback, fallbackEnabled: Boolean(b.fallbackEnabled) });
  } catch (error) {
    console.error('[Admin] AI activate error:', error.message);
    res.status(500).json({ error: "Couldn't switch the AI model. Try again." });
  }
});

// POST /api/admin/ai/rollback — { reason }: back to the previous model. Step-up.
router.post('/ai/rollback', requireStepUp, async (req, res) => {
  if (!onlyFields(req, res, ['reason'])) return undefined;
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const current = await aiRouter.getAiConfig({ fresh: true });
    if (!current.previous) return res.status(409).json({ error: 'There is no previous model to go back to.', code: 'NO_PREVIOUS' });
    if (!aiModels.keyConfigured(current.previous.provider)) {
      return res.status(400).json({ error: 'The previous provider no longer has an API key configured.', code: 'NOT_CONFIGURED' });
    }
    const data = {
      activeProvider: current.previous.provider,
      activeModel: current.previous.model,
      previousProvider: current.active.provider,
      previousModel: current.active.model,
      updatedBy: req.admin.id,
    };
    await prisma.$transaction([
      prisma.aiConfig.update({ where: { id: 'active' }, data }),
      prisma.adminAuditLog.create({
        data: buildAuditRow(req, {
          action: 'AI_PROVIDER_ROLLBACK',
          targetType: 'AI_CONFIG',
          targetId: 'active',
          reason,
          before: { active: current.active },
          after: { active: current.previous },
        }),
      }),
    ]);
    aiRouter.clearAiConfigCache();
    aiRouter._resetRouterState();
    res.json({ success: true, active: current.previous });
  } catch (error) {
    console.error('[Admin] AI rollback error:', error.message);
    res.status(500).json({ error: "Couldn't roll back the AI model. Try again." });
  }
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

const PLAN_FILTERS = new Set(['NONE', 'TRIAL', 'STARTER', 'PRO', 'ENTERPRISE']);
const STATUS_FILTERS = new Set(['active', 'suspended']);

function parseDay(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Where-clause for the users list: search + plan + status + signup dates. */
function userListWhere(q) {
  const and = [];
  const search = str(q.search, 100);
  if (search) and.push(userSearchWhere(search));

  const plan = str(q.plan, 20).toUpperCase();
  if (PLAN_FILTERS.has(plan)) {
    and.push(
      plan === 'NONE'
        ? { OR: [{ entitlement: null }, { entitlement: { status: 'NONE' } }] }
        : { entitlement: { planCode: plan, status: { not: 'NONE' } } }
    );
  }

  const status = str(q.status, 20).toLowerCase();
  if (STATUS_FILTERS.has(status)) and.push({ isSuspended: status === 'suspended' });

  const from = parseDay(q.signedUpFrom);
  const to = parseDay(q.signedUpTo);
  if (from || to) {
    and.push({
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: new Date(to.getTime() + 24 * 60 * 60 * 1000) } : {}),
      },
    });
  }
  return and.length ? { AND: and } : {};
}

const ENTITLEMENT_SUMMARY_SELECT = { planCode: true, status: true, validUntil: true, graceUntil: true };
const planSummary = (e) =>
  e ? { planCode: e.planCode, status: effectiveStatus(e), validUntil: e.validUntil } : { planCode: null, status: 'NONE', validUntil: null };

// GET /api/admin/users?search=&plan=&status=&signedUpFrom=YYYY-MM-DD&signedUpTo=YYYY-MM-DD&page=&limit=
router.get('/users', async (req, res) => {
  try {
    const page = clampInt(req.query.page, { min: 1, max: 100000, fallback: 1 });
    const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 10 });
    const where = userListWhere(req.query);

    const [rows, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          ...USER_ADMIN_SELECT,
          instagramAccounts: { select: ACCOUNT_ADMIN_SELECT },
          entitlement: { select: ENTITLEMENT_SUMMARY_SELECT },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const users = rows.map(({ entitlement, ...u }) => ({ ...u, plan: planSummary(entitlement) }));
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

// GET /api/admin/users/:id — profile, plan + quota, connected accounts,
// classification counts, last active, recent AI errors. Counts and metadata
// only: no message text, no AI summaries, no tokens.
router.get('/users/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        ...USER_ADMIN_SELECT,
        instagramAccounts: { select: { ...ACCOUNT_ADMIN_SELECT, disconnectedAt: true, tokenRefreshedAt: true, tokenRefreshError: true } },
        entitlement: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'That customer no longer exists.' });

    const { entitlement, ...profile } = user;
    const accountIds = user.instagramAccounts.map((a) => a.id);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const byConversation = { conversation: { instagramAccountId: { in: accountIds } } };

    const [plan, analysesTotal, analyses30d, messageStatus, aiErrors] = await Promise.all([
      entitlement?.planCode ? prisma.plan.findUnique({ where: { code: entitlement.planCode } }) : null,
      prisma.aIAnalysis.count({ where: byConversation }),
      prisma.aIAnalysis.count({ where: { ...byConversation, createdAt: { gte: monthAgo } } }),
      prisma.message.groupBy({ by: ['aiStatus'], where: { ...byConversation, direction: 'inbound' }, _count: { _all: true } }),
      prisma.aiCallLog.findMany({
        where: { tenantId: user.id, success: false },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { provider: true, model: true, jobType: true, errorCode: true, httpStatus: true, createdAt: true },
      }),
    ]);

    const cap = plan?.classificationCapCycle ?? null;
    const used = entitlement?.classificationCountCycle ?? 0;
    res.json({
      ...profile,
      plan: {
        ...planSummary(entitlement),
        graceUntil: entitlement?.graceUntil ?? null,
        cycleStartedAt: entitlement?.cycleStartedAt ?? null,
        billingRegion: entitlement?.billingRegion ?? null,
      },
      quota: {
        classificationsUsedThisCycle: used,
        classificationCapPerCycle: cap,
        classificationsRemaining: cap == null ? null : Math.max(0, cap - used),
        replyCreditsCurrent: entitlement?.replyCreditsCurrent ?? 0,
        replyCreditsBanked: entitlement?.replyCreditsBanked ?? 0,
      },
      classifications: {
        total: analysesTotal,
        last30Days: analyses30d,
        inboundByStatus: Object.fromEntries(messageStatus.map((r) => [r.aiStatus, r._count._all])),
      },
      lastActiveAt: profile.lastSeenAt,
      recentAiErrors: aiErrors,
    });
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

// POST /api/admin/users/:id/logout — { reason }: end every session and
// socket of this customer now. They can sign straight back in.
router.post('/users/:id/logout', async (req, res) => {
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'That customer no longer exists.' });

    await prisma.$transaction([
      // sessionVersion ends sessions in requireAuth whatever the store.
      prisma.user.update({ where: { id: existing.id }, data: { sessionVersion: { increment: 1 } } }),
      prisma.adminAuditLog.create({
        data: buildAuditRow(req, { action: 'USER_FORCE_LOGOUT', targetType: 'USER', targetId: existing.id, reason }),
      }),
    ]);
    const ended = await destroyUserSessions(existing.id).catch((err) => {
      console.error('[Admin] Could not clear sessions on force logout:', err.message);
      return 0;
    });
    disconnectUserSockets(existing.id);
    res.json({ message: 'Customer signed out everywhere', sessionsEnded: Number(ended) || 0 });
  } catch (error) {
    console.error('[Admin] Force logout error:', error.message);
    res.status(500).json({ error: "Couldn't sign that customer out. Try again." });
  }
});

// DELETE /api/admin/users/:id — { reason }: permanent, through the one
// deletion path (services/accountDeletion.js). Step-up. The audit row keeps
// the id and counts only, not the deleted person's email or name.
router.delete('/users/:id', requireStepUp, async (req, res) => {
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, createdAt: true } });
    if (!existing) return res.status(404).json({ error: 'That customer no longer exists.' });

    const result = await deleteUserAccount(existing.id);
    await recordAdminAudit(req, {
      action: 'USER_DELETE',
      targetType: 'USER',
      targetId: existing.id,
      reason,
      before: { exists: true, createdAt: existing.createdAt, instagramAccounts: result.instagramAccounts },
      after: { deleted: result.deleted },
    });
    res.json({ message: 'Customer deleted', deleted: result.deleted });
  } catch (error) {
    console.error('[Admin] Delete user error:', error.message);
    res.status(500).json({ error: "Couldn't delete that customer. Try again." });
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

    // The same refresh the daily job runs (lib/tokenRefresh.js): it stores
    // the new token encrypted, records failures as a safe code, and marks a
    // dead token NEEDS_RECONNECT. Meta's error text never reaches the browser.
    const result = await refreshAccountToken(account);
    if (!result.ok) {
      await recordAdminAudit(req, {
        action: 'TOKEN_REFRESH_FAILED',
        targetType: 'INSTAGRAM_ACCOUNT',
        targetId: account.id,
        reason,
        before: { tokenStatus: account.tokenStatus },
        after: { tokenStatus: result.tokenDead ? 'NEEDS_RECONNECT' : account.tokenStatus, errorCode: result.errorCode },
      });
      return res.status(502).json({
        error: result.tokenDead
          ? 'Meta rejected this token. The customer needs to reconnect.'
          : "Couldn't refresh access with Meta. Try again later.",
        code: result.tokenDead ? 'TOKEN_INVALID' : 'META_UNAVAILABLE',
      });
    }

    const updated = await prisma.instagramAccount.findUnique({ where: { id: account.id }, select: ACCOUNT_ADMIN_SELECT });

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
// 6. PLANS, PER-CUSTOMER PLAN CONTROLS, COUPONS, PAYMENTS (Gate 6)
//
// Plans live in billing_plans + plan_prices (extended, not replaced). An edit
// applies to NEW purchases only: every grant snapshots the plan's limits onto
// the customer's entitlement (entitlementService termsFrom), so existing
// customers keep what they bought. Changing plans and per-customer grants need
// step-up + a reason; every change is audited.
// ============================================

const PLAN_INT_FIELDS = ['igAccountLimit', 'autoReplyCreditsPerCycle', 'autoReplyBankCap', 'classificationCapCycle', 'classificationThrottlePerHour'];
const REGION_CURRENCY = { IN: 'INR', INTL: 'USD' };

function badRequest(res, error, code = 'INVALID') {
  res.status(400).json({ error, code });
  return null;
}

/** Validate a plan body. Returns { data, prices } or null (response already sent). */
function readPlanBody(req, res, { creating }) {
  const b = req.body || {};
  const allowed = ['name', 'cycleLengthDays', 'isActive', 'isQuoteOnly', 'features', 'prices', 'reason', ...PLAN_INT_FIELDS, ...(creating ? ['code'] : [])];
  if (!onlyFields(req, res, allowed)) return null;
  const data = {};

  if (creating) {
    if (typeof b.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,30}$/.test(b.code)) return badRequest(res, 'Plan code: capital letters, digits and _ (2 to 31 characters).');
    data.code = b.code;
  }
  if (b.name !== undefined || creating) {
    if (typeof b.name !== 'string' || b.name.trim().length < 2 || b.name.length > 60) return badRequest(res, 'Name: 2 to 60 characters.');
    data.name = b.name.trim();
  }
  for (const f of PLAN_INT_FIELDS) {
    if (b[f] === undefined) continue;
    if (b[f] !== null && !(Number.isInteger(b[f]) && b[f] >= 0 && b[f] <= 10000000)) return badRequest(res, `${f} must be a whole number (or empty for no limit).`);
    data[f] = b[f];
  }
  if (b.cycleLengthDays !== undefined) {
    if (!Number.isInteger(b.cycleLengthDays) || b.cycleLengthDays < 1 || b.cycleLengthDays > 366) return badRequest(res, 'Cycle length: 1 to 366 days.');
    data.cycleLengthDays = b.cycleLengthDays;
  }
  for (const f of ['isActive', 'isQuoteOnly']) {
    if (b[f] === undefined) continue;
    if (typeof b[f] !== 'boolean') return badRequest(res, `${f} must be true or false.`);
    data[f] = b[f];
  }
  // A new plan starts HIDDEN unless it says otherwise: the public pricing
  // endpoint lists every active plan, and a new code cannot be bought at
  // checkout (routes/billing.js PURCHASABLE_PLAN_CODES).
  if (creating && data.isActive === undefined) data.isActive = false;

  if (b.features !== undefined) {
    const f = b.features;
    if (f !== null && (typeof f !== 'object' || Array.isArray(f))) return badRequest(res, 'Features must be an object.');
    const entries = f ? Object.entries(f) : [];
    if (entries.length > 30) return badRequest(res, 'At most 30 features.');
    for (const [k, v] of entries) {
      if (!/^[a-z0-9_]{1,40}$/.test(k)) return badRequest(res, 'Feature names: lowercase letters, digits and _.');
      const okValue = typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 200);
      if (!okValue) return badRequest(res, 'Feature values: true/false, a number, or text up to 200 characters.');
    }
    data.features = f;
  }

  let prices;
  if (b.prices !== undefined) {
    if (!Array.isArray(b.prices) || b.prices.length > 2) return badRequest(res, 'Prices: a list of up to two regions.');
    const seen = new Set();
    prices = [];
    for (const p of b.prices) {
      if (!p || typeof p !== 'object') return badRequest(res, 'Each price needs billingRegion and amount.');
      const currency = REGION_CURRENCY[p.billingRegion];
      if (!currency || seen.has(p.billingRegion)) return badRequest(res, 'billingRegion must be IN or INTL, once each.');
      if (p.currency !== undefined && p.currency !== currency) return badRequest(res, `Region ${p.billingRegion} is priced in ${currency}.`);
      if (!Number.isInteger(p.amount) || p.amount < 1 || p.amount > 100000000) return badRequest(res, 'Amount: a whole number in the smallest unit (paise / cents).');
      seen.add(p.billingRegion);
      prices.push({ billingRegion: p.billingRegion, currency, amount: p.amount });
    }
  }
  return { data, prices };
}

const planWithPrices = { prices: { select: { billingRegion: true, currency: true, amount: true } } };

// GET /api/admin/plans
router.get('/plans', async (req, res) => {
  try {
    res.json(await prisma.plan.findMany({ orderBy: { createdAt: 'asc' }, include: planWithPrices }));
  } catch (error) {
    console.error('[Admin] Plans list error:', error.message);
    res.status(500).json({ error: "Couldn't load plans. Refresh to try again." });
  }
});

// POST /api/admin/plans — create. Step-up + reason. Starts hidden (isActive false) unless set.
router.post('/plans', requireStepUp, async (req, res) => {
  const parsed = readPlanBody(req, res, { creating: true });
  if (!parsed) return undefined;
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    if (await prisma.plan.findUnique({ where: { code: parsed.data.code } })) {
      return res.status(409).json({ error: 'A plan with that code already exists.', code: 'EXISTS' });
    }
    const created = await prisma.$transaction(async (tx) => {
      const plan = await tx.plan.create({ data: { ...parsed.data, ...(parsed.prices ? { prices: { create: parsed.prices } } : {}) }, include: planWithPrices });
      await tx.adminAuditLog.create({ data: buildAuditRow(req, { action: 'PLAN_CREATE', targetType: 'PLAN', targetId: plan.code, reason, after: plan }) });
      return plan;
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('[Admin] Plan create error:', error.message);
    res.status(500).json({ error: "Couldn't create that plan. Try again." });
  }
});

// PUT /api/admin/plans/:code — edit (new purchases only). Step-up + reason.
// `prices`, when given, replaces the plan's price list.
router.put('/plans/:code', requireStepUp, async (req, res) => {
  const parsed = readPlanBody(req, res, { creating: false });
  if (!parsed) return undefined;
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const before = await prisma.plan.findUnique({ where: { code: req.params.code }, include: planWithPrices });
    if (!before) return res.status(404).json({ error: 'That plan does not exist.' });
    if (before.code === 'TRIAL' && parsed.prices && parsed.prices.length) {
      return res.status(400).json({ error: 'The trial is free; it has no prices.', code: 'INVALID' });
    }
    const after = await prisma.$transaction(async (tx) => {
      if (parsed.prices) {
        await tx.planPrice.deleteMany({ where: { planId: before.id } });
        if (parsed.prices.length) await tx.planPrice.createMany({ data: parsed.prices.map((p) => ({ ...p, planId: before.id })) });
      }
      const plan = await tx.plan.update({ where: { id: before.id }, data: parsed.data, include: planWithPrices });
      await tx.adminAuditLog.create({ data: buildAuditRow(req, { action: 'PLAN_UPDATE', targetType: 'PLAN', targetId: plan.code, reason, before, after: plan }) });
      return plan;
    });
    res.json(after);
  } catch (error) {
    console.error('[Admin] Plan update error:', error.message);
    res.status(500).json({ error: "Couldn't update that plan. Try again." });
  }
});

/** Shared shape for the four per-customer plan controls: step-up + reason + audit. */
function customerBillingAction(path, action, run) {
  router.post(`/users/:id/billing/${path}`, requireStepUp, async (req, res) => {
    const reason = readReason(req, res);
    if (!reason) return undefined;
    try {
      const exists = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
      if (!exists) return res.status(404).json({ error: 'That customer no longer exists.' });
      const result = await run(req.params.id, req.body || {});
      await recordAdminAudit(req, { action, targetType: 'USER', targetId: exists.id, reason, before: result.before, after: { ...result.after, ...(result.identitiesCleared != null ? { identitiesCleared: result.identitiesCleared } : {}) } });
      return res.json(result);
    } catch (error) {
      if (error instanceof adminBilling.AdminBillingError) return res.status(error.status).json({ error: error.message, code: error.code });
      console.error(`[Admin] ${action} error:`, error.message);
      return res.status(500).json({ error: "Couldn't change that customer's plan. Try again." });
    }
  });
}

// { planCode: STARTER|PRO|ENTERPRISE, validUntil: ISO date-time, reason }
customerBillingAction('grant-plan', 'PLAN_GRANT_MANUAL', (id, b) =>
  adminBilling.grantPlanWithExpiry(id, b.planCode, typeof b.validUntil === 'string' ? new Date(b.validUntil) : null)
);
// { days: 1..365, reason }
customerBillingAction('extend', 'PLAN_EXTEND', (id, b) => adminBilling.extendExpiry(id, b.days));
// { amount: 1..100000, reason } — this cycle only
customerBillingAction('bonus-quota', 'QUOTA_BONUS', (id, b) => adminBilling.addBonusClassifications(id, b.amount));
// { reason }
customerBillingAction('reset-trial', 'TRIAL_RESET', (id) => adminBilling.resetTrial(id));

// ---- Coupons ----

function readCouponBody(req, res, { creating }) {
  const b = req.body || {};
  const allowed = creating
    ? ['code', 'discountType', 'value', 'currency', 'maxUses', 'expiresAt', 'influencerTag', 'reason']
    : ['maxUses', 'expiresAt', 'influencerTag', 'isActive', 'reason'];
  if (!onlyFields(req, res, allowed)) return null;
  const data = {};
  if (creating) {
    const code = coupons.normalizeCode(b.code);
    if (!code) return badRequest(res, 'Code: 3 to 32 letters, digits, _ or -.');
    data.code = code;
    if (!['PERCENT', 'FLAT'].includes(b.discountType)) return badRequest(res, 'discountType must be PERCENT or FLAT.');
    data.discountType = b.discountType;
    if (b.discountType === 'PERCENT') {
      if (!Number.isInteger(b.value) || b.value < 1 || b.value > 100) return badRequest(res, 'A percent discount is 1 to 100.');
      if (b.currency !== undefined && b.currency !== null) return badRequest(res, 'A percent discount has no currency.');
    } else {
      if (!Number.isInteger(b.value) || b.value < 1 || b.value > 100000000) return badRequest(res, 'A flat discount is a whole number in the smallest unit.');
      if (!['INR', 'USD'].includes(b.currency)) return badRequest(res, 'A flat discount needs currency INR or USD.');
      data.currency = b.currency;
    }
    data.value = b.value;
  }
  if (b.maxUses !== undefined) {
    if (b.maxUses !== null && !(Number.isInteger(b.maxUses) && b.maxUses >= 1 && b.maxUses <= 1000000)) return badRequest(res, 'maxUses: a whole number, or empty for unlimited.');
    data.maxUses = b.maxUses;
  }
  if (b.expiresAt !== undefined) {
    if (b.expiresAt === null) data.expiresAt = null;
    else {
      const d = typeof b.expiresAt === 'string' ? new Date(b.expiresAt) : null;
      if (!d || Number.isNaN(d.getTime())) return badRequest(res, 'expiresAt must be a date.');
      data.expiresAt = d;
    }
  }
  if (b.influencerTag !== undefined) {
    if (b.influencerTag !== null && !(typeof b.influencerTag === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(b.influencerTag))) return badRequest(res, 'Influencer tag: letters, digits, _ . or -.');
    data.influencerTag = b.influencerTag;
  }
  if (!creating && b.isActive !== undefined) {
    if (typeof b.isActive !== 'boolean') return badRequest(res, 'isActive must be true or false.');
    data.isActive = b.isActive;
  }
  return data;
}

// GET /api/admin/coupons
router.get('/coupons', async (req, res) => {
  try {
    res.json(await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } }));
  } catch (error) {
    console.error('[Admin] Coupons list error:', error.message);
    res.status(500).json({ error: "Couldn't load coupons. Refresh to try again." });
  }
});

// GET /api/admin/coupons/report — per influencer: signups, paid conversions.
router.get('/coupons/report', async (req, res) => {
  try {
    res.json(await coupons.influencerReport());
  } catch (error) {
    console.error('[Admin] Coupon report error:', error.message);
    res.status(500).json({ error: "Couldn't load the influencer report. Refresh to try again." });
  }
});

// POST /api/admin/coupons — create. Reason + audit.
router.post('/coupons', async (req, res) => {
  const data = readCouponBody(req, res, { creating: true });
  if (!data) return undefined;
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const coupon = await prisma.$transaction(async (tx) => {
      const c = await tx.coupon.create({ data: { ...data, createdBy: req.admin.id } });
      await tx.adminAuditLog.create({ data: buildAuditRow(req, { action: 'COUPON_CREATE', targetType: 'COUPON', targetId: c.id, reason, after: c }) });
      return c;
    });
    res.status(201).json(coupon);
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'That code already exists.', code: 'EXISTS' });
    console.error('[Admin] Coupon create error:', error.message);
    res.status(500).json({ error: "Couldn't create that coupon. Try again." });
  }
});

// PUT /api/admin/coupons/:id — limits, expiry, tag, on/off. Never deleted
// (history and the influencer report depend on it). Reason + audit.
router.put('/coupons/:id', async (req, res) => {
  const data = readCouponBody(req, res, { creating: false });
  if (!data) return undefined;
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const before = await prisma.coupon.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'That coupon does not exist.' });
    const after = await prisma.$transaction(async (tx) => {
      const c = await tx.coupon.update({ where: { id: before.id }, data });
      await tx.adminAuditLog.create({ data: buildAuditRow(req, { action: 'COUPON_UPDATE', targetType: 'COUPON', targetId: c.id, reason, before, after: c }) });
      return c;
    });
    res.json(after);
  } catch (error) {
    console.error('[Admin] Coupon update error:', error.message);
    res.status(500).json({ error: "Couldn't update that coupon. Try again." });
  }
});

// ---- Payments (read-only; no Cashfree calls) ----

const ORDER_STATUSES = new Set(['CREATED', 'PAID', 'EXPIRED']);

// GET /api/admin/payments?page=&limit=&status=&userId=
router.get('/payments', async (req, res) => {
  try {
    const page = clampInt(req.query.page, { min: 1, max: 100000, fallback: 1 });
    const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 25 });
    const status = str(req.query.status, 20);
    const userId = str(req.query.userId, 60);
    const where = { ...(ORDER_STATUSES.has(status) ? { status } : {}), ...(userId ? { tenantId: userId } : {}) };

    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        // rawPayload / grantSnapshot deliberately not selected.
        select: {
          id: true, cashfreeOrderId: true, tenantId: true, planCode: true, addonCode: true, amount: true, currency: true,
          status: true, paymentCountry: true, regionSource: true, createdAt: true, paidAt: true,
        },
      }),
      prisma.order.count({ where }),
    ]);
    const ids = orders.map((o) => o.cashfreeOrderId);
    const [attempts, refunds, users] = await Promise.all([
      prisma.paymentAttempt.findMany({ where: { cashfreeOrderId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { cashfreeOrderId: true, status: true, paymentGroup: true, failureReason: true, createdAt: true } }),
      prisma.refund.findMany({ where: { cashfreeOrderId: { in: ids } }, select: { cashfreeOrderId: true, refundId: true, amount: true, status: true, createdAt: true } }),
      prisma.user.findMany({ where: { id: { in: [...new Set(orders.map((o) => o.tenantId))] } }, select: { id: true, email: true } }),
    ]);
    const email = new Map(users.map((u) => [u.id, u.email]));
    res.json({
      payments: orders.map((o) => ({
        ...o,
        customerEmail: email.get(o.tenantId) || null, // null once the account is deleted
        attempts: attempts.filter((a) => a.cashfreeOrderId === o.cashfreeOrderId).map((a) => ({ ...a, failureReason: a.failureReason ? String(a.failureReason).slice(0, 120) : null })),
        refunds: refunds.filter((r) => r.cashfreeOrderId === o.cashfreeOrderId),
      })),
      pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
    });
  } catch (error) {
    console.error('[Admin] Payments list error:', error.message);
    res.status(500).json({ error: "Couldn't load payments. Refresh to try again." });
  }
});

// ============================================
// 7. SETTINGS / KILL SWITCHES, METRICS, ANNOUNCEMENTS (Gate 7)
// ============================================

// Kill switches and the customer session timeout are security-relevant:
// step-up. Alert thresholds only change what the admin is told: reason only.
const STEP_UP_GROUPS = new Set(['flag', 'session']);

/** Messages skipped while AI was off, re-queued when it comes back (last 24h, bounded). */
async function requeueAiDisabled() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.message.findMany({
    where: { aiStatus: 'skipped', aiSkipReason: 'ai_disabled', createdAt: { gte: since } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 2000,
  });
  if (!rows.length) return 0;
  await prisma.message.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { aiStatus: 'pending', aiSkipReason: null, aiRecoveredAt: new Date() } });
  const { enqueueMessageAnalysis } = require('../jobs');
  for (const r of rows) await enqueueMessageAnalysis(r.id, { jobKey: 'ai-reenabled' });
  return rows.length;
}

// GET /api/admin/settings/flags — every setting: value, default, source.
router.get('/settings/flags', async (req, res) => {
  try {
    const list = await settings.listSettings();
    res.json(list.map((x) => ({ ...x, requiresStepUp: STEP_UP_GROUPS.has(x.group) })));
  } catch (error) {
    console.error('[Admin] Settings list error:', error.message);
    res.status(500).json({ error: "Couldn't load settings. Refresh to try again." });
  }
});

/** Step-up only for flag/session keys; resolved per request from the key. */
function stepUpForKey(req, res, next) {
  const def = settings.DEFINITIONS[req.params.key];
  if (!def) return res.status(404).json({ error: 'No such setting.' });
  return STEP_UP_GROUPS.has(def.group) ? requireStepUp(req, res, next) : next();
}

async function afterSettingChange(key, before, after) {
  if (key === 'ai_classification_enabled' && before === false && after === true) {
    return { requeued: await requeueAiDisabled() };
  }
  return {};
}

// PUT /api/admin/settings/flags/:key — { value, reason }
router.put('/settings/flags/:key', stepUpForKey, async (req, res) => {
  if (!onlyFields(req, res, ['value', 'reason'])) return undefined;
  const reason = readReason(req, res);
  if (!reason) return undefined;
  const key = req.params.key;
  try {
    const { before, after } = await settings.setSetting(key, req.body.value, req.admin.id);
    await recordAdminAudit(req, { action: 'SETTING_CHANGE', targetType: 'SETTING', targetId: key, reason, before: { value: before }, after: { value: after } });
    const extra = await afterSettingChange(key, before, after);
    res.json({ key, value: after, ...extra });
  } catch (error) {
    if (error.code === 'INVALID_SETTING') return res.status(400).json({ error: 'That value is not allowed for this setting.', code: 'INVALID' });
    console.error('[Admin] Setting change error:', error.message);
    res.status(500).json({ error: "Couldn't change that setting. Try again." });
  }
});

// DELETE /api/admin/settings/flags/:key — { reason }: back to the default.
router.delete('/settings/flags/:key', stepUpForKey, async (req, res) => {
  if (!onlyFields(req, res, ['reason'])) return undefined;
  const reason = readReason(req, res);
  if (!reason) return undefined;
  const key = req.params.key;
  try {
    const { before, after } = await settings.resetSetting(key);
    await recordAdminAudit(req, { action: 'SETTING_RESET', targetType: 'SETTING', targetId: key, reason, before: { value: before }, after: { value: after } });
    const extra = await afterSettingChange(key, before, after);
    res.json({ key, value: after, ...extra });
  } catch (error) {
    console.error('[Admin] Setting reset error:', error.message);
    res.status(500).json({ error: "Couldn't reset that setting. Try again." });
  }
});

// GET /api/admin/metrics?days=30 — business metrics. Counts only.
router.get('/metrics', async (req, res) => {
  try {
    const days = clampInt(req.query.days, { min: 7, max: 365, fallback: 30 });
    const now = Date.now();
    const since = new Date(now - days * 24 * 60 * 60 * 1000);
    const daily = (rows) => rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), count: Number(r.count) }));

    const [signups, dms, classified, active1, active7, active30, igActive, trialUsers, converted] = await Promise.all([
      prisma.$queryRaw`SELECT date_trunc('day', "created_at") AS day, COUNT(*) AS count FROM "users" WHERE "created_at" >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw`SELECT date_trunc('day', "created_at") AS day, COUNT(*) AS count FROM "messages" WHERE "direction" = 'inbound' AND "created_at" >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw`SELECT date_trunc('day', "created_at") AS day, COUNT(*) AS count FROM "ai_analyses" WHERE "created_at" >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.user.count({ where: { lastSeenAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: new Date(now - 30 * 24 * 60 * 60 * 1000) } } }),
      prisma.instagramAccount.count({ where: { connectionStatus: 'CONNECTED' } }),
      prisma.$queryRaw`SELECT COUNT(DISTINCT "tenant_id") AS count FROM "credit_ledger" WHERE "source" = 'trial_grant'`,
      prisma.$queryRaw`SELECT COUNT(DISTINCT l."tenant_id") AS count FROM "credit_ledger" l JOIN "orders" o ON o."tenant_id" = l."tenant_id" AND o."status" = 'PAID' AND o."plan_code" IS NOT NULL WHERE l."source" = 'trial_grant'`,
    ]);
    const trials = Number(trialUsers[0]?.count || 0);
    const paid = Number(converted[0]?.count || 0);
    res.json({
      days,
      signupsPerDay: daily(signups),
      dmsPerDay: daily(dms),
      classifiedPerDay: daily(classified),
      activeUsers: { last24h: active1, last7d: active7, last30d: active30 },
      trialToPaid: { trials, converted: paid, rate: trials ? paid / trials : 0 },
      activeInstagramAccounts: igActive,
    });
  } catch (error) {
    console.error('[Admin] Metrics error:', error.message);
    res.status(500).json({ error: "Couldn't load metrics. Refresh to try again." });
  }
});

// ---- Announcements ----

const ANNOUNCEMENT_TYPES = new Set(['info', 'warning', 'critical']);

function readAnnouncementBody(req, res, { creating }) {
  const b = req.body || {};
  if (!onlyFields(req, res, ['message', 'type', 'startsAt', 'endsAt', 'isActive', 'reason'])) return null;
  const data = {};
  if (b.message !== undefined || creating) {
    if (typeof b.message !== 'string' || b.message.trim().length < 3 || b.message.length > 500) return badRequest(res, 'Message: 3 to 500 characters of plain text.');
    data.message = b.message.trim();
  }
  if (b.type !== undefined) {
    if (!ANNOUNCEMENT_TYPES.has(b.type)) return badRequest(res, 'Type: info, warning or critical.');
    data.type = b.type;
  }
  for (const f of ['startsAt', 'endsAt']) {
    if (b[f] === undefined && !creating) continue;
    const d = typeof b[f] === 'string' ? new Date(b[f]) : null;
    if (!d || Number.isNaN(d.getTime())) return badRequest(res, `${f} must be a date.`);
    data[f] = d;
  }
  if (b.isActive !== undefined) {
    if (typeof b.isActive !== 'boolean') return badRequest(res, 'isActive must be true or false.');
    data.isActive = b.isActive;
  }
  return data;
}

router.get('/announcements', async (req, res) => {
  try {
    res.json(await prisma.announcement.findMany({ orderBy: { startsAt: 'desc' }, take: 100 }));
  } catch (error) {
    console.error('[Admin] Announcements list error:', error.message);
    res.status(500).json({ error: "Couldn't load announcements. Refresh to try again." });
  }
});

// POST /api/admin/announcements — { message, type, startsAt, endsAt, reason }
router.post('/announcements', async (req, res) => {
  const data = readAnnouncementBody(req, res, { creating: true });
  if (!data) return undefined;
  const reason = readReason(req, res);
  if (!reason) return undefined;
  if (data.endsAt <= data.startsAt) return res.status(400).json({ error: 'The end must be after the start.', code: 'INVALID' });
  try {
    const row = await prisma.$transaction(async (tx) => {
      const a = await tx.announcement.create({ data: { ...data, createdBy: req.admin.id } });
      await tx.adminAuditLog.create({ data: buildAuditRow(req, { action: 'ANNOUNCEMENT_CREATE', targetType: 'ANNOUNCEMENT', targetId: a.id, reason, after: a }) });
      return a;
    });
    res.status(201).json(row);
  } catch (error) {
    console.error('[Admin] Announcement create error:', error.message);
    res.status(500).json({ error: "Couldn't create that announcement. Try again." });
  }
});

// PUT /api/admin/announcements/:id — edit / turn off. Reason + audit.
router.put('/announcements/:id', async (req, res) => {
  const data = readAnnouncementBody(req, res, { creating: false });
  if (!data) return undefined;
  const reason = readReason(req, res);
  if (!reason) return undefined;
  try {
    const before = await prisma.announcement.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'That announcement does not exist.' });
    const startsAt = data.startsAt || before.startsAt;
    const endsAt = data.endsAt || before.endsAt;
    if (endsAt <= startsAt) return res.status(400).json({ error: 'The end must be after the start.', code: 'INVALID' });
    const after = await prisma.$transaction(async (tx) => {
      const a = await tx.announcement.update({ where: { id: before.id }, data });
      await tx.adminAuditLog.create({ data: buildAuditRow(req, { action: 'ANNOUNCEMENT_UPDATE', targetType: 'ANNOUNCEMENT', targetId: a.id, reason, before, after: a }) });
      return a;
    });
    res.json(after);
  } catch (error) {
    console.error('[Admin] Announcement update error:', error.message);
    res.status(500).json({ error: "Couldn't update that announcement. Try again." });
  }
});

// GET /api/admin/alerts — the last alerts sent (audit rows), for the panel.
router.get('/alerts', async (req, res) => {
  try {
    res.json(
      await prisma.adminAuditLog.findMany({
        where: { action: { in: ['ALERT_SENT', 'AI_FALLBACK_ACTIVATED'] } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { action: true, targetId: true, after: true, createdAt: true },
      })
    );
  } catch (error) {
    console.error('[Admin] Alerts list error:', error.message);
    res.status(500).json({ error: "Couldn't load alerts. Refresh to try again." });
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
