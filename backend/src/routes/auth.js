/**
 * Auth routes — Instagram OAuth flow for Codeback.
 * 
 * Flow:
 * 1. User clicks "Connect Instagram" → GET /auth/instagram → redirects to Instagram
 * 2. User authorizes → Instagram redirects to GET /auth/instagram/callback
 * 3. We exchange code → short-lived token → long-lived token
 * 4. We save the user + account, subscribe to webhooks, set session
 * 5. Redirect to frontend dashboard
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../lib/prisma');
const instagram = require('../lib/instagram');
const { encrypt } = require('../lib/crypto');
const { disconnectUserSockets } = require('../lib/socket');
const { createRateLimiter } = require('../lib/rateLimit');
const { startAuthenticatedSession, saveSession } = require('../lib/session');
const { logAdminAction } = require('../lib/auditLogger');
const { hashPassword, verifyPassword, burnEquivalentWork } = require('../lib/password');
const authTokens = require('../lib/authTokens');
const email = require('../lib/email');
const google = require('../lib/google');
const oauthState = require('../lib/oauthState');
const { requireAuth } = require('../middleware/auth');

// Throttle credential endpoints to blunt brute-force / credential-stuffing.
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Wait a few minutes and try again.',
});
const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many accounts created from this network. Wait a few minutes and try again.',
});
// Per-IP ceiling on reset requests. The per-EMAIL limit below is the one that
// actually matters — a per-IP limit alone lets a distributed attacker mailbomb
// one address from many addresses.
const forgotPasswordIpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many password reset requests. Try again later.',
});
const resetPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts. Wait a few minutes and try again.',
});
const resendVerificationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many verification emails requested. Try again later.',
});

/**
 * Per-email throttle for password resets: 3 per hour.
 *
 * Kept in memory alongside lib/rateLimit.js for the same reasons documented
 * there (single instance, pre-launch). It is keyed on the email rather than
 * the IP so that a distributed mailbomb against one address is still stopped.
 *
 * IMPORTANT: this must NOT change the response. Returning 429 for a
 * rate-limited address and 200 otherwise would itself be an account-enumeration
 * oracle. The limiter suppresses the SEND and the response stays identical.
 */
const forgotPasswordByEmail = new Map();
const FORGOT_WINDOW_MS = 60 * 60 * 1000;
const FORGOT_MAX_PER_EMAIL = 3;

function maySendResetTo(normalizedEmail) {
  const now = Date.now();
  const entry = forgotPasswordByEmail.get(normalizedEmail);
  if (!entry || now > entry.resetAt) {
    forgotPasswordByEmail.set(normalizedEmail, { count: 1, resetAt: now + FORGOT_WINDOW_MS });
    return true;
  }
  if (entry.count >= FORGOT_MAX_PER_EMAIL) return false;
  entry.count += 1;
  return true;
}

// Bound the map so it cannot grow without limit on a stream of unique inputs.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of forgotPasswordByEmail) {
    if (now > entry.resetAt) forgotPasswordByEmail.delete(key);
  }
}, FORGOT_WINDOW_MS).unref();

const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * The only shape of InstagramAccount that may leave the server.
 *
 * `accessToken` is an AES-256-GCM ciphertext of a live Meta Graph token and has
 * no reason to reach a browser. Including the relation as `true` pulls it in,
 * and sanitizeUser() below is a shallow deny-list that cannot strip it — so
 * every include of this relation must go through this select, never `true`.
 */
const INSTAGRAM_ACCOUNT_PUBLIC_SELECT = {
  id: true,
  igUserId: true,
  igUsername: true,
  igName: true,
  igProfilePic: true,
  tokenExpiresAt: true,
  tokenStatus: true,
  connectionStatus: true,
};

// Helper to sanitize user object.
//
// NOTE: this is a SHALLOW deny-list — it strips top-level passwordHash and
// nothing else. It does not descend into included relations, so it is not a
// substitute for selecting the right columns in the first place.
function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

