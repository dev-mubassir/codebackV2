/**
 * Entitlement middleware for Codeback.
 *
 * Checks that the logged-in user's trial hasn't expired and, once billing
 * exists, that their subscription is in good standing. Must run after
 * requireAuth, which sets req.userId.
 */

const prisma = require('../lib/prisma');
const { isEntitled } = require('../services/billingService');

async function requireEntitlement(req, res, next) {
  const subscription = await prisma.subscription.findUnique({ where: { userId: req.userId } });

  if (!isEntitled(subscription)) {
    return res.status(402).json({ error: 'Your trial has ended. Subscribe to keep using Codeback.' });
  }

  next();
}

module.exports = { requireEntitlement };
