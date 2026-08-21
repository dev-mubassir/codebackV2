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
const prisma = require('../lib/prisma');
const instagram = require('../lib/instagram');
const { encrypt } = require('../lib/crypto');

const isProduction = process.env.NODE_ENV === 'production';

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
  let userId = req.session ? req.session.userId : null;

  // SECURITY: never trust a client-supplied user_id to authenticate as
  // another account outside of local development.
  if (!userId && !isProduction && req.query && req.query.user_id) {
    console.warn('[Auth] Using query-supplied user_id fallback (non-production only). Never trust this in production.');
    userId = req.query.user_id;
  }

  // NOTE: The old dev-mode fallback that auto-picked a USER-role user has
  // been removed. Unauthenticated requests should return 401 consistently.

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
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
      instagramAccounts: user.instagramAccounts,
      subscription: user.subscription,
    });
  } catch (error) {
    console.error('[Auth] Error fetching user:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// POST /auth/logout
// Destroy session and log out
// ============================================
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('codeback.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

module.exports = router;