// ============================================
// POST /auth/register
// Email + Password Registration for Codeback SaaS
// ============================================
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Enter a full name of at least 2 characters.' });
    }

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Use at least 6 characters.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Those passwords do not match.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await prisma.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
          onboardingCompleted: false,
          businessProfile: {
            create: {
              businessName: name.trim(),
              tone: 'friendly',
              // Auto-sending is opt-in for new accounts — see the note on
              // BusinessProfile.autoReplyMode in prisma/schema.prisma.
              autoReplyMode: 'human_only',
            },
          },
          preferences: { create: {} },
        },
        include: {
          businessProfile: true,
        },
      });
    } catch (err) {
      // Rely on the unique constraint rather than a check-then-create: the old
      // findUnique-then-create pair was a TOCTOU race, and the loser hit P2002
      // and fell into the generic catch as a misleading 500.
      if (err.code === 'P2002') {
        return res
          .status(409)
          .json({ error: 'An account already uses that email address. Log in instead.' });
      }
      throw err;
    }

    // Set session on a FRESH session id — never the one the client presented.
    await startAuthenticatedSession(req, {
      userId: user.id,
      userEmail: user.email,
      sessionVersion: user.sessionVersion,
    });

    // Send the verification link. A failure here must NOT fail registration —
    // the account exists and the user can request another link — but it must
    // be logged loudly, because silently unverifiable accounts are invisible.
    try {
      const { rawToken, expiresInMinutes } = await authTokens.issueToken({
        userId: user.id,
        type: 'EMAIL_VERIFY',
        requestIp: req.ip,
      });
      await email.sendVerification(user.email, {
        url: `${frontendUrl()}/verify-email?token=${encodeURIComponent(rawToken)}`,
        expiresInMinutes,
      });
    } catch (mailErr) {
      console.error('[Auth] Verification email failed to send:', mailErr.message);
    }

    console.log(`[Auth] New user registered: ${user.id}`);

    res.status(201).json({
      message: 'Account created. Check your email to confirm your address.',
      user: sanitizeUser(user),
      emailVerificationSent: true,
    });
  } catch (error) {
    console.error('[Auth] Registration error:', error.message);
    res.status(500).json({ error: "Couldn't create your account. Try again in a moment." });
  }
});

// ============================================
// POST /auth/login
// Email + Password Login
// ============================================
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Enter your email address and password.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        businessProfile: true,
        instagramAccounts: { select: INSTAGRAM_ACCOUNT_PUBLIC_SELECT },
      },
    });

    // TIMING EQUALISATION. Returning here without doing password work would
    // make a nonexistent email (or a Google-only account, which has no
    // passwordHash) answer in database-round-trip time while a real password
    // account pays a full Argon2id verification. That difference is remotely
    // measurable and enumerates both which accounts exist and which are
    // OAuth-only. Burning equivalent work keeps the two paths indistinguishable.
    if (!user || !user.passwordHash) {
      await burnEquivalentWork(password);
      return res.status(401).json({ error: 'That email or password is not right.' });
    }

    const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'That email or password is not right.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ error: 'This account is suspended. Contact support.' });
    }

    // Lazy migration off bcrypt. The password is in hand and already verified,
    // so this is the one moment we can upgrade the hash without asking the
    // user to do anything. A failure here must not block the login.
    if (needsRehash) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(password) },
        });
        console.log(`[Auth] Rehashed password to Argon2id for user ${user.id}`);
      } catch (rehashErr) {
        console.error('[Auth] Password rehash failed (login still succeeds):', rehashErr.message);
      }
    }

    // Update last seen
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    }).catch(() => {});

    // Set session on a FRESH session id — never the one the client presented.
    await startAuthenticatedSession(req, {
      userId: user.id,
      userEmail: user.email,
      sessionVersion: user.sessionVersion,
    });

    console.log(`[Auth] User logged in: ${user.id}`);

    res.json({
      message: 'Logged in',
      user: sanitizeUser(user),
      // Lets the frontend route straight to the blocking step rather than
      // discovering it on the next 403.
      emailVerified: Boolean(user.emailVerifiedAt),
      needsEmail: !user.email,
    });
  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({ error: "Couldn't log you in. Try again in a moment." });
  }
});

// ============================================
// PASSWORD RESET
// ============================================

/**
 * POST /auth/forgot-password
 *
 * ALWAYS returns the same body and status, whether or not the address exists,
 * whether or not it is rate limited, and whether or not the email actually
 * sent. Any divergence — a different message, a different status, an error on
 * failure — is an account-enumeration oracle.
 *
 * Note this is the endpoint that made the careful work on login's 401s
 * worthwhile; the sibling 409 on /register still leaks the same fact and is
 * tracked as F7 in FINDINGS.md.
 */
