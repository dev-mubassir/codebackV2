/**
 * Auto DM plan limits (Gate 9B): how many automations may be active and how
 * many Auto DMs a billing period allows, per plan — plus the admin's
 * enforcement switch and the per-user "No limits" exemption.
 *
 * THE SEED. DEFAULT_LIMITS below are the launch numbers. A plan without a row
 * in autodm_plan_limits uses them; the admin page writes a row when a plan is
 * edited. They live in code, not in a migration, because Auto DM migrations
 * only ever create tables. Every other place (the pricing cards, the customer
 * meter, the admin page) reads the effective limits from here — no number is
 * repeated anywhere else.
 *
 *   TRIAL       30 automations,  1,000 Auto DMs per trial
 *   STARTER    100 automations, 10,000 Auto DMs per billing period
 *   PRO        500 automations, 100,000 Auto DMs per period, shown "Unlimited*"
 *   ENTERPRISE  set by the admin; until then it uses PRO's limits
 *   (any other plan code: TRIAL's — the safest)
 *
 * ENFORCEMENT (app_settings `autodm_enforcement`, OFF | ON, default OFF). OFF:
 * usage is counted and shown, nothing is blocked. ON: new runs wait
 * (WAITING_QUOTA) when the period's Auto DMs are used up or there is no active
 * plan/trial, and automations beyond the limit cannot be activated. Stays OFF
 * until billing is enabled (after Meta approval). An exempt user ("No limits",
 * e.g. the Meta reviewer) is never blocked either way.
 */

const prisma = require('../../lib/prisma');
const log = require('./log');

const DEFAULT_LIMITS = Object.freeze({
  TRIAL: Object.freeze({ maxAutomations: 30, monthlyDms: 1000, displayUnlimited: false }),
  STARTER: Object.freeze({ maxAutomations: 100, monthlyDms: 10000, displayUnlimited: false }),
  PRO: Object.freeze({ maxAutomations: 500, monthlyDms: 100000, displayUnlimited: true }),
});
// Enterprise is set by the admin; until then it gets Pro's numbers.
const FALLBACK_PLAN = { ENTERPRISE: 'PRO' };

const MAX_LIMIT = 10000000; // sanity bound for admin input
const ENFORCEMENT_MODES = Object.freeze(['OFF', 'ON']);
const ENFORCEMENT_KEY = 'autodm_enforcement';
const TTL_MS = 10 * 1000;

let enforcementCache = { value: 'OFF', at: 0 };
let limitsCache = { value: null, at: 0 }; // Map planCode -> row

function defaultFor(planCode) {
  const code = typeof planCode === 'string' ? planCode : '';
  return DEFAULT_LIMITS[code] || DEFAULT_LIMITS[FALLBACK_PLAN[code]] || DEFAULT_LIMITS.TRIAL;
}

async function customRows() {
  const now = Date.now();
  if (limitsCache.value && now - limitsCache.at < TTL_MS) return limitsCache.value;
  const rows = await prisma.autoDmPlanLimit.findMany({ include: { plan: { select: { code: true } } } });
  const map = new Map(rows.map((r) => [r.plan.code, r]));
  limitsCache = { value: map, at: now };
  return map;
}

/**
 * The effective limits for a plan code: { maxAutomations, monthlyDms,
 * displayUnlimited, source: 'custom' | 'default' }. A read failure falls back
 * to the defaults — never to "unlimited".
 */
async function getPlanLimits(planCode) {
  try {
    const row = (await customRows()).get(planCode);
    if (row) {
      return { maxAutomations: row.maxAutomations, monthlyDms: row.monthlyDms, displayUnlimited: row.displayUnlimited, source: 'custom' };
    }
  } catch (err) {
    log.error(`could not read plan limits (${err && err.code ? err.code : 'error'}); using the defaults`);
  }
  return { ...defaultFor(planCode), source: 'default' };
}

