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
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const instagram = require('../lib/instagram');
const { encrypt } = require('../lib/crypto');
const { disconnectUserSockets } = require('../lib/socket');
const { createRateLimiter } = require('../lib/rateLimit');
const { startAuthenticatedSession, saveSession } = require('../lib/session');
const { logAdminAction } = require('../lib/auditLogger');

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

// Helper to sanitize user object
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

    // Check if user already exists
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return res.status(409).json({ error: 'An account already uses that email address. Log in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
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

    // Set session on a FRESH session id — never the one the client presented.
    await startAuthenticatedSession(req, { userId: user.id, userEmail: user.email });

    console.log(`[Auth] New user registered: ${user.email} (${user.id})`);

    res.status(201).json({
      message: 'Account created',
      user: sanitizeUser(user),
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
        instagramAccounts: {
          select: {
            id: true,
            igUserId: true,
            igUsername: true,
            igName: true,
            connectionStatus: true,
          },
        },
      },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'That email or password is not right.' });
    }

    const isMatch = await bcrypt.compare(String(password), user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'That email or password is not right.' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ error: 'This account is suspended. Contact support.' });
    }

    // Update last seen
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    }).catch(() => {});

    // Set session on a FRESH session id — never the one the client presented.
    await startAuthenticatedSession(req, { userId: user.id, userEmail: user.email });

    console.log(`[Auth] User logged in: ${user.email} (${user.id})`);

    res.json({
      message: 'Logged in',
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({ error: "Couldn't log you in. Try again in a moment." });
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
    const existingAccount = await prisma.instagramAccount.findUnique({
      where: { igUserId: igUserId },
      include: { user: true },
    });

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
        where: { igUserId: igUserId },
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
router.get('/me', async (req, res) => {
  // Identity comes ONLY from the server-side session — never a client-supplied
  // user_id (that was a full authentication bypass).
  const userId = req.session ? req.session.userId : null;

  if (!userId) {
    return res.status(401).json({ error: 'Log in to continue.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        businessProfile: true,
        instagramAccounts: {
          select: {
            id: true,
            igUserId: true,
            igUsername: true,
            igName: true,
            igProfilePic: true,
            tokenExpiresAt: true,
            tokenStatus: true,
            connectionStatus: true,
          },
        },
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
router.put('/profile', async (req, res) => {
  const userId = req.session ? req.session.userId : null;

  if (!userId) {
    return res.status(401).json({ error: 'Log in to continue.' });
  }

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
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Use at least 6 characters.' });
      }

      if (user.passwordHash) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Enter your current password.' });
        }
        const match = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!match) {
          return res.status(400).json({ error: 'That current password is not right.' });
        }
      }

      updateData.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        businessProfile: true,
        instagramAccounts: true,
      },
    });

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
router.delete('/account', async (req, res) => {
  const userId = req.session ? req.session.userId : null;

  if (!userId) {
    return res.status(401).json({ error: 'Log in to continue.' });
  }

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
