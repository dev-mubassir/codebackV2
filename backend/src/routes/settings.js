const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireWorkspace } = require('../middleware/authorize');
const { getOrCreatePreferences, sanitizePreferenceUpdate } = require('../services/preferencesService');
const { getOrCreateBusinessProfile, sanitizeBusinessProfileUpdate } = require('../services/businessProfileService');
const prisma = require('../lib/prisma');

// The canonical chain. requireWorkspace resolves the caller's owned
// Instagram account ids once and attaches them, so handlers scope on
// req.ownedAccountIds rather than each re-deriving ownership.
router.use(requireAuth);
router.use(requireWorkspace);

// ============================================
// GET /api/settings/business-profile (or /api/business-profile)
// ============================================
router.get('/business-profile', async (req, res) => {
  try {
    const profile = await getOrCreateBusinessProfile(req.userId);
    res.json(profile);
  } catch (error) {
    console.error('[Settings] Error fetching business profile:', error.message);
    res.status(500).json({ error: "Couldn't load your business profile. Refresh to try again." });
  }
});

// ============================================
// PUT /api/settings/business-profile (or /api/business-profile)
// ============================================
router.put('/business-profile', async (req, res) => {
  try {
    await getOrCreateBusinessProfile(req.userId);
    const update = sanitizeBusinessProfileUpdate(req.body || {});

    const updated = await prisma.businessProfile.update({
      where: { userId: req.userId },
      data: update,
    });

    res.json(updated);
  } catch (error) {
    console.error('[Settings] Error updating business profile:', error.message);
    res.status(500).json({ error: "Couldn't save your business profile. Try again." });
  }
});

// ============================================
// GET /api/onboarding
// Fetch onboarding state and business profile
// ============================================
router.get('/onboarding', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true, onboardingCompleted: true },
    });
    const profile = await getOrCreateBusinessProfile(req.userId);

    res.json({
      user,
      onboardingCompleted: user?.onboardingCompleted || false,
      businessProfile: profile,
    });
  } catch (error) {
    console.error('[Onboarding] Error fetching onboarding state:', error.message);
    res.status(500).json({ error: "Couldn't load your setup. Refresh to try again." });
  }
});

// ============================================
// PUT /api/onboarding
// Save onboarding data and mark completed
// ============================================
router.put('/onboarding', async (req, res) => {
  try {
    const { displayName, ...profileData } = req.body || {};

    // ORDER MATTERS, AND SO DOES THE ABSENCE OF .catch().
    //
    // This used to set onboardingCompleted = true FIRST, in both branches,
    // with `.catch(() => {})` on each. If the profile write then failed, the
    // account was flagged complete with nothing stored — and nothing ever sent
    // it back, because every guard in the product checks only the flag. The
    // user (or a Meta reviewer) landed on a dashboard driven by an empty
    // business profile, with no route back to setup.
    //
    // So: profile first, flag second, and a failure anywhere is a 500 that
    // leaves the flag false. The client keeps the user on the wizard with
    // their input intact and lets them retry.
    await getOrCreateBusinessProfile(req.userId);
    const sanitized = sanitizeBusinessProfileUpdate(profileData);

    const updatedProfile = await prisma.businessProfile.update({
      where: { userId: req.userId },
      data: sanitized,
    });

    const userUpdate = { onboardingCompleted: true };
    if (displayName && typeof displayName === 'string') {
      userUpdate.name = displayName.trim();
    }
    await prisma.user.update({
      where: { id: req.userId },
      data: userUpdate,
    });

    res.json({
      message: 'Setup complete',
      onboardingCompleted: true,
      businessProfile: updatedProfile,
    });
  } catch (error) {
    console.error('[Onboarding] Error saving onboarding data:', error.message);
    res.status(500).json({ error: "Couldn't save your business details. Try again." });
  }
});

// ============================================
// GET /api/settings/ai
// ============================================
router.get('/ai', async (req, res) => {
  try {
    const preferences = await getOrCreatePreferences(req.userId);
    res.json(preferences);
  } catch (error) {
    console.error('[Settings] Error fetching AI preferences:', error.message);
    res.status(500).json({ error: "Couldn't load your reply settings. Refresh to try again." });
  }
});

// ============================================
// PUT /api/settings/ai
// ============================================
router.put('/ai', async (req, res) => {
  try {
    await getOrCreatePreferences(req.userId); // ensure a row exists
    const update = sanitizePreferenceUpdate(req.body || {});

    const updated = await prisma.creatorPreference.update({
      where: { userId: req.userId },
      data: update,
    });

    res.json(updated);
  } catch (error) {
    console.error('[Settings] Error updating AI preferences:', error.message);
    res.status(500).json({ error: "Couldn't save your reply settings. Try again." });
  }
});

// ============================================
// GET /api/settings/auto-reply-chats
// List all conversations and their auto-reply status for the Settings page
// ============================================
router.get('/auto-reply-chats', async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { instagramAccount: { userId: req.userId } },
      select: {
        id: true,
        category: true,
        priority: true,
        autoReplyEnabled: true,
        autoReplyPrompt: true,
        lastMessage: true,
        lastMessageAt: true,
        contact: {
          select: {
            id: true,
            username: true,
            name: true,
            profilePicUrl: true,
          },
        },
        instagramAccount: {
          select: {
            id: true,
            igUsername: true,
          },
        },
      },
      orderBy: [{ autoReplyEnabled: 'desc' }, { lastMessageAt: 'desc' }],
    });

    res.json(conversations);
  } catch (error) {
    console.error('[Settings] Error fetching auto-reply chats:', error.message);
    res.status(500).json({ error: "Couldn't load your conversations. Refresh to try again." });
  }
});

module.exports = router;
