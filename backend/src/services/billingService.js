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

const TRIAL_LENGTH_MS = 3 * 24 * 60 * 60 * 1000;

async function getOrCreateSubscription(userId) {
  const existing = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });
  if (existing) return existing;

  // upsert, not create — concurrent callers would otherwise race and one
  // would fail with P2002 on the unique userId.
  return prisma.subscription.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      status: 'trial',
      trialEndsAt: new Date(Date.now() + TRIAL_LENGTH_MS),
    },
    include: { plan: true },
  });
}

/** Returns true if the account currently has access to paid functionality. */
function isEntitled(subscription) {
  if (!subscription) return false;
  if (subscription.status === 'active') {
    // An active subscription with no currentPeriodEnd is anomalous — every
    // real activation/renewal sets one. Treating it as entitled anyway would
    // let a subscription stay "active" (and unblocked) forever if a renewal
    // webhook is ever missed or a row is left in a half-written state,
    // rather than failing closed the way every other unexpected state does.
    if (!subscription.currentPeriodEnd) return false;
    return new Date(subscription.currentPeriodEnd) >= new Date();
  }
  if (subscription.status === 'trial') {
    return !subscription.trialEndsAt || new Date(subscription.trialEndsAt) > new Date();
  }
  return false;
}

/**
 * The DM quota / account limit that currently apply to a tenant.
 *
 * planId reflects what was actually purchased, not what's allowed right
 * now — a trial tenant has bought nothing, so its ceiling is read directly
 * from the Starter plan (by slug, never by display name, since `name` is
 * just UI copy and can change) rather than implied by a fake planId.
 * Read-only: this doesn't enforce anything, callers do that with the result.
 */
async function getEffectivePlanLimits(subscription) {
  if (subscription?.planId) {
    const plan = await prisma.plan.findUnique({ where: { id: subscription.planId } });
    // planId has an ON DELETE SET NULL foreign key, so a set planId pointing
    // at a missing Plan should be impossible. Fail loud rather than quietly
    // substituting Starter's limits for what might be a paying Growth/
    // Enterprise tenant — a silent under-serve is worse than a crash here.
    if (!plan) throw new Error(`Subscription ${subscription.id} references missing plan ${subscription.planId}`);
    return { dmQuota: plan.dmQuota, accountLimit: plan.accountLimit };
  }

  const starter = await prisma.plan.findUnique({ where: { slug: 'starter' } });
  if (!starter) throw new Error("Starter plan is missing — can't determine trial limits.");
  return { dmQuota: starter.dmQuota, accountLimit: starter.accountLimit };
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

module.exports = {
  getOrCreateSubscription,
  isEntitled,
  getEffectivePlanLimits,
  updateSubscriptionStatus,
  TRIAL_LENGTH_MS,
};
