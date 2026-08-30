const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getOrCreatePreferences, sanitizePreferenceUpdate } = require('../services/preferencesService');
const { getOrCreateBusinessProfile, sanitizeBusinessProfileUpdate } = require('../services/businessProfileService');
const prisma = require('../lib/prisma');

router.use(requireAuth);

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

    if (displayName && typeof displayName === 'string') {
      await prisma.user.update({
        where: { id: req.userId },
        data: { name: displayName.trim(), onboardingCompleted: true },
      }).catch(() => {});
    } else {
      await prisma.user.update({
        where: { id: req.userId },
        data: { onboardingCompleted: true },
      }).catch(() => {});
    }

    await getOrCreateBusinessProfile(req.userId);
    const sanitized = sanitizeBusinessProfileUpdate(profileData);

    const updatedProfile = await prisma.businessProfile.update({
      where: { userId: req.userId },
      data: sanitized,
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
