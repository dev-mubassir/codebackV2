/**
 * Analytics routes — Real-world Instagram DM Sales & Business Intelligence.
 * 
 * Tracks:
 * 1. Total Inbound DMs (with interactive time-series sparkline)
 * 2. Hot Leads & Commercial Inquiries (with interactive time-series sparkline)
 * 3. Needs Attention & Important DMs
 * 4. Brand Deals & Sponsorship Collaborations
 * 5. AI Auto-Replied & Resolved Inquiries
 * 6. Spam & Security Threats Blocked
 * 7. Category-Adaptive Intelligence Breakdown tailored to the user's active business type
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { getIO } = require('../lib/socket');
const { getAIStats } = require('../services/aiService');

router.use(requireAuth);

// Helper to format numbers (e.g. 2030 -> "2.03k", 142 -> "142")
function formatMetricNumber(num) {
  if (num === null || num === undefined) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(2).replace(/\.00$/, '') + 'k';
  return String(num);
}

// Helper to compute percentage change
function computePercentChange(current, previous) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  const diff = ((current - previous) / previous) * 100;
  return Number(diff.toFixed(1));
}

// Parse businessTypes JSON or comma-separated string
function parseBusinessTypes(types, primary = 'other') {
  if (Array.isArray(types) && types.length > 0) return types;
  if (typeof types === 'string' && types.trim()) {
    try {
      const parsed = JSON.parse(types);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      const split = types.split(',').map((s) => s.trim()).filter(Boolean);
      if (split.length > 0) return split;
    }
  }
  return [primary || 'other'];
}

// ============================================
// GET /api/analytics/summary
// Query parameters: ?timeRange=24h | 7d | 30d
// ============================================
router.get('/summary', async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '24h';
    const now = new Date();

    // Determine time windows and bucket configuration
    let windowMs = 24 * 60 * 60 * 1000;
    let numBuckets = 24; // 24 1-hour buckets for 24h
    if (timeRange === '7d') {
      windowMs = 7 * 24 * 60 * 60 * 1000;
      numBuckets = 14; // 14 12-hour buckets for 7d
    } else if (timeRange === '30d') {
      windowMs = 30 * 24 * 60 * 60 * 1000;
      numBuckets = 30; // 30 1-day buckets for 30d
    }

    const currentSince = new Date(now.getTime() - windowMs);
    const previousSince = new Date(now.getTime() - 2 * windowMs);
    const bucketDurationMs = windowMs / numBuckets;

    // Get user and their business profile
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { businessProfile: true },
    });

    const businessProfile = user?.businessProfile || {};
    const primaryCategory = businessProfile.primaryCategory || 'video_editor';
    const businessTypes = parseBusinessTypes(businessProfile.businessTypes, primaryCategory);

    // Get user's owned accounts
    const userAccounts = await prisma.instagramAccount.findMany({
      where: { userId: req.userId },
      select: { id: true, connectionStatus: true, tokenStatus: true },
    });
    const accountIds = userAccounts.map((a) => a.id);
    const connectedAccountsCount = userAccounts.filter((a) => a.connectionStatus === 'CONNECTED').length;

    const conversationScope = { instagramAccountId: { in: accountIds } };

    // Fetch messages & conversations in current and previous window
    const [
      currentMessages,
      prevMessagesCount,
      totalAllTimeMessages,
      hotLeadConversations,
      prevHotLeadCount,
      needsAttentionCount,
      brandDealsCount,
      aiHandledMessagesCount,
      spamBlockedCount,
      allCurrentConversations,
    ] = await Promise.all([
      // 1. Current Inbound Messages
      prisma.message.findMany({
        where: {
          conversation: conversationScope,
          direction: 'inbound',
          createdAt: { gte: currentSince },
        },
        select: { id: true, createdAt: true, aiStatus: true, category: true, suggestedReply: true },
      }),
      // 2. Previous Window Inbound Messages
      prisma.message.count({
        where: {
          conversation: conversationScope,
          direction: 'inbound',
          createdAt: { gte: previousSince, lt: currentSince },
        },
      }),
      // 3. All-time Inbound Messages
      prisma.message.count({
        where: {
          conversation: conversationScope,
          direction: 'inbound',
        },
      }),
      // 4. Hot Leads in Current Window
      prisma.conversation.findMany({
        where: {
          ...conversationScope,
          lastMessageAt: { gte: currentSince },
          OR: [
            { category: 'hot_lead' },
            { customerType: 'hot_lead' },
            { purchaseIntent: { gte: 75 } },
            { category: 'pricing_inquiry' },
          ],
        },
        select: { id: true, lastMessageAt: true, purchaseIntent: true, leadQuality: true },
      }),
      // 5. Hot Leads in Previous Window
      prisma.conversation.count({
        where: {
          ...conversationScope,
          lastMessageAt: { gte: previousSince, lt: currentSince },
          OR: [
            { category: 'hot_lead' },
            { customerType: 'hot_lead' },
            { purchaseIntent: { gte: 75 } },
            { category: 'pricing_inquiry' },
          ],
        },
      }),
      // 6. Needs Attention / Important
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
      // 7. Brand Deals & Collaborations
      prisma.conversation.count({
        where: {
          ...conversationScope,
          category: { in: ['brand_deal', 'collaboration'] },
        },
      }),
      // 8. AI Handled & Auto-Replied
      prisma.message.count({
        where: {
          conversation: conversationScope,
          OR: [
            { aiStatus: 'completed' },
            { direction: 'outbound', suggestedReply: { not: null } },
          ],
          createdAt: { gte: currentSince },
        },
      }),
      // 9. Spam & Threats Blocked
      prisma.conversation.count({
        where: {
          ...conversationScope,
          category: { in: ['spam', 'scam', 'abusive'] },
        },
      }),
      // 10. All Active Conversations in Window for category breakdown
      prisma.conversation.findMany({
        where: {
          ...conversationScope,
          lastMessageAt: { gte: currentSince },
        },
        select: {
          id: true,
          category: true,
          intent: true,
          customerType: true,
          purchaseIntent: true,
          leadQuality: true,
        },
      }),
    ]);

    // Generate human-readable time labels for each bucket
    const bucketLabels = [];
    for (let i = 0; i < numBuckets; i++) {
      const bucketTime = new Date(currentSince.getTime() + i * bucketDurationMs);
      if (timeRange === '24h') {
        bucketLabels.push(bucketTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      } else {
        bucketLabels.push(bucketTime.toLocaleDateString([], { month: 'short', day: 'numeric' }));
      }
    }

    // Bucket Total Inbound DMs into time series
    const messageBuckets = new Array(numBuckets).fill(0);
    currentMessages.forEach((msg) => {
      const offsetMs = msg.createdAt.getTime() - currentSince.getTime();
      let bucketIdx = Math.floor(offsetMs / bucketDurationMs);
      if (bucketIdx < 0) bucketIdx = 0;
      if (bucketIdx >= numBuckets) bucketIdx = numBuckets - 1;
      messageBuckets[bucketIdx] += 1;
    });

    // Bucket Hot Leads into time series
    const hotLeadBuckets = new Array(numBuckets).fill(0);
    hotLeadConversations.forEach((conv) => {
      if (!conv.lastMessageAt) return;
      const offsetMs = new Date(conv.lastMessageAt).getTime() - currentSince.getTime();
      let bucketIdx = Math.floor(offsetMs / bucketDurationMs);
      if (bucketIdx < 0) bucketIdx = 0;
      if (bucketIdx >= numBuckets) bucketIdx = numBuckets - 1;
      hotLeadBuckets[bucketIdx] += 1;
    });

    const currentTotalDms = currentMessages.length;
    const currentHotLeads = hotLeadConversations.length;

    const dmsChange = computePercentChange(currentTotalDms, prevMessagesCount);
    const hotLeadsChange = computePercentChange(currentHotLeads, prevHotLeadCount);

    // ============================================
    // Category-Specific Business Intelligence Adaptation
    // ============================================
    let categoryMetrics = [];
    let categoryTitle = 'Business Intelligence';

    // Count categories across conversations
    const countCategory = (cats) =>
      allCurrentConversations.filter((c) => cats.includes(c.category) || cats.includes(c.intent)).length;

    const pricingCount = countCategory(['pricing_inquiry']);
    const serviceProductCount = countCategory(['service_inquiry', 'product_inquiry', 'lead']);
    const deliveryTurnaroundCount = countCategory(['delivery_inquiry', 'availability_inquiry']);
    const dealsCount = countCategory(['brand_deal', 'collaboration']);
    const supportCount = countCategory(['support_request']);
    const spamCount = countCategory(['spam', 'scam', 'abusive']);
    const generalCount = countCategory(['general_question']);

    if (['video_editor', 'photo_editor', 'graphic_designer'].includes(primaryCategory)) {
      categoryTitle = primaryCategory === 'video_editor' ? '🎬 Video Editor DM Intelligence' : '🎨 Creative & Design Intelligence';
      categoryMetrics = [
        { label: 'Reel & Edit Inquiries', value: serviceProductCount, icon: '🎬', desc: 'Project briefs & editing requests' },
        { label: 'Rates & Pricing Checks', value: pricingCount, icon: '💰', desc: 'Asking for rates & bundle packages' },
        { label: 'Turnaround & Revisions', value: deliveryTurnaroundCount, icon: '⏱️', desc: 'Delivery timeline & revisions' },
        { label: 'Hot Ready Buyers', value: currentHotLeads, icon: '🔥', desc: 'Commercial leads with high intent' },
      ];
    } else if (['product_seller', 'used_devices', 'clothing', 'ecommerce'].includes(primaryCategory)) {
      categoryTitle = primaryCategory === 'used_devices' ? '💻 Used Devices Sales Intelligence' : '📦 Product & Store Sales Intelligence';
      categoryMetrics = [
        { label: 'Stock & Model Inquiries', value: serviceProductCount, icon: '📦', desc: 'Product specs, condition & sizes' },
        { label: 'Price & Offer Requests', value: pricingCount, icon: '🏷️', desc: 'Price checks, discounts & deals' },
        { label: 'Shipping & Delivery', value: deliveryTurnaroundCount, icon: '🚚', desc: 'Courier timeline & coverage' },
        { label: 'Ready to Purchase', value: currentHotLeads, icon: '🔥', desc: 'Immediate buying intent leads' },
      ];
    } else if (primaryCategory === 'creator') {
      categoryTitle = '⭐ Creator Sponsorship & Deal Intelligence';
      categoryMetrics = [
        { label: 'Paid Brand Deals', value: dealsCount, icon: '💼', desc: 'Sponsorship offers & campaigns' },
        { label: 'Rate Kit & Inquiries', value: pricingCount, icon: '📊', desc: 'Sponsorship rates & media kit' },
        { label: 'Collabs & Gifting', value: countCategory(['collaboration']), icon: '🤝', desc: 'Barter & cross-promotions' },
        { label: 'High Priority Deals', value: currentHotLeads, icon: '🔥', desc: 'High budget commercial sponsors' },
      ];
    } else {
      categoryTitle = '🏢 Service & Client Lead Intelligence';
      categoryMetrics = [
        { label: 'Client Inquiries', value: serviceProductCount, icon: '💼', desc: 'Service & consultation requests' },
        { label: 'Quote & Pricing Requests', value: pricingCount, icon: '💰', desc: 'Asking for proposals & rates' },
        { label: 'Delivery & Milestone Qs', value: deliveryTurnaroundCount, icon: '⏱️', desc: 'Service timelines & policies' },
        { label: 'Hot Commercial Leads', value: currentHotLeads, icon: '🔥', desc: 'Qualified prospective clients' },
      ];
    }

    // ============================================
    // Overall Intent Distribution (for horizontal segmented visualizer)
    // ============================================
    const totalCategorized = Math.max(
      1,
      currentHotLeads + pricingCount + serviceProductCount + dealsCount + supportCount + spamCount + generalCount
    );

    const intentDistribution = [
      { key: 'hot_leads', label: '🔥 Hot Leads', count: currentHotLeads, pct: Math.round((currentHotLeads / totalCategorized) * 100), color: '#f59e0b' },
      { key: 'pricing', label: '💰 Pricing & Rates', count: pricingCount, pct: Math.round((pricingCount / totalCategorized) * 100), color: '#10b981' },
      { key: 'services_products', label: '📦 Services & Products', count: serviceProductCount, pct: Math.round((serviceProductCount / totalCategorized) * 100), color: '#3b82f6' },
      { key: 'deals', label: '🤝 Deals & Collabs', count: dealsCount, pct: Math.round((dealsCount / totalCategorized) * 100), color: '#8b5cf6' },
      { key: 'support', label: '🎧 Support & Delivery', count: supportCount + deliveryTurnaroundCount, pct: Math.round(((supportCount + deliveryTurnaroundCount) / totalCategorized) * 100), color: '#06b6d4' },
      { key: 'spam', label: '🚫 Spam Filtered', count: spamCount, pct: Math.round((spamCount / totalCategorized) * 100), color: '#64748b' },
    ];

    res.json({
      timeRange,
      primaryCategory,
      businessTypes,
      totalDms: {
        value: currentTotalDms,
        formatted: formatMetricNumber(currentTotalDms),
        allTime: totalAllTimeMessages,
        changePercent: dmsChange,
        series: messageBuckets,
        labels: bucketLabels,
      },
      hotLeads: {
        value: currentHotLeads,
        formatted: formatMetricNumber(currentHotLeads),
        changePercent: hotLeadsChange,
        series: hotLeadBuckets,
        labels: bucketLabels,
      },
      needsAttention: {
        value: needsAttentionCount,
        formatted: String(needsAttentionCount),
      },
      brandDeals: {
        value: brandDealsCount,
        formatted: String(brandDealsCount),
      },
      aiHandled: {
        value: aiHandledMessagesCount,
        formatted: String(aiHandledMessagesCount),
      },
      spamBlocked: {
        value: spamBlockedCount,
        formatted: String(spamBlockedCount),
      },
      categoryTitle,
      categoryMetrics,
      intentDistribution,
    });
  } catch (error) {
    console.error('[Analytics API] Error generating summary:', error.message);
    res.status(500).json({ error: 'Failed to generate analytics summary' });
  }
});

module.exports = router;
