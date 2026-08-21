/**
 * Settings routes — creator preferences that personalize AI prioritization
 * and reply tone (spec: "Creator Preferences").
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getOrCreatePreferences, sanitizePreferenceUpdate } = require('../services/preferencesService');
const prisma = require('../lib/prisma');

router.use(requireAuth);

// ============================================
// GET /api/settings/ai
// ============================================
router.get('/ai', async (req, res) => {
  try {
    const preferences = await getOrCreatePreferences(req.userId);
    res.json(preferences);
  } catch (error) {
    console.error('[Settings] Error fetching AI preferences:', error.message);
    res.status(500).json({ error: 'Failed to fetch AI settings' });
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
    res.status(500).json({ error: 'Failed to update AI settings' });
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
    res.status(500).json({ error: 'Failed to fetch auto-reply chats' });
  }
});

module.exports = router;