/** Every plan in the catalogue with its effective limits (admin page, pricing). */
async function listPlanLimits() {
  const plans = await prisma.plan.findMany({
    select: { code: true, name: true, isActive: true, isQuoteOnly: true, cycleLengthDays: true },
  });
  const order = { TRIAL: 0, STARTER: 1, PRO: 2, ENTERPRISE: 3 };
  plans.sort((a, b) => (order[a.code] ?? 9) - (order[b.code] ?? 9) || a.code.localeCompare(b.code));
  const out = [];
  for (const p of plans) out.push({ planCode: p.code, name: p.name, isActive: p.isActive, cycleLengthDays: p.cycleLengthDays, ...(await getPlanLimits(p.code)) });
  return out;
}

/** Admin only. Returns { before, after }. Throws code NO_PLAN for an unknown plan. */
async function setPlanLimits(planCode, { maxAutomations, monthlyDms, displayUnlimited }, adminId = null) {
  const plan = await prisma.plan.findUnique({ where: { code: planCode }, select: { id: true } });
  if (!plan) {
    const err = new Error('unknown plan');
    err.code = 'NO_PLAN';
    throw err;
  }
  const before = await getPlanLimits(planCode);
  const data = { maxAutomations, monthlyDms, displayUnlimited: Boolean(displayUnlimited), updatedByAdminId: adminId };
  await prisma.autoDmPlanLimit.upsert({ where: { planId: plan.id }, create: { planId: plan.id, ...data }, update: data });
  limitsCache = { value: null, at: 0 };
  const { source: _s, ...beforeValues } = before;
  return { before: beforeValues, after: { maxAutomations, monthlyDms, displayUnlimited: Boolean(displayUnlimited) } };
}

/** The enforcement switch (cached briefly). A read problem = the last known value, else OFF. */
async function getEnforcement() {
  const now = Date.now();
  if (now - enforcementCache.at < TTL_MS) return enforcementCache.value;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: ENFORCEMENT_KEY } });
    const value = row && ENFORCEMENT_MODES.includes(row.value) ? row.value : 'OFF';
    enforcementCache = { value, at: now };
    return value;
  } catch (err) {
    log.error(`could not read the enforcement switch (${err && err.code ? err.code : 'error'}); using ${enforcementCache.value}`);
    return enforcementCache.at ? enforcementCache.value : 'OFF';
  }
}

/** Admin only. Returns { before, after }. */
async function setEnforcement(mode, adminId = null) {
  if (!ENFORCEMENT_MODES.includes(mode)) {
    const err = new Error('invalid enforcement mode');
    err.code = 'INVALID_MODE';
    throw err;
  }
  const row = await prisma.appSetting.findUnique({ where: { key: ENFORCEMENT_KEY } });
  const before = row && ENFORCEMENT_MODES.includes(row.value) ? row.value : 'OFF';
  await prisma.appSetting.upsert({
    where: { key: ENFORCEMENT_KEY },
    create: { key: ENFORCEMENT_KEY, value: mode, updatedBy: adminId },
    update: { value: mode, updatedBy: adminId },
  });
  enforcementCache = { value: mode, at: Date.now() };
  return { before, after: mode };
}

async function isExempt(userId) {
  if (!userId) return false;
  const row = await prisma.autoDmExemption.findUnique({ where: { userId }, select: { id: true } });
  return Boolean(row);
}

/** Admin only. Returns { before, after } as booleans. */
async function setExempt(userId, exempt, { note = null, adminId = null } = {}) {
  const before = await isExempt(userId);
  if (exempt && !before) {
    await prisma.autoDmExemption.create({ data: { userId, note, grantedByAdminId: adminId } }).catch((err) => {
      if (!err || err.code !== 'P2002') throw err;
    });
  } else if (!exempt && before) {
    await prisma.autoDmExemption.deleteMany({ where: { userId } });
  }
  return { before, after: Boolean(exempt) };
}

/** Tests only: forget cached settings (the DB is reset between tests). */
function resetLimitsCache() {
  enforcementCache = { value: 'OFF', at: 0 };
  limitsCache = { value: null, at: 0 };
}

module.exports = {
  DEFAULT_LIMITS,
  MAX_LIMIT,
  ENFORCEMENT_MODES,
  ENFORCEMENT_KEY,
  getPlanLimits,
  listPlanLimits,
  setPlanLimits,
  getEnforcement,
  setEnforcement,
  isExempt,
  setExempt,
  resetLimitsCache,
};
