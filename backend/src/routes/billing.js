/**
 * Billing checkout — server-side order creation only. No custom card form
 * exists or may be added here; checkout is Cashfree's own hosted flow via
 * `payment_session_id`, so card data never touches this server. See the
 * feat/billing brief's hard constraints.
 *
 * Every route is gated on BILLING_ENABLED — while it's false (the default),
 * these endpoints 404 regardless of auth state, so nothing about billing is
 * reachable before Meta App Review approval.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { generateOrderId, createOrder } = require('../lib/cashfreeOrders');
const { isBillingEnabled, isUsdPricingEnabled } = require('../lib/billingFlags');

// BILLING_ENABLED gate runs BEFORE requireAuth — an unauthenticated 401
// would still leak "this route exists and requires login", which is more
// signal than a disabled feature should give. 404 regardless of auth state.
router.use((req, res, next) => {
  if (!isBillingEnabled()) return res.status(404).json({ error: 'Not found' });
  next();
});

const PURCHASABLE_PLAN_CODES = ['STARTER', 'PRO']; // TRIAL is granted by Instagram connect, never purchased; ENTERPRISE has no self-serve checkout
const RECURRING_ADDON_CODE = 'extra_ig_account';

/**
 * GET /api/billing/plans — the public pricing catalogue.
 *
 * UNAUTHENTICATED on purpose: the marketing homepage renders from this,
 * and a visitor has no session. Declared ABOVE `router.use(requireAuth)`
 * for that reason — order is load-bearing here. It is still behind the
 * BILLING_ENABLED gate above, so nothing about pricing is reachable while
 * billing is dark.
 *
 * This is the single source of prices for BOTH the app billing page
 * (Gate 5) and the marketing pricing section (Gate 6). Neither may
 * hardcode an amount; changing a price is an UPDATE on plan_prices with no
 * redeploy, which is the whole point of the catalogue living in the
 * database.
 *
 * DELIBERATELY NOT EXPOSED: classificationCapCycle and
 * classificationThrottlePerHour. Classification limits are enforced in code
 * but are an internal ceiling — they are never advertised as a number on a
 * customer-facing page, so they must not leak through the API that renders
 * those pages either.
 *
 * USD_PRICING_ENABLED decides which CURRENCIES are exposed, not which rows
 * exist: the USD/INTL PlanPrice rows stay in the database either way, so
 * turning international pricing on is a flag flip, never a migration.
 */
router.get('/plans', async (req, res) => {
  try {
    const regions = isUsdPricingEnabled() ? ['IN', 'INTL'] : ['IN'];

    const [plans, packs, extraIgPrices] = await Promise.all([
      prisma.plan.findMany({
        where: { isActive: true },
        include: { prices: { where: { billingRegion: { in: regions } } } },
      }),
      prisma.addonPack.findMany({
        where: { isActive: true },
        include: { prices: { where: { billingRegion: { in: regions } } } },
      }),
      prisma.extraIgAccountPrice.findMany({ where: { billingRegion: { in: regions } } }),
    ]);

    const publicPrice = (p) => ({ billingRegion: p.billingRegion, currency: p.currency, amount: p.amount });

    const payload = plans
      .filter((plan) => plan.code !== 'TRIAL') // granted by connecting Instagram, never purchased
      .map((plan) => ({
        code: plan.code,
        name: plan.name,
        igAccountLimit: plan.igAccountLimit,
        autoReplyCreditsPerCycle: plan.autoReplyCreditsPerCycle,
        autoReplyBankCap: plan.autoReplyBankCap,
        cycleLengthDays: plan.cycleLengthDays,
        purchasable: PURCHASABLE_PLAN_CODES.includes(plan.code),
        prices: plan.prices.map(publicPrice),
        addons: {
          // Priced per PURCHASING plan tier — deliberately cheaper on Pro,
          // which is the gap the upgrade pitch is built on, so both pages
          // need the per-tier number rather than one global add-on price.
          replyCredits: packs.map((pack) => ({
            code: pack.code,
            creditAmount: pack.creditAmount,
            prices: pack.prices.filter((p) => p.planCode === plan.code).map(publicPrice),
          })),
          extraIgAccount: {
            code: RECURRING_ADDON_CODE,
            prices: extraIgPrices.filter((p) => p.planCode === plan.code).map(publicPrice),
          },
        },
      }));

    return res.json({
      currencies: regions.map((r) => (r === 'IN' ? 'INR' : 'USD')),
      regions,
      plans: payload,
    });
  } catch (error) {
    console.error('[Billing] Failed to load the plan catalogue:', error.message);
    return res.status(500).json({ error: "Couldn't load pricing. Try again." });
  }
});

// Everything BELOW this line requires a session. /plans above is public.
router.use(requireAuth);

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * POST /api/billing/checkout/plan
 * body: { planCode: 'STARTER'|'PRO', billingRegionHint?: 'IN'|'INTL', customerPhone: string }
 *
 * billingRegionHint is only consulted for a tenant's FIRST purchase (no
 * locked region yet) — it is the IP/timezone-suggested currency the
 * pricing page displayed, never trusted as the actual lock. The lock
 * itself happens later, in billingFulfillment, from the payment itself.
 */
