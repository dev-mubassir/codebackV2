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
const { isBillingEnabled, isUsdPricingEnabled, isMetaApproved } = require('../lib/billingFlags');
const { effectiveStatus, LIVE_STATUSES } = require('../services/entitlementService');
const { hashIgUserId, TRIAL_OUTCOMES } = require('../lib/igIdentity');

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
        // Quoted, not checked out. Carries real "from" prices so the card
        // renders an amount from the catalogue, but must show a contact CTA
        // rather than a buy button.
        isQuoteOnly: plan.isQuoteOnly,
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
      // Client bootstrap for the PUBLIC marketing page, which has no session
      // and therefore cannot read features off /auth/me. Carried here because
      // the pricing section already fetches this endpoint — one round trip,
      // and the flag still has exactly one home (the backend env).
      features: {
        metaApproved: isMetaApproved(),
      },
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many orders the billing page's history table shows. A tenant buying a
 * 30-day plan plus the occasional pack generates a handful of rows a year,
 * so this is years of history — but it is still bounded, because "just
 * return everything" is how an endpoint that was fine for a year starts
 * timing out for the one customer who churned through 400 failed attempts.
 */
const ORDER_HISTORY_LIMIT = 50;

/**
 * The statuses grantPlan() treats as a WARM renewal — the ones where the
 * existing validUntil is still the right anchor for the next cycle.
 *
 * Imported from entitlementService rather than copied. It has to match
 * exactly: this list is the only reason the page can promise "renewing early
 * never loses days" and name the actual resulting date. A second copy that
 * drifted would make the page state a date the grant will not produce, which
 * is worse than showing nothing at all.
 */
const WARM_RENEWAL_STATUSES = LIVE_STATUSES;

/** Whole days from now until `date`, rounded UP, never negative. Null for a missing date. */
function daysUntil(date, now) {
  if (!date) return null;
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / DAY_MS));
}

/**
 * GET /api/billing/summary — everything the in-app billing page renders,
 * in one round trip.
 *
 * TENANT SCOPE IS THE WHOLE SECURITY STORY HERE. Every query below is keyed
 * on `req.userId`, which requireAuth derives from the server-side session.
 * This route accepts NO identifier of any kind — no :id param, no ?tenantId,
 * no body — precisely so there is nothing for a caller to tamper with. An
 * endpoint that returns a plan, a credit balance, and a payment history is
 * exactly the shape of thing an IDOR is worth writing, so the safest design
 * is one where the dangerous parameter does not exist.
 *
 * DELIBERATELY NOT EXPOSED, same rule as /plans above:
 * classificationCapCycle and classificationThrottlePerHour. The page shows
 * how many classifications this cycle has used, because that is the
 * customer's own usage, but never what the ceiling is — the limits are an
 * internal burst guard and are not advertised as a number anywhere
 * customer-facing (see Plan.classificationCapCycle's schema comment).
 *
 * ONE EXCEPTION, scoped tightly: `trial`. For a tenant with no entitlement
 * yet, or on a live TRIAL, the response carries the TRIAL catalogue row's
 * length, sorting limit and auto-reply allowance. A trial's limits are what
 * the trial IS — the no-entitlement page has to say what connecting gets you,
 * and a trialing tenant who reaches the limit needs to know why sorting
 * stopped. Marketing pages never receive it (this route needs a session), and
 * a paying tenant gets `trial: null` and no limit of any kind. The test file
 * pins both halves.
 *
 * `trialStatus` says WHY a tenant has no trial, so no page ever has to render
 * an unexplained "no plan": TRIAL_GRANTED for a live trial; for NONE one of
 * TRIAL_ALREADY_CONSUMED, EMAIL_UNVERIFIED or TRIAL_NOT_STARTED; null for
 * everyone else. It is DERIVED from the same sources the connect decision
 * uses — the identity ledger and the email verification stamp — and never
 * stored, so it cannot drift from what connecting would actually do.
 *
 * Order rows are SELECTED field by field rather than returned whole:
 * `rawPayload` is a stored Cashfree webhook body, and `paymentCountry` /
 * `regionSource` are the region lock's internal provenance. None of the
 * three is the customer's business, and a `findMany` with no select would
 * ship all of them the first time someone added a column.
 */
