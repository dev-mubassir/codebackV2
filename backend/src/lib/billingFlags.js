/**
 * Kill switches for the billing feature.
 *
 * Exported as FUNCTIONS, not constants, and each one reads process.env at
 * call time. Two reasons:
 *
 *   1. A kill switch that is captured once at module load cannot actually
 *      be flipped — it needs a process restart, which is the opposite of
 *      what a kill switch is for.
 *   2. Enforcement points (the message hot path, the checkout routes, the
 *      webhook) are untestable otherwise: the flag would be frozen false
 *      at import time, before any test could set it, so every enforcement
 *      test would silently assert the disabled path.
 *
 * The env lookup is a property read on an object that is already in memory.
 * It is not worth caching.
 */

/**
 * Master switch for the entire billing feature. Defaults to false — per the
 * feat/billing brief, nothing about billing may become visible or reachable
 * until this is explicitly set, because Meta App Review is in progress and a
 * reviewer's test account must see a product with no billing surface at all.
 *
 * Checked at the TOP of every billing-adjacent route handler and at every
 * enforcement point, and the disabled HTTP response is a plain 404 — never
 * 403 — so a disabled route gives no signal that billing exists.
 */
function isBillingEnabled() {
  // Gate 7: the admin kill switch `enforce_subscriptions` (lib/settings.js).
  // With no admin value it defaults to BILLING_ENABLED, read at call time —
  // so behaviour is exactly as before until an admin changes it. Required
  // lazily: settings -> prisma must not load while this module initialises.
  return require('./settings').getSettingSync('enforce_subscriptions') === true;
}

/** Gates the "official Instagram Graph API" half of the Gate 6 trust badge. Defaults false. */
function isMetaApproved() {
  return process.env.META_APPROVED === 'true';
}

/**
 * Gates USD plan VISIBILITY only — a currency toggle, not a pricing
 * migration. PlanPrice rows for USD/INTL stay in the database regardless of
 * this flag's value, so flipping it on is a plain env var change, never a
 * migration or a backfill.
 */
function isUsdPricingEnabled() {
  return process.env.USD_PRICING_ENABLED === 'true';
}

module.exports = { isBillingEnabled, isMetaApproved, isUsdPricingEnabled };
