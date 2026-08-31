/**
 * Notification helper — creates persisted, user-facing notifications for
 * genuinely important events, and pushes them over Socket.io in real time.
 *
 * These titles and bodies are WRITTEN TO THE DATABASE and rendered verbatim on
 * /notifications, so they are product copy, not log lines: sentence case, no
 * emoji, second person, and no raw enum values.
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
    title: `New brand deal from ${brandName || `@${contactUsername || 'someone'}`}`,
    body: brandName
      ? `${brandName} got in touch about working together.`
      : 'Someone got in touch about working together.',
    conversationId,
    brandDealId,
  });
}

function notifyHighPriority(userId, { conversationId, contactUsername, reason }) {
  return createNotification(userId, {
    type: 'high_priority_conversation',
    title: 'A conversation needs your reply',
    body: reason || `@${contactUsername || 'Someone'} sent something worth answering yourself.`,
    conversationId,
  });
}

function notifyImportantCustomer(userId, { conversationId, contactUsername, reason }) {
  return createNotification(userId, {
    type: 'important_customer',
    title: 'Someone looks ready to buy',
    body: reason || `@${contactUsername || 'Someone'} may be about to buy from you.`,
    conversationId,
  });
}

function notifyConnectionProblem(userId, { instagramAccountId, igUsername, reason }) {
  return createNotification(userId, {
    type: 'instagram_connection_problem',
    title: 'Reconnect your Instagram account',
    body: `@${igUsername || 'your account'} — ${reason || 'Codeback stops receiving new messages until you reconnect.'}`,
    conversationId: null,
  }).then((n) => {
    emitToUser(userId, 'instagram_connection_problem', { instagramAccountId, igUsername, reason });
    return n;
  });
}

/**
 * Only sent while CASHFREE_SUBSCRIPTIONS_ENABLED is false (see
 * jobs/renewalReminderJob.js) — autopay renews on its own and doesn't need
 * this nudge. In-app only, per current scope; no email exists to send to.
 */
function notifyRenewalReminder(userId, { planName, currentPeriodEnd }) {
  return createNotification(userId, {
    type: 'subscription_renewal_due',
    title: `Your ${planName} plan renews soon`,
    body: `Renews on ${currentPeriodEnd.toLocaleDateString('en-GB')} — visit Billing to pay and keep automatic replies running.`,
    conversationId: null,
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
  notifyRenewalReminder,
  emitAnalysisUpdate,
  emitBrandDealDetected,
};