router.post('/forgot-password', forgotPasswordIpLimiter, async (req, res) => {
  const GENERIC = {
    message: 'If that email address has an account, a reset link is on its way.',
  };

  try {
    const { email: rawEmail } = req.body || {};
    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.json(GENERIC);
    }

    const normalizedEmail = rawEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, passwordHash: true },
    });

    // Every branch below returns GENERIC. They differ only in what they do.
    if (!user) {
      return res.json(GENERIC);
    }

    // A user with no password signed up with Google. Minting a reset token for
    // them would create a password on an account that deliberately has none,
    // turning "sign in with Google" into a second, weaker credential.
    if (!user.passwordHash) {
      console.log(`[Auth] Reset requested for a Google-only account (${user.id}); no token issued.`);
      return res.json(GENERIC);
    }

    if (!maySendResetTo(normalizedEmail)) {
      console.warn(`[Auth] Reset rate limit hit for a single address; send suppressed.`);
      return res.json(GENERIC);
    }

    const { rawToken, expiresInMinutes } = await authTokens.issueToken({
      userId: user.id,
      type: 'PASSWORD_RESET',
      requestIp: req.ip,
    });

    await email.sendPasswordReset(user.email, {
      url: `${frontendUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`,
      expiresInMinutes,
    });

    return res.json(GENERIC);
  } catch (error) {
    // Even a genuine failure returns the generic success body. A 500 here
    // would reveal that the address exists and something downstream broke.
    console.error('[Auth] forgot-password error:', error.message);
    return res.json(GENERIC);
  }
});

/**
 * POST /auth/reset-password
 *
 * Consumes the token, sets the new hash, and BUMPS sessionVersion — which is
 * what actually evicts an attacker. Without the bump, the canonical reason a
 * user resets their password ("I think I'm compromised") leaves every existing
 * session, including the attacker's, fully valid for up to seven days.
 */
router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body || {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'That reset link is not valid.' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Use at least 6 characters.' });
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ error: 'Those passwords do not match.' });
    }

    const result = await authTokens.consumeToken({ rawToken: token, type: 'PASSWORD_RESET' });
    if (!result.ok) {
      // One message for every failure mode. Distinguishing "expired" from
      // "already used" from "never existed" tells an attacker which of their
      // guesses was once real.
      return res.status(400).json({
        error: 'That reset link is no longer valid. Request a new one.',
      });
    }

    const passwordHash = await hashPassword(password);

    const updated = await prisma.user.update({
      where: { id: result.token.userId },
      data: {
        passwordHash,
        // THE EVICTION. Every session carrying the old value now mismatches in
        // requireAuth and is rejected on its next request.
        sessionVersion: { increment: 1 },
        // Completing a reset proves control of the mailbox, so an unverified
        // address becomes verified here. Not doing so would leave a user who
        // reset their password still unable to start a trial.
        emailVerifiedAt: result.token.user.emailVerifiedAt || new Date(),
      },
      select: { id: true, sessionVersion: true },
    });

    // Drop live websockets too — they authenticate at handshake time and would
    // otherwise keep streaming the victim's DMs after the reset.
    disconnectUserSockets(updated.id);

    console.log(`[Auth] Password reset completed for ${updated.id}; all sessions invalidated.`);

    return res.json({
      message: 'Your password has been changed. Log in with your new password.',
    });
  } catch (error) {
    console.error('[Auth] reset-password error:', error.message);
    return res.status(500).json({ error: "Couldn't reset your password. Try again." });
  }
});

// ============================================
// EMAIL VERIFICATION
// ============================================

/**
 * POST /auth/verify-email
 *
 * Not a GET. Email clients and security scanners pre-fetch links, and a GET
 * that consumes a single-use token would be burned before the user ever
 * clicked. The frontend page reads the token from the query string and POSTs
 * it.
 */
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'That confirmation link is not valid.' });
    }

    const result = await authTokens.consumeToken({ rawToken: token, type: 'EMAIL_VERIFY' });
    if (!result.ok) {
      return res.status(400).json({
        error: 'That confirmation link is no longer valid. Request a new one.',
      });
    }

    const user = await prisma.user.update({
      where: { id: result.token.userId },
      data: { emailVerifiedAt: result.token.user.emailVerifiedAt || new Date() },
      select: { id: true, email: true, emailVerifiedAt: true },
    });

    console.log(`[Auth] Email verified for ${user.id}`);
    return res.json({ message: 'Your email address is confirmed.', emailVerified: true });
  } catch (error) {
    console.error('[Auth] verify-email error:', error.message);
    return res.status(500).json({ error: "Couldn't confirm your email. Try again." });
  }
});

/**
 * POST /auth/resend-verification
 * Authenticated: only the account holder can trigger a resend to their own
 * address, so this cannot be used to mailbomb a third party.
 */
