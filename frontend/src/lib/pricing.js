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
    currency: region === REGION_IN ? 'INR' : 'USD',
  };
}

/**
 * What a Starter tenant would save per cycle by moving to Pro, given they
 * are buying `addonPacksPerCycle` reply-credit packs on top of Starter.
 *
 * This is the number behind the upgrade pitch, and it lives here rather
 * than in the billing page so the marketing page can state the same figure
 * without recomputing it differently.
 *
 * Returns null when the comparison cannot be made honestly — a missing
 * price row, or a case where Pro is not actually cheaper.
 */
export function proUpgradeSaving({ plans, region, addonPacksPerCycle = 1 }) {
  const starter = plans.find((p) => p.code === 'STARTER');
  const pro = plans.find((p) => p.code === 'PRO');
  if (!starter || !pro) return null;

  const starterPlan = priceFor(starter.prices, region);
  const proPlan = priceFor(pro.prices, region);
  if (!starterPlan || !proPlan) return null;

  const starterPack = priceFor(starter.addons?.replyCredits?.[0]?.prices, region);
  if (!starterPack) return null;

  const starterTotal = starterPlan.amount + starterPack.amount * addonPacksPerCycle;
  const saving = starterTotal - proPlan.amount;
  if (saving <= 0) return null;

  return { amount: saving, currency: proPlan.currency, formatted: formatPrice(saving, proPlan.currency) };
}
