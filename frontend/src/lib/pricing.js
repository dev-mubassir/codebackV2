/**
 * Shared pricing contract — the ONE place either page learns what anything
 * costs.
 *
 * Used unchanged by both the in-app billing page and the marketing pricing
 * section. Neither may hardcode an amount: every price here comes from
 * GET /api/billing/plans, which reads plan_prices in the database, so
 * changing a price is an UPDATE and a refresh rather than a redeploy.
 *
 * OWNERSHIP: this file and components/pricing/PlanCard are shared contract.
 * Neither Wave 1 gate may edit them — a change either one needs gets
 * flagged and queued, so the two pages cannot drift into showing different
 * numbers for the same plan.
 */

import { useEffect, useState, useCallback } from 'react';
import api from './api';

export const REGION_IN = 'IN';
export const REGION_INTL = 'INTL';

/**
 * Suggested region, as a DISPLAY HINT ONLY.
 *
 * Never the billing region of record. The real region is locked server-side
 * from the payment itself (the rail used, or the card's issuing country) —
 * see the Entitlement/RegionSource schema notes. A hint derived in the
 * browser is trivially spoofed with a VPN, which is exactly why it decides
 * which price to SHOW and nothing else.
 *
 * Timezone rather than an IP lookup: it needs no network call, no third
 * party, and no visitor IP leaving the page — and it is just as good for
 * the only job it has, which is picking a sensible default toggle position.
 */
export function detectRegionHint() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta' ? REGION_IN : REGION_INTL;
  } catch {
    return REGION_IN;
  }
}

/** Minor units (paise/cents) -> a display string. Both supported currencies are 2-decimal. */
export function formatPrice(amount, currency) {
  if (amount == null) return null;
  const major = amount / 100;
  const symbol = currency === 'INR' ? '₹' : '$';
  // Whole amounts read better without trailing zeros: ₹499, not ₹499.00.
  const body = Number.isInteger(major) ? major.toLocaleString('en-IN') : major.toFixed(2);
  return `${symbol}${body}`;
}

/** Pick the price row for a region out of a `prices` array from the API. */
export function priceFor(prices, region) {
  if (!Array.isArray(prices)) return null;
  return prices.find((p) => p.billingRegion === region) || null;
}

/**
 * Load the catalogue, and hold the currency-toggle state.
 *
 * `availableRegions` is derived from what the API actually returned rather
 * than assumed: while USD_PRICING_ENABLED is off the server sends INR only,
 * and the toggle must not offer a currency that has no prices behind it.
 */
export function usePricing({ initialRegion } = {}) {
  const [catalogue, setCatalogue] = useState(null);
  const [region, setRegion] = useState(initialRegion || REGION_IN);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [regionTouched, setRegionTouched] = useState(Boolean(initialRegion));

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await api.get('/api/billing/plans');
        if (cancelled) return;
        setCatalogue(data);

        // Default the toggle to the hinted region, but only if it is one the
        // server actually offers, and never over an explicit choice.
        if (!regionTouched) {
          const hint = detectRegionHint();
          setRegion(data.regions?.includes(hint) ? hint : data.regions?.[0] || REGION_IN);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately once on mount: the catalogue does not change while the
    // page is open, and refetching on every toggle would be pointless work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseRegion = useCallback((next) => {
    setRegionTouched(true);
    setRegion(next);
  }, []);

  const availableRegions = catalogue?.regions || [REGION_IN];

  return {
    loading,
    error,
    plans: catalogue?.plans || [],
    region,
    setRegion: chooseRegion,
    availableRegions,
    /** True only when there is a real choice to offer — one currency needs no toggle. */
    showCurrencyToggle: availableRegions.length > 1,
    /**
     * Server-reported flags for the PUBLIC marketing page, which has no
     * session and so cannot read them from /auth/me. Sourced from the same
     * backend environment as everything else — never a NEXT_PUBLIC_ mirror
     * that could be set differently and make a claim we have not earned.
     */
    metaApproved: Boolean(catalogue?.features?.metaApproved),
    currency: region === REGION_IN ? 'INR' : 'USD',
  };
}

