/**
 * Billing/subscription abstraction.
 *
 * No payment provider (Stripe, Paddle, etc.) is integrated yet — this
 * service exists so the rest of the app (routes, middleware, future feature
 * gating) never talks to a specific provider directly. When a provider is
 * added later, only this file (and its provider-specific counterpart)
 * should need to change.
 *
 * `subscriptionService`-style responsibilities live here too: reading plan
 * status and (in the future) checking usage limits before allowing an
 * action such as connecting another Instagram account or generating a reply.
 */

const prisma = require('../lib/prisma');
const { SUBSCRIPTION_STATUSES } = require('../lib/constants');

const TRIAL_LENGTH_MS = 14 * 24 * 60 * 60 * 1000;

async function getOrCreateSubscription(userId) {
  let subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription) {
    subscription = await prisma.subscription.create({
      data: {
        userId,
        plan: 'free',
        status: 'trial',
        trialEndsAt: new Date(Date.now() + TRIAL_LENGTH_MS),
      },
    });
  }
  return subscription;
}

/** Returns true if the account currently has access to paid functionality. */
function isEntitled(subscription) {
  if (!subscription) return false;
  if (subscription.status === 'active') return true;
  if (subscription.status === 'trial') {
    return !subscription.trialEndsAt || new Date(subscription.trialEndsAt) > new Date();
  }
  return false;
}

async function updateSubscriptionStatus(userId, status, extra = {}) {
  if (!SUBSCRIPTION_STATUSES.includes(status)) {
    throw new Error(`Invalid subscription status: ${status}`);
  }
  return prisma.subscription.update({
    where: { userId },
    data: { status, ...extra },
  });
}

module.exports = { getOrCreateSubscription, isEntitled, updateSubscriptionStatus };