router.post('/resend-verification', resendVerificationLimiter, requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, emailVerifiedAt: true },
    });

    if (!user || !user.email) {
      return res.status(400).json({
        error: 'Add an email address to your account first.',
        code: 'EMAIL_REQUIRED',
      });
    }
    if (user.emailVerifiedAt) {
      return res.json({ message: 'Your email address is already confirmed.', emailVerified: true });
    }

    const { rawToken, expiresInMinutes } = await authTokens.issueToken({
      userId: user.id,
      type: 'EMAIL_VERIFY',
      requestIp: req.ip,
    });
    await email.sendVerification(user.email, {
      url: `${frontendUrl()}/verify-email?token=${encodeURIComponent(rawToken)}`,
      expiresInMinutes,
    });

    return res.json({ message: 'Confirmation email sent. Check your inbox.' });
  } catch (error) {
    console.error('[Auth] resend-verification error:', error.message);
    return res.status(500).json({ error: "Couldn't send that email. Try again." });
  }
});

/**
 * POST /auth/add-email
 *
 * The mandatory step for null-email accounts — the ones created by the old
 * Instagram-signup path, which no longer exists. Without an address they have
 * no reset target, no receipt destination, and no way to be told their token
 * expired, so they cannot be granted a trial either.
 */
router.post('/add-email', requireAuth, async (req, res) => {
  try {
    const { email: rawEmail } = req.body || {};
    if (!rawEmail || typeof rawEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim())) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const current = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true },
    });
    if (current.email) {
      return res.status(400).json({ error: 'This account already has an email address.' });
    }

    const normalizedEmail = rawEmail.trim().toLowerCase();

    let user;
    try {
      user = await prisma.user.update({
        where: { id: req.userId },
        data: { email: normalizedEmail, emailVerifiedAt: null },
        select: { id: true, email: true },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'An account already uses that email address.' });
      }
      throw err;
    }

    const { rawToken, expiresInMinutes } = await authTokens.issueToken({
      userId: user.id,
      type: 'EMAIL_VERIFY',
      requestIp: req.ip,
    });
    await email.sendVerification(user.email, {
      url: `${frontendUrl()}/verify-email?token=${encodeURIComponent(rawToken)}`,
      expiresInMinutes,
    });

    return res.json({ message: 'Confirmation email sent. Check your inbox to finish.' });
  } catch (error) {
    console.error('[Auth] add-email error:', error.message);
    return res.status(500).json({ error: "Couldn't save that address. Try again." });
  }
});

/**
 * POST /auth/set-password
 *
 * Lets a Google-only user add a password. Requires an authenticated session
 * and refuses if one already exists — changing an existing password goes
 * through PUT /auth/profile, which demands the current one.
 */
router.post('/set-password', requireAuth, async (req, res) => {
  try {
    const { password, confirmPassword } = req.body || {};
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Use at least 6 characters.' });
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ error: 'Those passwords do not match.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, passwordHash: true },
    });

    if (user.passwordHash) {
      return res.status(400).json({
        error: 'This account already has a password. Change it from your profile instead.',
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });

    console.log(`[Auth] Password set for previously password-less user ${user.id}`);
    return res.json({ message: 'Password set. You can now log in with your email address too.' });
  } catch (error) {
    console.error('[Auth] set-password error:', error.message);
    return res.status(500).json({ error: "Couldn't set your password. Try again." });
  }
});

// ============================================
// GOOGLE OAUTH (secondary login)
// ============================================

/**
 * GET /auth/google
 * Starts the flow. Deliberately usable while logged OUT — that is the point.
 */
router.get('/google', async (req, res) => {
  try {
    if (!google.isConfigured()) {
      return res.redirect(`${frontendUrl()}/login?error=google_not_configured`);
    }
    const state = await oauthState.createState({
      purpose: 'GOOGLE_LOGIN',
      // Null when signing in fresh; populated when an existing user is LINKING
      // their Google account from settings.
      userId: req.session?.userId || null,
    });
    return res.redirect(google.getAuthUrl(state));
  } catch (error) {
    console.error('[Auth] Google start error:', error.message);
    return res.redirect(`${frontendUrl()}/login?error=google_failed`);
  }
});

/**
 * GET /auth/google/callback
 *
 * The linking rules are the security-critical part. Implemented exactly:
 *
 *   Google email_verified AND a local user with that email AND that user's
 *   emailVerifiedAt is set    -> link, create AuthIdentity, log in
 *   local user exists but emailVerifiedAt is null
 *                             -> REFUSE to auto-link
 *   no local user             -> create with passwordHash null, emailVerifiedAt from Google
 *   AuthIdentity already exists for this providerAccountId
 *                             -> log in
 *
 * The refusal is the one that matters. Auto-linking on an unverified local
 * email means anyone who registers with someone else's address and never
 * confirms it gets handed that person's account the moment the real owner
 * signs in with Google.
 */
