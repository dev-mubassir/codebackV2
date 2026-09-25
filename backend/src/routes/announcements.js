/**
 * GET /api/announcements/active — the banner(s) the customer app shows
 * (Gate 7). Public on purpose: an announcement is by definition for
 * everyone, and it must reach a signed-out visitor during an incident too.
 * Returns only what is live right now; plain text only.
 */

const express = require('express');
const prisma = require('../lib/prisma');

const router = express.Router();

router.get('/active', async (req, res) => {
  try {
    const now = new Date();
    const rows = await prisma.announcement.findMany({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { startsAt: 'desc' },
      take: 3,
      select: { id: true, message: true, type: true, endsAt: true },
    });
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(rows);
  } catch (error) {
    console.error('[Announcements] Could not load announcements:', error.message);
    res.json([]); // a banner failing must never break the app
  }
});

module.exports = router;
