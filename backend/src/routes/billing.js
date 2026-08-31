/**
 * Billing checkout routes — creates Cashfree subscriptions and (Phase 4)
 * add-on orders. Requires login, but deliberately does NOT require
 * requireEntitlement: a trial-expired tenant must still be able to reach
 * these endpoints to actually pay, or the gate would have no way out.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { createSubscription } = require('../lib/cashfreeSubscriptions');
const { createOrder, buildAddonOrderId, buildRenewalOrderId } = require('../lib/cashfreeOrders');
const { getAddonPack } = require('../lib/addonPacks');

router.use(requireAuth);

const SELF_SERVE_PLAN_SLUGS = ['starter', 'growth'];

// The Cashfree merchant profile isn't approved for Subscriptions yet (see
// the profile_inactive error from live testing) — false routes plan
// purchases through a one-time PG order instead, same amount, manually
// renewed. Flip to true once Subscriptions is actually approved; nothing
// else needs to change, the branch below is the only thing that reads this.
const CASHFREE_SUBSCRIPTIONS_ENABLED = process.env.CASHFREE_SUBSCRIPTIONS_ENABLED === 'true';

// ============================================
// POST /api/billing/subscribe
// Body: { planSlug: 'starter' | 'growth' | 'enterprise', customerPhone }
// ============================================
router.post('/subscribe', async (req, res) => {
  try {
    const { planSlug, customerPhone } = req.body || {};

    if (planSlug === 'enterprise') {
      return res.json({
        selfServe: false,
        message: 'Enterprise plans are set up directly with our team. Contact us to get started.',
      });
    }

    if (!SELF_SERVE_PLAN_SLUGS.includes(planSlug)) {
      return res.status(400).json({ error: 'Choose a valid plan.' });
    }

    if (!customerPhone || typeof customerPhone !== 'string' || !customerPhone.trim()) {
      return res.status(400).json({ error: 'Enter a phone number to continue.' });
    }

    const [user, plan, subscription] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId } }),
      prisma.plan.findUnique({ where: { slug: planSlug } }),
      prisma.subscription.findUnique({ where: { userId: req.userId } }),
    ]);

    if (!plan) return res.status(500).json({ error: "That plan isn't available right now." });
    if (!subscription) return res.status(404).json({ error: 'Log in to continue.' });
    if (!user?.email) return res.status(400).json({ error: 'Add an email address to your account before subscribing.' });

    if (CASHFREE_SUBSCRIPTIONS_ENABLED) {
      // Existing Phase 3 behavior, unchanged.
      const cashfreeResponse = await createSubscription({
        subscriptionRowId: subscription.id,
        plan,
        customerName: user.name || user.email,
        customerEmail: user.email,
        customerPhone: customerPhone.trim(),
        returnUrl: `${process.env.FRONTEND_URL}/billing?subscribed=1`,
      });

      return res.json({
        selfServe: true,
        subscriptionSessionId: cashfreeResponse.subscription_session_id,
        cfSubscriptionId: cashfreeResponse.cf_subscription_id,
      });
    }

    // Manual-renewal path: a one-time PG order for the plan's price,
    // recognized by the webhook handler via its "mr_" order-id prefix.
    const cashfreeResponse = await createOrder({
      orderId: buildRenewalOrderId(subscription.id, plan.slug),
      amountInPaise: plan.priceInPaise,
      orderNote: `${plan.name} plan (manual renewal)`,
      customerId: req.userId,
      customerEmail: user.email,
      customerPhone: customerPhone.trim(),
      returnUrl: `${process.env.FRONTEND_URL}/billing?subscribed=1`,
    });

    res.json({
      selfServe: true,
      manualRenewal: true,
      paymentSessionId: cashfreeResponse.payment_session_id,
      cfOrderId: cashfreeResponse.cf_order_id,
    });
  } catch (error) {
    console.error('[Billing] Error creating subscription:', error.response?.data || error.message);
    res.status(500).json({ error: "Couldn't start checkout. Try again in a moment." });
  }
});

// ============================================
// POST /api/billing/addon
// Body: { packCode: '1' | '2' | '3', customerPhone }
// ============================================
router.post('/addon', async (req, res) => {
  try {
    const { packCode, customerPhone } = req.body || {};
    const pack = getAddonPack(packCode);

    if (!pack) return res.status(400).json({ error: 'Choose a valid add-on pack.' });

    if (!customerPhone || typeof customerPhone !== 'string' || !customerPhone.trim()) {
      return res.status(400).json({ error: 'Enter a phone number to continue.' });
    }

    const [user, subscription] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId } }),
      prisma.subscription.findUnique({ where: { userId: req.userId } }),
    ]);

    if (!subscription) return res.status(404).json({ error: 'Log in to continue.' });
    if (!user?.email) return res.status(400).json({ error: 'Add an email address to your account before purchasing.' });

    const cashfreeResponse = await createOrder({
      orderId: buildAddonOrderId(subscription.id, packCode),
      amountInPaise: pack.priceInPaise,
      orderNote: `${pack.dmCredits} DM add-on pack`,
      customerId: req.userId,
      customerEmail: user.email,
      customerPhone: customerPhone.trim(),
      returnUrl: `${process.env.FRONTEND_URL}/billing?addon=1`,
    });

    res.json({
      paymentSessionId: cashfreeResponse.payment_session_id,
      cfOrderId: cashfreeResponse.cf_order_id,
    });
  } catch (error) {
    console.error('[Billing] Error creating add-on order:', error.response?.data || error.message);
    res.status(500).json({ error: "Couldn't start checkout. Try again in a moment." });
  }
});

module.exports = router;