router.get('/google/callback', async (req, res) => {
  const fail = (code) => res.redirect(`${frontendUrl()}/login?error=${code}`);

  try {
    if (!google.isConfigured()) return fail('google_not_configured');

    // Handle the user pressing Cancel before anything else.
    if (req.query.error) {
      console.warn(`[Auth] Google callback returned error=${req.query.error}`);
      return fail(req.query.error === 'access_denied' ? 'google_cancelled' : 'google_failed');
    }

    const { code, state } = req.query;
    if (!code || typeof code !== 'string') return fail('google_no_code');

    // Verify state BEFORE the code exchange — a forged callback must never
    // cause an outbound request carrying our client secret.
    const stateResult = await oauthState.verifyAndConsumeState({
      state,
      expectedPurpose: 'GOOGLE_LOGIN',
    });
    if (!stateResult.ok) {
      console.warn(`[Auth] Rejected Google callback: state ${stateResult.reason}`);
      return fail('google_invalid_state');
    }

    const tokens = await google.exchangeCodeForTokens(code);
    const profile = await google.fetchProfile(tokens.access_token);

    if (!profile.providerAccountId || !profile.email) {
      return fail('google_no_email');
    }

    // 1. Known identity — just log in.
    const existingIdentity = await prisma.authIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: profile.providerAccountId,
        },
      },
      include: { user: true },
    });

    if (existingIdentity) {
      if (existingIdentity.user.isSuspended) return fail('account_suspended');
      await prisma.authIdentity.update({
        where: { id: existingIdentity.id },
        data: { lastUsedAt: new Date() },
      });
      await startAuthenticatedSession(req, {
        userId: existingIdentity.user.id,
        userEmail: existingIdentity.user.email,
        sessionVersion: existingIdentity.user.sessionVersion,
      });
      return res.redirect(`${frontendUrl()}/dashboard`);
    }

    // Google itself must vouch for the address before it can be used to match
    // a local account.
    if (!profile.emailVerified) {
      console.warn('[Auth] Google profile has an unverified email; refusing to link.');
      return fail('google_email_unverified');
    }

    const localUser = await prisma.user.findUnique({ where: { email: profile.email } });

    // 2. A local account exists.
    if (localUser) {
      if (localUser.isSuspended) return fail('account_suspended');

      // THE REFUSAL. An unverified local email is an unproven claim to that
      // address; linking on it is account takeover by registration.
      if (!localUser.emailVerifiedAt) {
        console.warn(
          `[Auth] Refused Google auto-link to user ${localUser.id}: local email is unverified.`
        );
        return fail('link_requires_verified_email');
      }

      await prisma.authIdentity.create({
        data: {
          userId: localUser.id,
          provider: 'GOOGLE',
          providerAccountId: profile.providerAccountId,
          email: profile.email,
          emailVerified: true,
          lastUsedAt: new Date(),
        },
      });
      await startAuthenticatedSession(req, {
        userId: localUser.id,
        userEmail: localUser.email,
        sessionVersion: localUser.sessionVersion,
      });
      console.log(`[Auth] Linked Google identity to existing user ${localUser.id}`);
      return res.redirect(`${frontendUrl()}/dashboard`);
    }

    // 3. Brand new user. passwordHash stays null — they can add one later via
    // /auth/set-password.
    const created = await prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        passwordHash: null,
        emailVerifiedAt: new Date(),
        onboardingCompleted: false,
        businessProfile: {
          create: {
            businessName: profile.name || null,
            tone: 'friendly',
            autoReplyMode: 'human_only',
          },
        },
        preferences: { create: {} },
        authIdentities: {
          create: {
            provider: 'GOOGLE',
            providerAccountId: profile.providerAccountId,
            email: profile.email,
            emailVerified: true,
            lastUsedAt: new Date(),
          },
        },
      },
    });

    await startAuthenticatedSession(req, {
      userId: created.id,
      userEmail: created.email,
      sessionVersion: created.sessionVersion,
    });
    console.log(`[Auth] Created user ${created.id} from Google sign-in`);
    return res.redirect(`${frontendUrl()}/dashboard`);
  } catch (error) {
    // error.response?.data can carry Google's error JSON. It must never be
    // logged wholesale: on an axios error, error.config.data holds the token
    // request body, which contains the client secret and the auth code.
    console.error('[Auth] Google callback error:', error.message);
    return fail('google_failed');
  }
});