router.get('/summary', async (req, res) => {
  const tenantId = req.userId;
  const now = new Date();

  try {
    const [entitlement, orders] = await Promise.all([
      prisma.entitlement.findUnique({ where: { userId: tenantId } }),
      prisma.order.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: ORDER_HISTORY_LIMIT,
        select: {
          cashfreeOrderId: true,
          planCode: true,
          addonCode: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
          paidAt: true,
        },
      }),
    ]);

    const status = effectiveStatus(entitlement, now);
    const plan = entitlement?.planCode ? await prisma.plan.findUnique({ where: { code: entitlement.planCode } }) : null;

    // The trial's own terms — see `trial` in the route doc above. Reuses the
    // plan row when the tenant is ON the trial rather than reading it twice.
    const showsTrialTerms = status === 'NONE' || (status === 'TRIALING' && plan?.code === 'TRIAL');
    const trialPlan = !showsTrialTerms
      ? null
      : plan?.code === 'TRIAL'
        ? plan
        : await prisma.plan.findUnique({ where: { code: 'TRIAL' } });

    // Why this tenant has no trial — see `trialStatus` in the route doc.
    let trialStatus = null;
    if (status === 'TRIALING' && plan?.code === 'TRIAL') {
      trialStatus = TRIAL_OUTCOMES.TRIAL_GRANTED;
    } else if (status === 'NONE') {
      const [owner, connected] = await Promise.all([
        prisma.user.findUnique({ where: { id: tenantId }, select: { emailVerifiedAt: true } }),
        prisma.instagramAccount.findMany({
          where: { userId: tenantId, connectionStatus: 'CONNECTED' },
          select: { igUserId: true },
        }),
      ]);
      const hashes = [...new Set(connected.map((a) => hashIgUserId(a.igUserId)))];
      const spent = hashes.length
        ? await prisma.instagramIdentity.count({ where: { igUserIdHash: { in: hashes }, trialConsumedAt: { not: null } } })
        : 0;

      // Same precedence as the claim: a spent trial outranks an unverified
      // email, since confirming the address would not change the answer.
      if (hashes.length > 0 && spent === hashes.length) {
        trialStatus = TRIAL_OUTCOMES.TRIAL_ALREADY_CONSUMED;
      } else if (!owner?.emailVerifiedAt) {
        trialStatus = TRIAL_OUTCOMES.EMAIL_UNVERIFIED;
      } else {
        trialStatus = TRIAL_OUTCOMES.TRIAL_NOT_STARTED;
      }
    }

    // Credits SPENT since this cycle started, counted from the ledger rather
    // than inferred by subtracting the balance from the plan's grant. The
    // subtraction would be wrong for every tenant who carried a bank forward
    // or bought a pack mid-cycle, which is precisely the population the 80%
    // warning is aimed at.
    const spentThisCycle = entitlement
      ? await prisma.creditLedger.count({
          where: { tenantId, type: 'SPEND', createdAt: { gte: entitlement.cycleStartedAt } },
        })
      : 0;

    const current = entitlement?.replyCreditsCurrent ?? 0;
    const banked = entitlement?.replyCreditsBanked ?? 0;
    const remaining = current + banked;

    // The pool this cycle actually had to spend = what is left plus what has
    // already gone. Deriving it this way (instead of from the plan's
    // per-cycle grant) keeps the percentage honest when a pack is bought
    // mid-cycle: the denominator grows with the purchase, so the 80% banner
    // correctly switches itself off the moment the tenant tops up.
    const pool = remaining + spentThisCycle;
    const usedFraction = pool > 0 ? spentThisCycle / pool : 0;

    /**
     * The renewal date promise, computed SERVER-SIDE with grantPlan's own
     * rule, so the page states a date rather than a claim.
     *
     * "Renewing early never loses days" is a real product promise, and the
     * only way to keep it visibly is to show the customer the exact expiry
     * they will get. That date is anchored on the CURRENT validUntil for
     * anyone still trialing/active/in grace, and on today only for a cold
     * start (no entitlement, or fully expired past grace) — the same branch
     * grantPlan takes. Sending the anchor and the resulting per-plan dates
     * means the browser never does this arithmetic itself and cannot drift
     * from what the grant will do.
     */
    const isWarmRenewal = Boolean(entitlement && entitlement.validUntil && WARM_RENEWAL_STATUSES.includes(status));
    const anchor = isWarmRenewal ? entitlement.validUntil : now;

    const purchasablePlans = await prisma.plan.findMany({
      where: { code: { in: PURCHASABLE_PLAN_CODES }, isActive: true },
      select: { code: true, cycleLengthDays: true },
    });
    const validUntilByPlan = {};
    for (const p of purchasablePlans) {
      validUntilByPlan[p.code] = new Date(anchor.getTime() + p.cycleLengthDays * DAY_MS);
    }

    // Has this tenant ever completed an add-on purchase? The upgrade pitch
    // fires on the FIRST one, so the page needs the count, not a boolean —
    // "you bought your first pack" and "you buy one every month" are
    // different conversations.
    const paidAddonOrders = await prisma.order.count({
      where: { tenantId, status: 'PAID', addonCode: { not: null } },
    });

    // Reply-credit packs bought in THIS cycle specifically.
    //
    // The upgrade test compares the tenant's CURRENT cycle configuration
    // against the cheapest Pro configuration that matches it, so a lifetime
    // count is the wrong number — someone who bought four packs last quarter
    // and none this month is not currently overpaying for anything. Excludes
    // the recurring extra-IG-account add-on, which is counted separately via
    // entitlement.extraIgAccounts because it persists across cycles rather
    // than being consumed by one.
    const replyCreditPacksThisCycle = entitlement?.cycleStartedAt
      ? await prisma.order.count({
          where: {
            tenantId,
            status: 'PAID',
            addonCode: { not: null, notIn: [RECURRING_ADDON_CODE] },
            paidAt: { gte: entitlement.cycleStartedAt },
          },
        })
      : 0;

    return res.json({
      plan: plan
        ? {
            code: plan.code,
            name: plan.name,
            igAccountLimit: plan.igAccountLimit,
            autoReplyCreditsPerCycle: plan.autoReplyCreditsPerCycle,
            autoReplyBankCap: plan.autoReplyBankCap,
            cycleLengthDays: plan.cycleLengthDays,
            purchasable: PURCHASABLE_PLAN_CODES.includes(plan.code),
        // Quoted, not checked out. Carries real "from" prices so the card
        // renders an amount from the catalogue, but must show a contact CTA
        // rather than a buy button.
        isQuoteOnly: plan.isQuoteOnly,
          }
        : null,
      status, // effective, derived from validUntil/graceUntil — never the stored column
      validUntil: entitlement?.validUntil ?? null,
      graceUntil: entitlement?.graceUntil ?? null,
      cycleStartedAt: entitlement?.cycleStartedAt ?? null,
      daysRemaining: daysUntil(entitlement?.validUntil, now),
      graceDaysRemaining: status === 'GRACE' ? daysUntil(entitlement?.graceUntil, now) : null,
      billingRegion: entitlement?.billingRegion ?? null,
      currency: entitlement?.currency ?? null,
      credits: {
        current,
        banked,
        remaining,
        spentThisCycle,
        cyclePool: pool,
        // Rounded here rather than in the browser so the banner threshold and
        // the number printed beside it can never disagree by a rounding step.
        usedPercent: Math.round(usedFraction * 100),
      },
      usage: {
        // The customer's own consumption. No cap, no throttle — see the route
        // doc above.
        classificationsThisCycle: entitlement?.classificationCountCycle ?? 0,
        autoRepliesThisCycle: spentThisCycle,
      },
      extraIgAccounts: entitlement?.extraIgAccounts ?? 0,
      trialStatus,
      trial: trialPlan
        ? {
            days: trialPlan.cycleLengthDays,
            classificationLimit: trialPlan.classificationCapCycle,
            autoReplyCredits: trialPlan.autoReplyCreditsPerCycle,
          }
        : null,
      renewal: {
        extendsFromValidUntil: isWarmRenewal,
        anchor,
        validUntilByPlan,
      },
      paidAddonOrders,
      replyCreditPacksThisCycle,
      orders,
    });
  } catch (error) {
    console.error('[Billing] Failed to load the billing summary:', error.message);
    return res.status(500).json({ error: "Couldn't load your billing details. Try again." });
  }
});

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
