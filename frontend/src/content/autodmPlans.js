/**
 * Auto DM plan limits as the public pages state them — the ONE place the
 * landing section, the landing pricing rows and the Terms fair-use section
 * read them from. They mirror the backend seed (DEFAULT_LIMITS in
 * backend/src/features/autodm/limits.js); backend/tests/autodm-landing.test.js
 * fails if the two ever disagree. The signed-in pages (Auto DM meter, billing
 * row) read the live limits from the API instead.
 */

export const AUTODM_PLAN_LIMITS = Object.freeze({
  TRIAL: Object.freeze({ maxAutomations: 30, monthlyDms: 1000, displayUnlimited: false }),
  STARTER: Object.freeze({ maxAutomations: 100, monthlyDms: 10000, displayUnlimited: false }),
  PRO: Object.freeze({ maxAutomations: 500, monthlyDms: 100000, displayUnlimited: true }),
});

/** Terms "Fair use": Pro's real numbers, per Siffty account per calendar month. */
export const AUTODM_FAIR_USE = Object.freeze({
  monthlyDms: AUTODM_PLAN_LIMITS.PRO.monthlyDms,
  activeAutomations: AUTODM_PLAN_LIMITS.PRO.maxAutomations,
  // Meta's own cap on private replies, per Instagram account per hour.
  metaPrivateRepliesPerHour: 750,
});

const n = (x) => x.toLocaleString('en-IN');

/**
 * The pricing row for a plan: "30 automations · 1,000 Auto DMs" (trial),
 * "100 automations · 10,000 Auto DMs/month", or
 * "Unlimited* automations · Unlimited* Auto DMs" for a plan shown as unlimited.
 */
export function autodmPlanRow(planCode) {
  const l = AUTODM_PLAN_LIMITS[planCode];
  if (!l) return null;
  if (l.displayUnlimited) return 'Unlimited* automations · Unlimited* Auto DMs';
  return `${n(l.maxAutomations)} automations · ${n(l.monthlyDms)} Auto DMs${planCode === 'TRIAL' ? '' : '/month'}`;
}