// ============================================
// POST /auth/logout
// End session & clear cookie
// ============================================
router.post('/logout', (req, res) => {
  const userId = req.session ? req.session.userId : null;
  if (userId) {
    disconnectUserSockets(userId);
  }

  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('[Auth] Error destroying session on logout:', err);
      }
      res.clearCookie('codeback.sid');
      return res.json({ message: 'Logged out' });
    });
  } else {
    res.clearCookie('codeback.sid');
    return res.json({ message: 'Logged out' });
  }
});

// ============================================
// GET /auth/instagram
// Redirect user to Instagram OAuth consent screen
// ============================================
router.get('/instagram', async (req, res) => {
  // CSRF binding: a single-use, unguessable value tying the browser that
  // starts the flow to the browser that comes back to the callback. Without
  // it, anyone can feed a victim's logged-in browser an authorization code
  // of their choosing and silently attach their Instagram account to the
  // victim's workspace.
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;
  req.session.oauthStateAt = Date.now();

  try {
    await saveSession(req);
  } catch (err) {
    console.error('[Auth] Failed to persist OAuth state:', err.message);
    return res.redirect(`${process.env.FRONTEND_URL}?error=oauth_state_unavailable`);
  }

  const authUrl = instagram.getAuthorizationUrl(
    process.env.INSTAGRAM_APP_ID,
    process.env.REDIRECT_URI,
    state
  );

  console.log('[Auth] Redirecting to Instagram OAuth');
  res.redirect(authUrl);
});