router.post('/checkout/plan', async (req, res) => {
  const { planCode, billingRegionHint, customerPhone } = req.body || {};

  if (!PURCHASABLE_PLAN_CODES.includes(planCode)) {
    return res.status(400).json({ error: 'Unknown or non-purchasable plan code.' });
  }
  if (!/^\d{10}$/.test(String(customerPhone || ''))) {
    return res.status(400).json({ error: 'A 10-digit phone number is required by Cashfree for checkout.' });
  }

  try {
    const [entitlement, plan] = await Promise.all([
      prisma.entitlement.findUnique({ where: { userId: req.userId } }),
      prisma.plan.findUnique({ where: { code: planCode } }),
    ]);

    if (!plan || !plan.isActive) {
      return res.status(404).json({ error: 'That plan is not currently available.' });
    }

    // Locked region wins outright; otherwise the hint (default IN).
    const billingRegion = entitlement?.billingRegion || (billingRegionHint === 'INTL' ? 'INTL' : 'IN');

    const price = await prisma.planPrice.findUnique({
      where: { planId_billingRegion: { planId: plan.id, billingRegion } },
    });
    if (!price) {
      return res.status(404).json({ error: `No price configured for ${planCode} in region ${billingRegion}.` });
    }

    const orderId = generateOrderId();
    await prisma.order.create({
      data: {
        cashfreeOrderId: orderId,
        tenantId: req.userId,
        planCode,
        amount: price.amount,
        currency: price.currency,
        status: 'CREATED',
      },
    });

    const cfOrder = await createOrder({
      orderId,
      amountInPaise: price.amount,
      currency: price.currency,
      customerId: req.userId,
      customerEmail: req.user.email || undefined,
      customerPhone,
      returnUrl: `${frontendUrl()}/billing?order=${orderId}`,
    });

    return res.json({
      orderId,
      paymentSessionId: cfOrder.payment_session_id,
      amount: price.amount,
      currency: price.currency,
    });
  } catch (error) {
    console.error('[Billing] Plan checkout failed:', error.response?.data || error.message);
    await prisma.order.updateMany({ where: { tenantId: req.userId, planCode, status: 'CREATED' }, data: { status: 'FAILED' } }).catch(() => {});
    return res.status(502).json({ error: "Couldn't start checkout. Try again." });
  }
});

/**
 * POST /api/billing/checkout/addon
 * body: { addonCode: string, customerPhone: string }
 *
 * Both add-on shapes require an existing paid (STARTER/PRO) plan — priced
 * per the CURRENT plan tier, cheaper on Pro on purpose (see
 * AddonPackPrice/ExtraIgAccountPrice schema notes). A trial or unentitled
 * tenant has nothing to price an add-on against.
 */
router.post('/checkout/addon', async (req, res) => {
  const { addonCode, customerPhone } = req.body || {};

  if (!addonCode) {
    return res.status(400).json({ error: 'addonCode is required.' });
  }
  if (!/^\d{10}$/.test(String(customerPhone || ''))) {
    return res.status(400).json({ error: 'A 10-digit phone number is required by Cashfree for checkout.' });
  }

  try {
    const entitlement = await prisma.entitlement.findUnique({ where: { userId: req.userId } });
    if (!entitlement || !PURCHASABLE_PLAN_CODES.includes(entitlement.planCode) || !entitlement.billingRegion) {
      return res.status(400).json({ error: 'Add-ons require an active Starter or Pro plan.' });
    }

    let price;
    if (addonCode === RECURRING_ADDON_CODE) {
      price = await prisma.extraIgAccountPrice.findUnique({
        where: { planCode_billingRegion: { planCode: entitlement.planCode, billingRegion: entitlement.billingRegion } },
      });
    } else {
      const pack = await prisma.addonPack.findUnique({ where: { code: addonCode } });
      if (!pack || !pack.isActive) {
        return res.status(404).json({ error: 'Unknown add-on code.' });
      }
      price = await prisma.addonPackPrice.findUnique({
        where: {
          addonPackId_planCode_billingRegion: {
            addonPackId: pack.id,
            planCode: entitlement.planCode,
            billingRegion: entitlement.billingRegion,
          },
        },
      });
    }

    if (!price) {
      return res.status(404).json({ error: `No price configured for "${addonCode}" on your plan/region.` });
    }

    const orderId = generateOrderId();
    await prisma.order.create({
      data: {
        cashfreeOrderId: orderId,
        tenantId: req.userId,
        addonCode,
        amount: price.amount,
        currency: price.currency,
        status: 'CREATED',
      },
    });

    const cfOrder = await createOrder({
      orderId,
      amountInPaise: price.amount,
      currency: price.currency,
      customerId: req.userId,
      customerEmail: req.user.email || undefined,
      customerPhone,
      returnUrl: `${frontendUrl()}/billing?order=${orderId}`,
    });

    return res.json({
      orderId,
      paymentSessionId: cfOrder.payment_session_id,
      amount: price.amount,
      currency: price.currency,
    });
  } catch (error) {
    console.error('[Billing] Add-on checkout failed:', error.response?.data || error.message);
    await prisma.order.updateMany({ where: { tenantId: req.userId, addonCode, status: 'CREATED' }, data: { status: 'FAILED' } }).catch(() => {});
    return res.status(502).json({ error: "Couldn't start checkout. Try again." });
  }
});

module.exports = router;
