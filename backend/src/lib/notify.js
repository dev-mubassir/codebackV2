/**
 * Notification helper — creates persisted, creator-facing notifications for
 * genuinely important events, and pushes them over Socket.io in real time.
 *
 * By design this does NOT create a notification for every analyzed message
 * (that would spam the creator for routine fan messages). Live per-message
 * UI updates (category/priority/summary changing) are pushed as a separate,
 * non-persisted `analysis_completed` socket event instead — see emitAnalysisUpdate().
 */

const prisma = require('./prisma');
const { emitToUser } = require('./socket');

async function createNotification(userId, { type, title, body = null, conversationId = null, brandDealId = null }) {
  try {
    const notification = await prisma.notification.create({
      data: { userId, type, title, body, conversationId, brandDealId },
    });
    emitToUser(userId, 'notification', notification);
    return notification;
  } catch (err) {
    console.error('[Notify] Failed to create notification:', err.message);
    return null;
  }
}

function notifyBrandDeal(userId, { conversationId, brandDealId, brandName, contactUsername }) {
  return createNotification(userId, {
    type: 'new_brand_deal',
    title: `🔥 New brand deal from ${brandName || `@${contactUsername || 'someone'}`}`,
    body: brandName ? `${brandName} reached out about a potential collaboration.` : 'A potential brand collaboration was detected.',
    conversationId,
    brandDealId,
  });
}

function notifyHighPriority(userId, { conversationId, contactUsername, reason }) {
  return createNotification(userId, {
    type: 'high_priority_conversation',
    title: `⚠️ Conversation needs your attention`,
    body: reason || `@${contactUsername || 'Someone'} sent a message that looks important.`,
    conversationId,
  });
}

function notifyImportantCustomer(userId, { conversationId, contactUsername, reason }) {
  return createNotification(userId, {
    type: 'important_customer',
    title: `💰 Possible customer opportunity`,
    body: reason || `@${contactUsername || 'Someone'} may be interested in buying from you.`,
    conversationId,
  });
}

function notifyConnectionProblem(userId, { instagramAccountId, igUsername, reason }) {
  return createNotification(userId, {
    type: 'instagram_connection_problem',
    title: `⚠️ Instagram connection issue`,
    body: `@${igUsername || 'your account'}: ${reason || 'Please reconnect your Instagram account.'}`,
    conversationId: null,
  }).then((n) => {
    emitToUser(userId, 'instagram_connection_problem', { instagramAccountId, igUsername, reason });
    return n;
  });
}

/** Lightweight, non-persisted live-update event for the inbox UI. */
function emitAnalysisUpdate(userId, payload) {
  emitToUser(userId, 'analysis_completed', payload);
}

function emitBrandDealDetected(userId, payload) {
  emitToUser(userId, 'brand_deal_detected', payload);
}

module.exports = {
  notifyBrandDeal,
  notifyHighPriority,
  notifyImportantCustomer,
  notifyConnectionProblem,
  emitAnalysisUpdate,
  emitBrandDealDetected,
};