// ============================================
// GET /auth/instagram/callback
// Handle the OAuth callback from Instagram
// ============================================
router.get('/instagram/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    // CSRF check FIRST — before spending a Meta round-trip on an
    // authorization code we have no reason to trust. The stored state is
    // consumed here whatever the outcome, so a value can never be replayed.
    const expectedState = req.session ? req.session.oauthState : null;
    const issuedAt = req.session ? req.session.oauthStateAt : null;
    if (req.session) {
      delete req.session.oauthState;
      delete req.session.oauthStateAt;
    }

    const STATE_TTL_MS = 10 * 60 * 1000;
    const stateExpired = !issuedAt || Date.now() - issuedAt > STATE_TTL_MS;
    const stateMatches =
      typeof state === 'string' &&
      typeof expectedState === 'string' &&
      state.length === expectedState.length &&
      crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState));

    if (!stateMatches || stateExpired) {
      console.warn('[Auth] Rejected OAuth callback: missing, stale, or mismatched state.');
      await saveSession(req).catch(() => {});
      return res.redirect(`${process.env.FRONTEND_URL}?error=invalid_oauth_state`);
    }

    if (!code) {
      console.error('[Auth] No authorization code in callback');
      return res.redirect(`${process.env.FRONTEND_URL}?error=no_code`);
    }

    console.log('[Auth] Received authorization code, exchanging for token...');

    // Step 1: Exchange code for short-lived token
    const shortTokenData = await instagram.exchangeCodeForToken(
      code,
      process.env.INSTAGRAM_APP_ID,
      process.env.INSTAGRAM_APP_SECRET,
      process.env.REDIRECT_URI
    );

    console.log('[Auth] Short-lived token obtained for user:', shortTokenData.user_id);

    // Step 2: Exchange short-lived token for long-lived token (60 days)
    const longTokenData = await instagram.exchangeForLongLivedToken(
      shortTokenData.access_token,
      process.env.INSTAGRAM_APP_SECRET
    );

    console.log('[Auth] Long-lived token obtained, expires in:', longTokenData.expires_in, 'seconds');

    // Step 3: Fetch the user's Instagram profile
    const profile = await instagram.fetchMyProfile(longTokenData.access_token);
    console.log('[Auth] Profile fetched:', profile.username);

    // Step 4: Calculate token expiration date
    const tokenExpiresAt = new Date(Date.now() + (longTokenData.expires_in * 1000));

    // Step 5: Upsert user and Instagram account in the database
    const igUserId = String(profile.user_id || profile.id || shortTokenData.user_id);
    const currentUserId = req.session ? req.session.userId : null;

    let user;
    // igUserId is no longer globally unique — disconnected rows persist as
    // history and may repeat, which is what allows a legitimate
    // workspace-to-workspace move. So there are two lookups, in priority order:
    //
    //   1. the ACTIVE link, if any. At most one can exist (ig_one_active_link).
    //   2. failing that, THIS user's own historical row, so that reconnecting
    //      after a disconnect reactivates the original row and keeps its
    //      contacts, conversations and messages attached.
    const existingAccount =
      (await prisma.instagramAccount.findFirst({
        where: { igUserId, connectionStatus: 'CONNECTED' },
        include: { user: true },
      })) ||
      (currentUserId
        ? await prisma.instagramAccount.findFirst({
            where: { igUserId, userId: currentUserId },
            include: { user: true },
            orderBy: { createdAt: 'desc' },
          })
        : null);

    if (existingAccount) {
      // Reconnect: update the SAME account row with a fresh token. Because
      // igUserId is globally unique, this never creates a duplicate account
      // — all historical contacts/conversations/messages remain attached to
      // this row and are never touched here.
      const targetUserId = currentUserId || existingAccount.userId;

      // Cross-tenant re-link. Completing OAuth for an account that already
      // belongs to someone else used to move the row — and therefore every
      // Contact / Conversation / Message / AIAnalysis hanging off it — to
      // whoever happened to be logged in. The old guard only counted
      // BrandDeal rows, so an account with thousands of DMs and no brand
      // deal transferred silently.
      //
      // Conversation history is the thing that must never move. If any
      // exists, refuse; the tenants involved are not named in the response.
      if (targetUserId !== existingAccount.userId) {
        const conversationCount = await prisma.conversation.count({
          where: { instagramAccountId: existingAccount.id },
        });

        if (conversationCount > 0) {
          console.warn(
            `[Auth] Re-link BLOCKED: IG account ${igUserId} holds ${conversationCount} conversation(s) owned by another workspace.`
          );

          await logAdminAction(
            targetUserId,
            'ACCOUNT_RELINK_BLOCKED',
            'INSTAGRAM_ACCOUNT',
            existingAccount.id,
            {
              igUserId,
              attemptedByUserId: targetUserId,
              currentOwnerUserId: existingAccount.userId,
              conversationCount,
            },
            req.ip
          );

          if (req.accepts('json') && !req.accepts('html')) {
            return res.status(409).json({
              error: 'Account already connected',
              message: 'That Instagram account is already connected to another Codeback account.',
            });
          }
          return res.redirect(`${process.env.FRONTEND_URL}?error=account_already_connected`);
        }

        // No history to lose, so the transfer is allowed — but it is still a
        // change of ownership and is recorded as one.
        await logAdminAction(
          targetUserId,
          'ACCOUNT_RELINK_TRANSFERRED',
          'INSTAGRAM_ACCOUNT',
          existingAccount.id,
          { igUserId, fromUserId: existingAccount.userId, toUserId: targetUserId },
          req.ip
        );
      }

      await prisma.instagramAccount.update({
        // By primary key, not by igUserId — that column is no longer unique.
        where: { id: existingAccount.id },
        data: {
          userId: targetUserId,
          accessToken: encrypt(longTokenData.access_token),
          tokenExpiresAt: tokenExpiresAt,
          tokenStatus: 'VALID',
          connectionStatus: 'CONNECTED',
          disconnectedAt: null,
          igUsername: profile.username || existingAccount.igUsername,
          igName: profile.name || existingAccount.igName,
          igProfilePic: profile.profile_picture_url || existingAccount.igProfilePic,
        },
      });
      user = await prisma.user.findUnique({ where: { id: targetUserId } });
      console.log('[Auth] Reconnected existing account for:', profile.username);
    } else if (currentUserId) {
      // User is logged in and connecting an additional Instagram account
      user = await prisma.user.findUnique({ where: { id: currentUserId } });
      await prisma.instagramAccount.create({
        data: {
          userId: currentUserId,
          igUserId: igUserId,
          igUsername: profile.username,
          igName: profile.name,
          igProfilePic: profile.profile_picture_url,
          accessToken: encrypt(longTokenData.access_token),
          tokenExpiresAt: tokenExpiresAt,
        },
      });
      console.log('[Auth] Linked new account to existing user:', profile.username);
    } else {
      // Create new user + account, plus default AI preferences so the rest of
      // the product has sane data to read from the moment the creator signs up.
      user = await prisma.user.create({
        data: {
          name: profile.name || profile.username,
          instagramAccounts: {
            create: {
              igUserId: igUserId,
              igUsername: profile.username,
              igName: profile.name,
              igProfilePic: profile.profile_picture_url,
              accessToken: encrypt(longTokenData.access_token),
              tokenExpiresAt: tokenExpiresAt,
            },
          },
          preferences: { create: {} },
        },
      });
      console.log('[Auth] Created new user + account for:', profile.username);
    }

    // Step 6: Subscribe this account to webhook events
    try {
      await instagram.subscribeToWebhooks(igUserId, longTokenData.access_token);
      console.log('[Auth] Webhook subscription successful for IG ID:', igUserId);
    } catch (err) {
      // Non-fatal — the account is saved, webhooks can be retried
      console.error('[Auth] Webhook subscription failed:', err.response?.data || err.message);
    }

    // Step 7: Set session cookie so the user is "logged in", on a FRESH
    // session id — completing OAuth is a privilege transition like any login.
    await startAuthenticatedSession(req, { userId: user.id, igUsername: profile.username });

    console.log('[Auth] Login complete. Redirecting to dashboard.');
    res.redirect(`${process.env.FRONTEND_URL}/dashboard`);

  } catch (error) {
    console.error('[Auth] OAuth callback error:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=oauth_failed`);
  }
});

