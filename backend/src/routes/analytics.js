/**
 * Analytics routes — the numbers behind the dashboard's Analytics panel.
 *
 * Everything here is scoped to the accounts the requesting user owns, and
 * everything except `needsAttention` is scoped to the selected date range.
 * `needsAttention` is deliberately all-time: it is the live queue of open
 * conversations waiting on the user, not an activity count.
 *
 * Returns:
 * 1. totalDms        — inbound messages in the window, with a sparkline
 * 2. hotLeads        — conversations with strong buying intent, with a sparkline
 * 3. needsAttention  — open conversations flagged for the user (all time)
 * 4. brandDeals      — sponsorship and collaboration conversations in the window
 * 5. autoRepliesSent — replies actually sent on the user's behalf in the window
 * 6. spamBlocked     — spam and scam conversations in the window
 * 7. categoryMetrics — a breakdown matched to the user's business profile
 *
 * Display strings (labels, descriptions) are NOT built here. This endpoint
 * returns keys and counts; frontend/src/content/copy.js decides the wording.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requireWorkspace } = require('../middleware/authorize');
const { getIO } = require('../lib/socket');
const { getAIStats } = require('../services/aiService');

// The canonical chain. requireWorkspace resolves the caller's owned
// Instagram account ids once and attaches them, so handlers scope on
// req.ownedAccountIds rather than each re-deriving ownership.
router.use(requireAuth);
router.use(requireWorkspace);

// Helper to format numbers (e.g. 2030 -> "2.03k", 142 -> "142")
function formatMetricNumber(num) {
  if (num === null || num === undefined) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(2).replace(/\.00$/, '') + 'k';
  return String(num);
}

// Helper to compute percentage change.
//
// Returns null when the previous window was empty. A change from 0 to any
// number has no percentage — reporting it as "+100%" made a first-ever
// message look like a doubling. The UI hides the badge when this is null.
function computePercentChange(current, previous) {
  if (!previous) return null;
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
      autoRepliesSentCount,
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
      // 6. Needs your reply — the live queue, deliberately all-time
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
      // 7. Brand deals and collaborations in the window.
      //    Was an all-time count sitting under a "Last 24 hours" selector, so
      //    the number never moved when the range changed.
      prisma.conversation.count({
        where: {
          ...conversationScope,
          lastMessageAt: { gte: currentSince },
          category: { in: ['brand_deal', 'collaboration'] },
        },
      }),
      // 8. Replies actually sent on the user's behalf, in the window.
      //
      //    This previously counted `aiStatus: 'completed'`, which is the flag
      //    set on an INBOUND message once it has been read and classified —
      //    i.e. it counted analyses, not sends, while the card was labelled
      //    "AI Auto-Replied". On a human_only account (the default) it showed
      //    a large non-zero number next to a Settings page and an inbox that
      //    both state nothing is ever sent automatically.
      //
      //    'auto_replied' is the status written in jobs/messageAnalysisJob.js
      //    at the moment an outbound message is actually delivered to
      //    Instagram, so it is the only honest source for this number.
      prisma.message.count({
        where: {
          conversation: conversationScope,
          direction: 'outbound',
          aiStatus: 'auto_replied',
          createdAt: { gte: currentSince },
        },
      }),
      // 9. Spam and scams filtered, in the window (was all-time — see 7).
      prisma.conversation.count({
        where: {
          ...conversationScope,
          lastMessageAt: { gte: currentSince },
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

    // Sparkline axis labels. Pinned to en-GB so they match the one date
    // format used everywhere else (see frontend/src/content/format.js) rather
    // than following whatever locale the server happens to run under.
    const bucketLabels = [];
    for (let i = 0; i < numBuckets; i++) {
      const bucketTime = new Date(currentSince.getTime() + i * bucketDurationMs);
      if (timeRange === '24h') {
        bucketLabels.push(bucketTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
      } else {
        bucketLabels.push(bucketTime.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
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
    // Breakdown matched to the user's business profile.
    //
    // `icon` is a name from frontend components/Icon.js, never an emoji, and
    // `label`/`hint` are plain sentence-case English. The panel heading itself
    // is fixed copy on the frontend — it no longer changes per business type,
    // because a heading that renamed itself ("Video Editor DM Intelligence")
    // told the reader nothing the cards below did not already say.
    // ============================================
    let categoryMetrics = [];

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
      categoryMetrics = [
        { key: 'briefs', label: 'Project briefs', value: serviceProductCount, icon: 'briefcase', hint: 'People describing work they want done' },
        { key: 'pricing', label: 'Rate questions', value: pricingCount, icon: 'tag', hint: 'People asking what you charge' },
        { key: 'delivery', label: 'Turnaround questions', value: deliveryTurnaroundCount, icon: 'clock', hint: 'People asking how long it takes' },
        { key: 'hot_leads', label: 'Hot leads', value: currentHotLeads, icon: 'flame', hint: 'Ready to book now' },
      ];
    } else if (['product_seller', 'used_devices', 'clothing', 'ecommerce'].includes(primaryCategory)) {
      categoryMetrics = [
        { key: 'stock', label: 'Stock questions', value: serviceProductCount, icon: 'package', hint: 'People asking about specs, sizes, or condition' },
        { key: 'pricing', label: 'Price questions', value: pricingCount, icon: 'tag', hint: 'People asking what it costs' },
        { key: 'delivery', label: 'Delivery questions', value: deliveryTurnaroundCount, icon: 'truck', hint: 'People asking where and when you ship' },
        { key: 'hot_leads', label: 'Hot leads', value: currentHotLeads, icon: 'flame', hint: 'Ready to buy now' },
      ];
    } else if (primaryCategory === 'creator') {
      categoryMetrics = [
        { key: 'deals', label: 'Brand deals', value: dealsCount, icon: 'handshake', hint: 'Sponsorship and collaboration offers' },
        { key: 'pricing', label: 'Rate questions', value: pricingCount, icon: 'tag', hint: 'Brands asking for your rates' },
        { key: 'collabs', label: 'Barter offers', value: countCategory(['collaboration']), icon: 'users', hint: 'Gifting and cross-promotion, no fee' },
        { key: 'hot_leads', label: 'Hot leads', value: currentHotLeads, icon: 'flame', hint: 'Ready to sign now' },
      ];
    } else {
      categoryMetrics = [
        { key: 'enquiries', label: 'Client enquiries', value: serviceProductCount, icon: 'briefcase', hint: 'People asking about your services' },
        { key: 'pricing', label: 'Quote requests', value: pricingCount, icon: 'tag', hint: 'People asking for a price' },
        { key: 'delivery', label: 'Timeline questions', value: deliveryTurnaroundCount, icon: 'clock', hint: 'People asking how long it takes' },
        { key: 'hot_leads', label: 'Hot leads', value: currentHotLeads, icon: 'flame', hint: 'Ready to commit now' },
      ];
    }

    // ============================================
    // Share of conversations, for the segmented bar.
    //
    // `distributionTotal` is the real denominator and is sent to the frontend
    // so it can suppress percentages when the sample is too small to mean
    // anything — "100%" against one conversation is noise, not a finding.
    // ============================================
    const distributionTotal =
      currentHotLeads + pricingCount + serviceProductCount + dealsCount + supportCount + spamCount + generalCount;
    const share = (n) => (distributionTotal > 0 ? Math.round((n / distributionTotal) * 100) : 0);

    const intentDistribution = [
      { key: 'hot_leads', label: 'Hot leads', count: currentHotLeads, pct: share(currentHotLeads), color: '#f59e0b' },
      { key: 'pricing', label: 'Pricing', count: pricingCount, pct: share(pricingCount), color: '#10b981' },
      { key: 'services_products', label: 'Products and services', count: serviceProductCount, pct: share(serviceProductCount), color: '#3b82f6' },
      { key: 'deals', label: 'Brand deals', count: dealsCount, pct: share(dealsCount), color: '#8b5cf6' },
      { key: 'support', label: 'Support and delivery', count: supportCount + deliveryTurnaroundCount, pct: share(supportCount + deliveryTurnaroundCount), color: '#06b6d4' },
      { key: 'spam', label: 'Spam', count: spamCount, pct: share(spamCount), color: '#64748b' },
    ];

    res.json({
      timeRange,
      primaryCategory,
      businessTypes,
      // The stored reply mode, so the dashboard can state what is actually
      // happening rather than implying automatic sending is on. Defaults to
      // the same value as the database column: no auto-sending.
      replyMode: businessProfile.autoReplyMode || 'human_only',
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
      // Replies genuinely sent on the user's behalf. Zero unless reply mode
      // is set to automatic — which is exactly what every other surface says.
      autoRepliesSent: {
        value: autoRepliesSentCount,
        formatted: String(autoRepliesSentCount),
      },
      spamBlocked: {
        value: spamBlockedCount,
        formatted: String(spamBlockedCount),
      },
      categoryMetrics,
      intentDistribution,
      distributionTotal,
    });
  } catch (error) {
    console.error('[Analytics API] Error generating summary:', error.message);
    res.status(500).json({ error: "Couldn't load analytics. Try refreshing." });
  }
});

module.exports = router;
