/**
 * Dashboard routes — the Creator Home Dashboard and "While You Were Away"
 * experience. Every number here comes from the database; nothing is
 * hard-coded/demo data.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const AWAY_THRESHOLD_MS = 10 * 60 * 1000; // only show "while you were away" if gone >10 min

// ============================================
// GET /api/dashboard/summary
// ============================================
router.get('/summary', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const accounts = await prisma.instagramAccount.findMany({
      where: { userId: req.userId },
      select: { id: true, igUsername: true, connectionStatus: true, tokenStatus: true },
    });
    const accountIds = accounts.map((a) => a.id);

    const previousLastSeenAt = user.lastSeenAt;
    const since = previousLastSeenAt || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    const conversationScope = { instagramAccountId: { in: accountIds } };

    const [
      totalDmsReviewed,
      attentionQueueCount,
      hotLeadsCount,
      brandDealCount,
      collaborationCount,
      customerCount,
      otherImportantCount,
      newMessagesSinceAway,
      categoryBreakdownSinceAway,
      unreadCount,
    ] = await Promise.all([
      prisma.message.count({ where: { conversation: conversationScope, direction: 'inbound', aiStatus: 'completed' } }),
      prisma.conversation.count({
        where: {
          ...conversationScope,
          OR: [
            { needsAttention: true },
            { needsHuman: true },
            { priority: 'critical', unread: true },
          ],
        },
      }),
      prisma.conversation.count({
        where: {
          ...conversationScope,
          OR: [
            { category: 'hot_lead' },
            { customerType: 'hot_lead' },
            { purchaseIntent: { gte: 75 } },
          ],
        },
      }),
      prisma.conversation.count({ where: { ...conversationScope, category: 'brand_deal' } }),
      prisma.conversation.count({ where: { ...conversationScope, category: { in: ['collaboration', 'brand_deal'] } } }),
      prisma.conversation.count({ where: { ...conversationScope, category: 'customer' } }),
      prisma.conversation.count({
        where: {
          ...conversationScope,
          needsAttention: true,
          category: { notIn: ['brand_deal', 'collaboration', 'customer'] },
        },
      }),
      prisma.message.count({ where: { conversation: conversationScope, direction: 'inbound', createdAt: { gte: since } } }),
      prisma.message.groupBy({
        by: ['category'],
        where: { conversation: conversationScope, direction: 'inbound', createdAt: { gte: since } },
        _count: { id: true },
      }),
      prisma.conversation.count({ where: { ...conversationScope, unread: true } }),
    ]);

    const categoryCounts = Object.fromEntries(categoryBreakdownSinceAway.map((row) => [row.category || 'other', row._count.id]));

    const needsAttentionSinceAway = await prisma.conversation.count({
      where: {
        ...conversationScope,
        updatedAt: { gte: since },
        OR: [
          { needsAttention: true },
          { needsHuman: true },
          { priority: 'critical', unread: true },
        ],
      },
    });

    const connectionProblems = accounts.filter((a) => a.connectionStatus === 'DISCONNECTED' || a.tokenStatus === 'NEEDS_RECONNECT');

    // Update lastSeenAt for next time — after computing the "since" window.
    await prisma.user.update({ where: { id: req.userId }, data: { lastSeenAt: now } });

    const showWhileYouWereAway = Boolean(previousLastSeenAt) && now - new Date(previousLastSeenAt).getTime() > AWAY_THRESHOLD_MS && newMessagesSinceAway > 0;

    res.json({
      greetingName: user.name,
      totalDmsReviewed,
      attentionQueueCount,
      unreadCount,
      breakdown: {
        hotLeads: hotLeadsCount,
        brandDeals: brandDealCount,
        collaborations: collaborationCount,
        customers: customerCount,
        otherImportant: otherImportantCount,
      },
      connectionProblems,
      whileYouWereAway: showWhileYouWereAway
        ? {
            since: previousLastSeenAt,
            newMessages: newMessagesSinceAway,
            needsAttention: needsAttentionSinceAway,
            categoryCounts,
          }
        : null,
    });
  } catch (error) {
    console.error('[Dashboard] Error building summary:', error.message);
    res.status(500).json({ error: 'Failed to load dashboard summary' });
  }
});

module.exports = router;
