/**
 * Plan-change rules as the pages see them.
 *
 * The rule itself lives on the server (entitlementService.downgradeBlock):
 * while a paid plan is ACTIVE, a lower tier cannot be bought until that paid
 * period ends. The checkout API refuses such a purchase with
 * PLAN_DOWNGRADE_BLOCKED, and GET /api/billing/summary reports which plans are
 * blocked (summary.planChange) so a card never offers a purchase the API will
 * refuse. This file only reads that answer — it never re-derives the rule.
 *
 * DEPENDENCY-FREE ON PURPOSE, so the backend suite can import it
 * (tests/plan-change-ui.test.js); the frontend has no test runner.
 */

export const PLAN_DOWNGRADE_BLOCKED = 'PLAN_DOWNGRADE_BLOCKED';

/**
 * @returns {{ availableFrom: string } | null} when buying `planCode` must wait,
 *   the date it becomes possible; otherwise null.
 */
export function planBlock(summary, planCode) {
  const change = summary?.planChange;
  if (!change?.availableFrom || !Array.isArray(change.blockedPlanCodes)) return null;
  return change.blockedPlanCodes.includes(planCode) ? { availableFrom: change.availableFrom } : null;
}