// ============================================
// GET /auth/me
// Return the currently logged-in user's info
// ============================================
// requireAuth, not a hand-rolled session check. The inline version that used
// to live here only tested for the PRESENCE of session.userId, so it silently
// skipped the sessionVersion comparison — meaning a session invalidated by a
// password reset kept working against this route. Same for the two below.
router.get('/me', requireAuth, async (req, res) => {
  const userId = req.userId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        businessProfile: true,
        instagramAccounts: { select: INSTAGRAM_ACCOUNT_PUBLIC_SELECT },
      },
    });

    if (!user) {
      req.session.destroy();
      return res.status(401).json({ error: 'Log in to continue.' });
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      onboardingCompleted: user.onboardingCompleted,
      businessProfile: user.businessProfile,
      instagramAccounts: user.instagramAccounts,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('[Auth] Error fetching user:', error.message);
    res.status(500).json({ error: "Couldn't load your account. Refresh to try again." });
  }
});

// ============================================
// PUT /auth/profile
// Update profile information (name, current/new password)
// ============================================
router.put('/profile', requireAuth, async (req, res) => {
  const userId = req.userId;

  try {
    const { name, currentPassword, newPassword } = req.body || {};

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'Log in to continue.' });
    }

    const updateData = {};

    if (name && typeof name === 'string' && name.trim().length >= 2) {
      updateData.name = name.trim();
    }

    // Password change
    let passwordChanged = false;
    if (newPassword) {
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ error: 'Use at least 6 characters.' });
      }

      // An account with no password must go through POST /auth/set-password,
      // which is the same "prove you hold the session" bar but is explicit
      // about what it does. Silently allowing it here meant any session
      // holding a password-less user's id could set one with no proof of
      // knowledge at all.
      if (!user.passwordHash) {
        return res.status(400).json({
          error: 'This account has no password yet. Set one from your account settings.',
          code: 'USE_SET_PASSWORD',
        });
      }

      if (!currentPassword) {
        return res.status(400).json({ error: 'Enter your current password.' });
      }
      const { valid } = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(400).json({ error: 'That current password is not right.' });
      }

      updateData.passwordHash = await hashPassword(newPassword);
      // Same reasoning as the reset flow: someone changing their password is
      // usually trying to evict somebody. Bumping sessionVersion invalidates
      // every OTHER session on the next request.
      updateData.sessionVersion = { increment: 1 };
      passwordChanged = true;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        businessProfile: true,
        instagramAccounts: { select: INSTAGRAM_ACCOUNT_PUBLIC_SELECT },
      },
    });

    // Keep THIS session valid — the person who just proved they know the old
    // password should not be logged out by their own action — while every
    // other session is now stale. Sockets are dropped and re-established by
    // the client, which is the cheapest way to evict an attacker's live feed.
    if (passwordChanged) {
      req.session.sessionVersion = updatedUser.sessionVersion;
      await saveSession(req).catch(() => {});
      disconnectUserSockets(userId);
      console.log(`[Auth] Password changed for ${userId}; other sessions invalidated.`);
    }

    res.json({
      message: 'Your details were saved',
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    console.error('[Auth] Error updating profile:', error.message);
    res.status(500).json({ error: "Couldn't save your details. Try again." });
  }
});

// ============================================
// DELETE /auth/account
// Permanently delete user account and all data
// ============================================
router.delete('/account', requireAuth, async (req, res) => {
  const userId = req.userId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'Log in to continue.' });
    }

    // Delete user from database (cascades to all user data)
    await prisma.user.delete({
      where: { id: userId },
    });

    disconnectUserSockets(userId);
    console.log(`[Auth] Permanently deleted user account ${userId} (${user.email})`);

    req.session.destroy((err) => {
      if (err) console.error('[Auth] Error destroying session on account delete:', err);
      res.clearCookie('codeback.sid');
      res.json({ message: 'Account deleted' });
    });
  } catch (error) {
    console.error('[Auth] Error deleting account:', error.message);
    res.status(500).json({ error: "Couldn't delete your account. Try again, or contact support." });
  }
});

module.exports = router;
