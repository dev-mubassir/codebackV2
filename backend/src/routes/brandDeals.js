/**
 * Brand deal routes. Strictly
 * tenant-scoped: every query filters by the logged-in user's own userId.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requireWorkspace } = require('../middleware/authorize');
const { BRAND_DEAL_STATUSES } = require('../lib/constants');

// The canonical chain. requireWorkspace resolves the caller's owned
// Instagram account ids once and attaches them, so handlers scope on
// req.ownedAccountIds rather than each re-deriving ownership.
router.use(requireAuth);
router.use(requireWorkspace);

// ============================================
// GET /api/brand-deals
// ============================================
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const whereClause = { userId: req.userId };
    if (status && BRAND_DEAL_STATUSES.includes(status)) {
      whereClause.status = status;
    }

    const brandDeals = await prisma.brandDeal.findMany({
      where: whereClause,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: {
        conversation: {
          select: {
            id: true,
            lastMessageAt: true,
            contact: { select: { id: true, username: true, name: true, profilePicUrl: true } },
          },
        },
        instagramAccount: { select: { id: true, igUsername: true } },
      },
    });

    res.json(brandDeals);
  } catch (error) {
    console.error('[BrandDeals] Error listing brand deals:', error.message);
    res.status(500).json({ error: "Couldn't load your brand deals. Refresh to try again." });
  }
});

// ============================================
// GET /api/brand-deals/:id
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const brandDeal = await prisma.brandDeal.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: {
        conversation: {
          include: { contact: true },
        },
        instagramAccount: { select: { id: true, igUsername: true } },
      },
    });

    if (!brandDeal) return res.status(404).json({ error: 'That brand deal no longer exists.' });
    res.json(brandDeal);
  } catch (error) {
    console.error('[BrandDeals] Error fetching brand deal:', error.message);
    res.status(500).json({ error: "Couldn't load that brand deal. Try again." });
  }
});

// ============================================
// PATCH /api/brand-deals/:id
// Update the deal's pipeline status (new/contacted/negotiating/confirmed/declined/expired)
// ============================================
router.patch('/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status || !BRAND_DEAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${BRAND_DEAL_STATUSES.join(', ')}` });
    }

    const existing = await prisma.brandDeal.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) return res.status(404).json({ error: 'That brand deal no longer exists.' });

    const updated = await prisma.brandDeal.update({ where: { id: existing.id }, data: { status } });
    res.json(updated);
  } catch (error) {
    console.error('[BrandDeals] Error updating brand deal:', error.message);
    res.status(500).json({ error: "Couldn't update that brand deal. Try again." });
  }
});

module.exports = router;
