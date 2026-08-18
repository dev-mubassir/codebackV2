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

module.exports = router;