/**
 * Is moving to Pro genuinely cheaper for this tenant RIGHT NOW?
 *
 * Replaces an earlier "show the pitch on their first add-on purchase"
 * trigger, which was a hardcoded threshold asserting something that was not
 * arithmetically true: at the prices then seeded, three Starter packs bought
 * the same 2,000 replies as Pro for LESS than Pro cost. The banner would
 * have claimed a saving that did not exist.
 *
 * So this computes the claim instead of assuming it. The banner may only say
 * "you would save X" when, from PlanPrice at render time:
 *
 *   1. the cheapest Pro configuration matching or beating what this tenant
 *      currently has costs STRICTLY LESS than what they are paying now, and
 *   2. that Pro configuration delivers equal-or-better entitlements — never
 *      a saving bought by quietly giving them fewer replies or fewer
 *      accounts.
 *
 * Both sides are priced from the catalogue, so this stays true through any
 * future price change. A threshold would silently start lying the next time
 * a number moves.
 *
 * @returns {{kind:'saving', amount, formatted, currency, pro:{replies,accounts,formattedPrice}}
 *          |{kind:'comparison', pro:{replies,accounts,formattedPrice}}
 *          |null}
 *   'saving'     — condition met; savings language is permitted.
 *   'comparison' — condition NOT met; show the factual Pro line with NO
 *                  savings language.
 *   null         — the catalogue is missing a price, so say nothing at all
 *                  rather than guess.
 */
export function proUpgradeVerdict({ plans, region, replyCreditPacksThisCycle = 0, extraIgAccounts = 0 }) {
  const starter = plans.find((p) => p.code === 'STARTER');
  const pro = plans.find((p) => p.code === 'PRO');
  if (!starter || !pro) return null;

  const starterPlan = priceFor(starter.prices, region);
  const proPlan = priceFor(pro.prices, region);
  const starterPack = priceFor(starter.addons?.replyCredits?.[0]?.prices, region);
  const proPack = priceFor(pro.addons?.replyCredits?.[0]?.prices, region);
  const starterIg = priceFor(starter.addons?.extraIgAccount?.prices, region);
  const proIg = priceFor(pro.addons?.extraIgAccount?.prices, region);
  if (!starterPlan || !proPlan) return null;

  const packCredits = starter.addons?.replyCredits?.[0]?.creditAmount ?? 0;
  const currency = proPlan.currency;

  // The factual line about Pro ITSELF, used by the comparison branch: what
  // the plan includes and what the plan costs, with no add-ons folded in.
  const proLine = {
    replies: pro.autoReplyCreditsPerCycle,
    accounts: pro.igAccountLimit,
    formattedPrice: formatPrice(proPlan.amount, currency),
  };

  // What the tenant is provisioned for, and paying, this cycle.
  const currentReplies = (starter.autoReplyCreditsPerCycle ?? 0) + packCredits * replyCreditPacksThisCycle;
  const currentAccounts = (starter.igAccountLimit ?? 0) + extraIgAccounts;

  if (replyCreditPacksThisCycle > 0 && !starterPack) return { kind: 'comparison', pro: proLine };
  if (extraIgAccounts > 0 && !starterIg) return { kind: 'comparison', pro: proLine };

  const currentCost =
    starterPlan.amount +
    (starterPack?.amount ?? 0) * replyCreditPacksThisCycle +
    (starterIg?.amount ?? 0) * extraIgAccounts;

  // Cheapest Pro configuration that is NOT a downgrade: top up only where
  // Pro's own allowance falls short of what they already have.
  const replyShortfall = Math.max(0, currentReplies - (pro.autoReplyCreditsPerCycle ?? 0));
  const packsNeeded = packCredits > 0 ? Math.ceil(replyShortfall / packCredits) : 0;
  const accountShortfall = Math.max(0, currentAccounts - (pro.igAccountLimit ?? 0));

  // If a shortfall exists but the add-on that would close it has no price,
  // no honest Pro total can be computed.
  if (packsNeeded > 0 && !proPack) return { kind: 'comparison', pro: proLine };
  if (accountShortfall > 0 && !proIg) return { kind: 'comparison', pro: proLine };

  const proCost =
    proPlan.amount + (proPack?.amount ?? 0) * packsNeeded + (proIg?.amount ?? 0) * accountShortfall;

  const proReplies = (pro.autoReplyCreditsPerCycle ?? 0) + packCredits * packsNeeded;
  const proAccounts = (pro.igAccountLimit ?? 0) + accountShortfall;
  const equalOrBetter = proReplies >= currentReplies && proAccounts >= currentAccounts;

  if (proCost < currentCost && equalOrBetter) {
    const amount = currentCost - proCost;
    return {
      kind: 'saving',
      amount,
      currency,
      formatted: formatPrice(amount, currency),
      // Describes the configuration that was actually PRICED, not bare Pro.
      // When Pro needs a top-up to match what the tenant already has, the
      // saving is computed from the topped-up total, so quoting bare Pro
      // beside it would advertise fewer replies than the figure was based on
      // — the same species of false claim this function exists to stop.
      pro: {
        replies: proReplies,
        accounts: proAccounts,
        formattedPrice: formatPrice(proCost, currency),
      },
    };
  }

  return { kind: 'comparison', pro: proLine };
}
