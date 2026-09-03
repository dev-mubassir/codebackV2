/**
 * Subscription & usage routes — provider-agnostic billing abstraction.
 * Mounted at /api, exposing GET /api/subscription and GET /api/usage.
 *
 * No payment provider is wired up (none existed in the original codebase),
 * but the data model and API are in place so a provider (Stripe, Paddle,
 * etc.) can be plugged in later without redesigning the product. See
 * services/billingService.js for the seam where that integration belongs.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const billingService = require('../services/billingService');

router.use(requireAuth);

// ============================================
// GET /api/subscription
// ============================================
router.get('/subscription', async (req, res) => {
  try {
    const subscription = await billingService.getOrCreateSubscription(req.userId);
    res.json(subscription);
  } catch (error) {
    console.error('[Subscription] Error fetching subscription:', error.message);
    res.status(500).json({ error: "Couldn't load your plan. Refresh to try again." });
  }
});

// ============================================
// GET /api/usage
// Usage in the last 30 days + all-time totals, grouped by event type.
// ============================================
router.get('/usage', async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [recent, allTime] = await Promise.all([
      prisma.usageEvent.groupBy({
        by: ['type'],
        where: { userId: req.userId, createdAt: { gte: since } },
        _sum: { quantity: true },
      }),
      prisma.usageEvent.groupBy({
        by: ['type'],
        where: { userId: req.userId },
        _sum: { quantity: true },
      }),
    ]);

    const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.type, r._sum.quantity || 0]));

    res.json({
      last30Days: toMap(recent),
      allTime: toMap(allTime),
    });
  } catch (error) {
    console.error('[Subscription] Error fetching usage:', error.message);
    res.status(500).json({ error: "Couldn't load your usage. Refresh to try again." });
  }
});

module.exports = router;
