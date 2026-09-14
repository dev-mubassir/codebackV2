/**
 * Kill switch for the entire billing feature.
 *
 * Defaults to false — per the feat/billing brief, nothing about billing may
 * become visible or reachable until this is explicitly set in the
 * environment, because Meta App Review is in progress and a reviewer's test
 * account must see a product with no billing surface at all.
 *
 * Read once at module load, same convention as webhook.js's `isProduction`
 * — flipping it is an env var change on Northflank, which redeploys/
 * restarts the process anyway, so there is no hot-reload requirement here.
 *
 * Checked at the TOP of every billing-adjacent route handler (not just at
 * mount time), and the disabled response is a plain 404 — never 403 —
 * so a disabled route gives no signal that billing exists at all.
 */
const BILLING_ENABLED = process.env.BILLING_ENABLED === 'true';

/** META_APPROVED gates the "official Instagram Graph API" half of the Gate 6 trust badge. Also defaults false. */
const META_APPROVED = process.env.META_APPROVED === 'true';

module.exports = { BILLING_ENABLED, META_APPROVED };
