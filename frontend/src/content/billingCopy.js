/**
 * Strings for the in-app billing page. STUB — Gate 5 fills this in.
 *
 * WHY THIS FILE EXISTS AT ALL: content/copy.js is a single shared file, and
 * both Wave 1 frontend gates would naturally add strings to it — Gate 5 for
 * the billing page, Gate 6 for the marketing pricing section. That is a
 * merge conflict waiting to happen in a file neither of them owns. Splitting
 * it means Gate 5 writes here, Gate 6 writes in copy.js, and neither has to
 * touch the other's.
 *
 * House style is copy.js's, and it applies here too:
 *   - Second person. "You", never "we".
 *   - Sentence case for headings, buttons, labels.
 *   - Buttons 3 words or fewer, verb first.
 *   - No emoji.
 *   - Errors read "Couldn't <action>. <What to do>." — no codes, no blame.
 *
 * NEVER put a price in this file. Prices come from GET /api/billing/plans
 * via lib/pricing.js, so they can change with a database UPDATE and no
 * redeploy. A number written here would silently go stale the first time
 * pricing moves.
 */

export const billing = {
  // Gate 5 implements.
};

export default billing;
