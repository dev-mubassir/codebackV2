'use client';

/**
 * Marketing pricing section. STUB — Gate 6 implements the body.
 *
 * Created by Wave 0 so Gate 6 has its own file to write in and never needs
 * to touch shared contract code. Gate 6 owns this file and may add siblings
 * beside it; it renders into the homepage (src/app/page.js), which Gate 6
 * also owns.
 *
 * ---------------------------------------------------------------------
 * WHAT GATE 6 BUILDS HERE
 * ---------------------------------------------------------------------
 * Three cards — Starter / Pro / Enterprise — rendered with the SHARED
 * <PlanCard>, not a second card implementation. Pro is marked recommended.
 * Currency toggle defaults to the IP/timezone-hinted region and only
 * appears when the API actually offers more than one currency
 * (usePricing().showCurrencyToggle).
 *
 * Add-on prices show under each card. The Starter-vs-Pro add-on gap is the
 * pull toward upgrading, so it has to be visible on both cards at once —
 * <PlanCard> already renders them.
 *
 * Prominent copy, with real visual weight (a selling point in the Indian
 * market, not a footnote):
 *   "No auto-debit. No mandate. Pay only when you want to continue."
 *
 * TRUST BADGE — build it exactly as specified, and read this before
 * touching it:
 *   - Text only. NO Meta or Instagram logo files. Their brand guidelines
 *     prohibit uses that imply endorsement or partnership, and a logo on a
 *     pricing page reads exactly that way.
 *   - NEVER the phrase "Meta Verified". That is the name of Meta's paid
 *     blue-check subscription product, which this company does not have.
 *     Using it would be a false claim about a real product.
 *   - The text is: "Meta Business Verified · Built on the official
 *     Instagram Graph API"
 *   - Gate the "Built on the official Instagram Graph API" half behind
 *     META_APPROVED (isMetaApproved(), default false) so it only appears
 *     once App Review approval has actually landed. Until then, render the
 *     first half alone.
 *
 * ENTERPRISE PRICE — FLAGGED, DO NOT GUESS. The instruction says the card
 * reads "From ₹4,999/mo · Contact us", but there is no ENTERPRISE row in
 * plan_prices, and hardcoding an amount here contradicts the zero-
 * hardcoded-prices rule. This is queued as an open decision for the owner:
 * either seed an Enterprise "from" price into the catalogue, or render
 * "Contact us" with no number. Do not pick one silently.
 *
 * Prices come from usePricing() — never hardcode an amount.
 * ---------------------------------------------------------------------
 */

export default function PricingSection() {
  // Gate 6 implements. Rendering nothing keeps the homepage unchanged until
  // then, so this stub can be merged safely.
  return null;
}
