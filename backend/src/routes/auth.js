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
const router = express.Router();
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const instagram = require('../lib/instagram');
const { encrypt } = require('../lib/crypto');
const { disconnectUserSockets } = require('../lib/socket');
const { createRateLimiter } = require('../lib/rateLimit');

// Throttle credential endpoints to blunt brute-force / credential-stuffing.
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please try again in a few minutes.',
});
const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many accounts created from this IP. Please try again later.',
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
      return res.status(400).json({ error: 'Please enter a valid full name (at least 2 characters)' });
    }

    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
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
            autoReplyMode: 'smart',
          },
        },
        preferences: { create: {} },
        subscription: {
          create: {
            plan: 'free',
            status: 'trial',
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        },
      },
      include: {
        businessProfile: true,
        subscription: true,
      },
    });

    // Set session
    req.session.userId = user.id;
    req.session.userEmail = user.email;

    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    console.log(`[Auth] New user registered: ${user.email} (${user.id})`);

    res.status(201).json({
      message: 'Account created successfully',
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('[Auth] Registration error:', error.message);
    res.status(500).json({ error: 'Failed to create account. Please try again.' });
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
      return res.status(400).json({ error: 'Email and password are required' });
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
        subscription: true,
      },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(String(password), user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.isSuspended) {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
    }

    // Update last seen
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    }).catch(() => {});

    // Set session
    req.session.userId = user.id;
    req.session.userEmail = user.email;

    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    console.log(`[Auth] User logged in: ${user.email} (${user.id})`);

    res.json({
      message: 'Logged in successfully',
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({ error: 'Failed to log in. Please try again.' });
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
      return res.json({ message: 'Logged out successfully' });
    });
  } else {
    res.clearCookie('codeback.sid');
    return res.json({ message: 'Logged out successfully' });
  }
});

// ============================================
// GET /auth/instagram
// Redirect user to Instagram OAuth consent screen
// ============================================
router.get('/instagram', (req, res) => {
  const authUrl = instagram.getAuthorizationUrl(
    process.env.INSTAGRAM_APP_ID,
    process.env.REDIRECT_URI
  );

  console.log('[Auth] Redirecting to Instagram OAuth:', authUrl);
  res.redirect(authUrl);
});

// ============================================
// GET /auth/instagram/callback
// Handle the OAuth callback from Instagram
// ============================================
router.get('/instagram/callback', async (req, res) => {
  try {
    const { code } = req.query;

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

      // FIX 3: If re-linking to a different user, check for existing BrandDeal rows tied to this account
      if (targetUserId !== existingAccount.userId) {
        const existingDealsCount = await prisma.brandDeal.count({
          where: {
            instagramAccountId: existingAccount.id,
            userId: { not: targetUserId },
          },
        });

        if (existingDealsCount > 0) {
          console.warn(
            `[Auth] ⚠️ Re-link BLOCKED: Instagram account @${existingAccount.igUsername} (${igUserId}) has ${existingDealsCount} BrandDeal records owned by User ${existingAccount.userId}. Cannot transfer ownership to User ${targetUserId} automatically.`
          );
          if (req.accepts('json') && !req.accepts('html')) {
            return res.status(409).json({
              error: 'Account re-link conflict',
              message: 'This Instagram account has existing brand deal history under a different user. Re-linking is blocked and requires manual administrator review.',
            });
          }
          return res.redirect(`${process.env.FRONTEND_URL}?error=account_conflict_brand_deals`);
        }
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
      // Create new user + account, plus a trial subscription and default AI
      // preferences so the rest of the product has sane data to read from
      // the moment the creator signs up.
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
          subscription: {
            create: {
              plan: 'free',
              status: 'trial',
              trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
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

    // Step 7: Set session cookie so the user is "logged in"
    req.session.userId = user.id;
    req.session.igUsername = profile.username;

    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

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
    return res.status(401).json({ error: 'Not authenticated' });
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
        subscription: true,
      },
    });

    if (!user) {
      req.session.destroy();
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      onboardingCompleted: user.onboardingCompleted,
      businessProfile: user.businessProfile,
      instagramAccounts: user.instagramAccounts,
      subscription: user.subscription,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('[Auth] Error fetching user:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// PUT /auth/profile
// Update profile information (name, current/new password)
// ============================================
router.put('/profile', async (req, res) => {
  const userId = req.session ? req.session.userId : null;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { name, currentPassword, newPassword } = req.body || {};

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updateData = {};

    if (name && typeof name === 'string' && name.trim().length >= 2) {
      updateData.name = name.trim();
    }

    // Password change
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long' });
      }

      if (user.passwordHash) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Please enter your current password' });
        }
        const match = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!match) {
          return res.status(400).json({ error: 'Incorrect current password' });
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
        subscription: true,
      },
    });

    res.json({
      message: 'Profile updated successfully',
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    console.error('[Auth] Error updating profile:', error.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ============================================
// DELETE /auth/account
// Permanently delete user account and all data
// ============================================
router.delete('/account', async (req, res) => {
  const userId = req.session ? req.session.userId : null;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
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
      res.json({ message: 'Account permanently deleted' });
    });
  } catch (error) {
    console.error('[Auth] Error deleting account:', error.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
