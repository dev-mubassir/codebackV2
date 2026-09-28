/**
 * Auto DM usage and quota (Gate 9B).
 *
 * COUNTING UNIT. 1 Auto DM = 1 person who received the opening DM (the run
 * reached OPENER_SENT or OPENER_UNCONFIRMED). Follow prompts, the link
 * message and public replies are free; FAILED, EXPIRED and skipped runs do
 * not count.
 *
 * PERIOD. Usage is per user per billing period, and the period is the
 * entitlement's cycle (cycleStartedAt) — the same clock the plan's credits
 * roll on: grantPlan() and rollCycle() (jobs/entitlementCycleJob.js) restamp
 * it, and a new period starts at 0. Unused Auto DMs do not carry over (a
 * quota, like the classification count, not purchased credits). A user with
 * no entitlement row is counted per calendar month (UTC).
 *
 * RESERVE BEFORE SEND. The worker reserves one Auto DM before the opener, in
 * ONE transaction that also moves the run QUEUED -> SENDING:
 *     UPDATE autodm_usage SET used = used + 1 WHERE id = … AND used < limit RETURNING used
 * so N concurrent sends at limit-1 produce exactly one send. SENDING marks a
 * reservation held by that run: a crash-and-reclaim never reserves twice. A
 * definite send failure releases it (SENDING -> QUEUED, used - 1); an
 * unconfirmed send keeps it (the person may have the DM).
 *
 * OUT OF QUOTA / NO ACTIVE PLAN (enforcement ON only): the comment is never
 * dropped. The run waits as WAITING_QUOTA (not claimable) and the sweep below
 * releases it — oldest comment first — once the period resets, the user
 * upgrades, the admin raises the limit or turns enforcement off. It expires 7
 * days after the comment, when Instagram no longer allows the private reply.
 * GRACE counts as "no active plan", as for auto-replies: Auto DM acts in the
 * customer's name.
 *
 * NOTICES. Once per period at 80% and at 100% (enforcement ON, not exempt):
 * an email through lib/email, and the banner on the Auto DM page (usage()).
 *
 * DOWNGRADE. With enforcement ON, a user with more active automations than
 * the plan allows keeps the newest N active; the rest become 'paused_limit'
 * (shown with a notice; never deleted, re-activated by hand within the limit).
 */

const prisma = require('../../lib/prisma');
const mailer = require('../../lib/email');
const { effectiveStatus } = require('../../services/entitlementService');
const { runIfDue } = require('../../jobs/scheduler');
const log = require('./log');
const { hasAutoDmAccess } = require('./access');
const { getPlanLimits, getEnforcement, isExempt, listPlanLimits } = require('./limits');

const JOB_NAME = 'autodm_quota';
const SWEEP_EVERY_MS = 2 * 60 * 1000;
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RELEASE_BATCH = 500; // per user per sweep
const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_AT = 0.8;
const ACTIVE_STATUSES = ['TRIALING', 'ACTIVE'];

let lastSweepAt = 0;

const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

function monthBounds(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * Everything a quota decision needs for one user:
 * { userId, planCode, status, active, enforced, exempt, limits,
 *   periodStart, periodEnd }.
 */
async function contextFor(userId, now = new Date()) {
  const entitlement = await prisma.entitlement.findUnique({
    where: { userId },
    select: { planCode: true, status: true, validUntil: true, graceUntil: true, cycleStartedAt: true },
  });
  const status = effectiveStatus(entitlement, now);
  const planCode = (entitlement && entitlement.planCode) || 'TRIAL';
  const [limits, enforcement, exempt, plan] = await Promise.all([
    getPlanLimits(planCode),
    getEnforcement(),
    isExempt(userId),
    prisma.plan.findUnique({ where: { code: planCode }, select: { cycleLengthDays: true } }),
  ]);

  let periodStart;
  let periodEnd;
  if (entitlement && entitlement.status !== 'NONE' && entitlement.cycleStartedAt) {
    periodStart = entitlement.cycleStartedAt;
    periodEnd = new Date(periodStart.getTime() + ((plan && plan.cycleLengthDays) || 30) * DAY_MS);
  } else {
    ({ start: periodStart, end: periodEnd } = monthBounds(now));
  }

  return {
    userId,
    planCode,
    status,
    active: ACTIVE_STATUSES.includes(status),
    exempt,
    enforced: enforcement === 'ON' && !exempt,
    limits,
    periodStart,
    periodEnd,
  };
}

/** The usage row for this period, created at 0 if missing. Returns { id, used, … }. */
async function usageRow(ctx) {
  const where = { userId_periodStart: { userId: ctx.userId, periodStart: ctx.periodStart } };
  try {
    return await prisma.autoDmUsage.upsert({
      where,
      create: { userId: ctx.userId, periodStart: ctx.periodStart, planCode: ctx.planCode },
      update: {},
    });
  } catch (err) {
    if (err && err.code === 'P2002') return prisma.autoDmUsage.findUnique({ where });
    throw err;
  }
}

async function findUsageRow(ctx) {
  return prisma.autoDmUsage.findUnique({
    where: { userId_periodStart: { userId: ctx.userId, periodStart: ctx.periodStart } },
  });
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

async function sendNotice(ctx, level, used) {
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });
  if (!user || !user.email) return;
  await mailer.sendAutoDmUsage(user.email, {
    level,
    used,
    limit: ctx.limits.monthlyDms,
    resetsAt: ctx.periodEnd,
    url: `${frontendUrl()}/autodm`,
  });
  log.info(`usage notice ${level}% sent (user ${ctx.userId})`);
}

/** Claim-then-send, once per period per level. Best-effort: never blocks a send. */
async function maybeNotify(ctx, rowId, used) {
  if (!ctx.enforced) return;
  const limit = ctx.limits.monthlyDms;
  const now = new Date();
  try {
    if (used >= limit) {
      const claimed = await prisma.autoDmUsage.updateMany({ where: { id: rowId, warned100At: null }, data: { warned100At: now } });
      await prisma.autoDmUsage.updateMany({ where: { id: rowId, warned80At: null }, data: { warned80At: now } });
      if (claimed.count === 1) await sendNotice(ctx, 100, used);
    } else if (used >= Math.ceil(limit * WARN_AT)) {
      const claimed = await prisma.autoDmUsage.updateMany({ where: { id: rowId, warned80At: null }, data: { warned80At: now } });
      if (claimed.count === 1) await sendNotice(ctx, 80, used);
    }
  } catch (err) {
    log.warn(`usage notice failed (${err && err.code ? err.code : 'error'})`);
  }
}

// ---------------------------------------------------------------------------
// Reserve / release (worker)
// ---------------------------------------------------------------------------

/**
 * Reserve one Auto DM for `run` (status QUEUED). Returns
 * 'OK' (run is now SENDING) | 'QUOTA' | 'NO_PLAN' (run untouched).
 */
async function reserve(run, ctx = null) {
  ctx = ctx || (await contextFor(run.userId));
  if (ctx.enforced && !ctx.active) return 'NO_PLAN';

  const row = await usageRow(ctx);
  const limit = ctx.limits.monthlyDms;
  let used = null;
  try {
    used = await prisma.$transaction(async (tx) => {
      const rows = ctx.enforced
        ? await tx.$queryRaw`
            UPDATE "autodm_usage" SET "used" = "used" + 1, "updated_at" = (NOW() AT TIME ZONE 'UTC')
             WHERE "id" = ${row.id} AND "used" < ${limit}
         RETURNING "used"`
        : await tx.$queryRaw`
            UPDATE "autodm_usage" SET "used" = "used" + 1, "updated_at" = (NOW() AT TIME ZONE 'UTC')
             WHERE "id" = ${row.id}
         RETURNING "used"`;
      if (rows.length === 0) return null;
      const moved = await tx.autoDmRun.updateMany({ where: { id: run.id, status: 'QUEUED' }, data: { status: 'SENDING' } });
      if (moved.count !== 1) {
        const err = new Error('run is no longer queued');
        err.code = 'RUN_MOVED';
        throw err; // rolls the increment back
      }
      return Number(rows[0].used);
    });
  } catch (err) {
    if (err && err.code === 'RUN_MOVED') return 'MOVED';
    throw err;
  }

  if (used === null) {
    await maybeNotify(ctx, row.id, limit);
    return 'QUOTA';
  }
  await maybeNotify(ctx, row.id, used);
  return 'OK';
}

/** A definite send failure: give the reservation back (SENDING -> QUEUED, used - 1). */
async function release(run) {
  const ctx = await contextFor(run.userId);
  const row = await findUsageRow(ctx);
  await prisma.$transaction(async (tx) => {
    const moved = await tx.autoDmRun.updateMany({ where: { id: run.id, status: 'SENDING' }, data: { status: 'QUEUED' } });
    if (moved.count === 1 && row) {
      await tx.$executeRaw`
        UPDATE "autodm_usage" SET "used" = GREATEST("used" - 1, 0), "updated_at" = (NOW() AT TIME ZONE 'UTC')
         WHERE "id" = ${row.id}`;
    }
  });
}

// ---------------------------------------------------------------------------
// Automation limit (routes)
// ---------------------------------------------------------------------------

/**
 * May this user have one more ACTIVE automation? `excludeId` = the
 * automation being (re)activated. Returns null (allowed) or { max }.
 */
async function automationLimitBlock(userId, excludeId = null) {
  const ctx = await contextFor(userId);
  if (!ctx.enforced) return null;
  const active = await prisma.autoDmAutomation.count({
    where: { userId, status: 'active', ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  return active >= ctx.limits.maxAutomations ? { max: ctx.limits.maxAutomations } : null;
}

// ---------------------------------------------------------------------------
// The sweep: expire, release, enforce the automation limit
// ---------------------------------------------------------------------------

async function expireHeld(now) {
  const res = await prisma.autoDmRun.updateMany({
    where: { status: 'WAITING_QUOTA', commentCreatedAt: { lte: new Date(now - PRIVATE_REPLY_WINDOW_MS) } },
    // lastError (QUOTA / NO_PLAN) stays: the run log says why it never went out.
    data: { status: 'EXPIRED', pendingAction: null, nextAttemptAt: null, claimedAt: null },
  });
  return res.count;
}

async function releaseHeld() {
  const groups = await prisma.autoDmRun.groupBy({ by: ['userId'], where: { status: 'WAITING_QUOTA' } });
  let released = 0;
  for (const { userId } of groups) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user || !(await hasAutoDmAccess(user))) continue; // held until access is back (or 7 days)
    const ctx = await contextFor(userId);
    if (ctx.enforced && !ctx.active) continue;
    let room = RELEASE_BATCH;
    if (ctx.enforced) {
      const row = await findUsageRow(ctx);
      room = Math.min(room, Math.max(0, ctx.limits.monthlyDms - (row ? row.used : 0)));
    }
    if (room === 0) continue;
    const ids = (
      await prisma.autoDmRun.findMany({
        where: { userId, status: 'WAITING_QUOTA' },
        orderBy: { commentCreatedAt: 'asc' },
        take: room,
        select: { id: true },
      })
    ).map((r) => r.id);
    if (ids.length === 0) continue;
    const res = await prisma.autoDmRun.updateMany({
      where: { id: { in: ids }, status: 'WAITING_QUOTA' },
      data: { status: 'QUEUED', pendingAction: 'OPENER', nextAttemptAt: new Date(), claimedAt: null, attempts: 0, lastError: null },
    });
    released += res.count;
    if (res.count) log.info(`released ${res.count} held run(s) (user ${userId})`);
  }
  return released;
}

async function pauseOverLimit() {
  if ((await getEnforcement()) !== 'ON') return 0;
  const plans = await listPlanLimits();
  const smallest = Math.min(...plans.map((p) => p.maxAutomations), 30);
  const over = await prisma.autoDmAutomation.groupBy({
    by: ['userId'],
    where: { status: 'active' },
    _count: { _all: true },
    having: { id: { _count: { gt: smallest } } },
  });
  let paused = 0;
  for (const g of over) {
    const ctx = await contextFor(g.userId);
    if (!ctx.enforced || g._count._all <= ctx.limits.maxAutomations) continue;
    const extra = await prisma.autoDmAutomation.findMany({
      where: { userId: g.userId, status: 'active' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: ctx.limits.maxAutomations, // keep the newest N
      select: { id: true },
    });
    const res = await prisma.autoDmAutomation.updateMany({
      where: { id: { in: extra.map((a) => a.id) }, status: 'active' },
      data: { status: 'paused_limit' },
    });
    paused += res.count;
    if (res.count) log.info(`paused ${res.count} automation(s) over the plan limit (user ${g.userId})`);
  }
  return paused;
}

async function sweep({ now = Date.now() } = {}) {
  const expired = await expireHeld(now);
  const released = await releaseHeld();
  const paused = await pauseOverLimit();
  if (expired || released || paused) log.info(`quota sweep: ${released} released, ${expired} expired, ${paused} automation(s) paused`);
  return { expired, released, paused };
}

/** Called every worker tick; at most once per interval across pods (advisory lock). */
async function maybeSweep({ now = Date.now() } = {}) {
  if (now - lastSweepAt < SWEEP_EVERY_MS) return null;
  lastSweepAt = now;
  return runIfDue(JOB_NAME, SWEEP_EVERY_MS, () => sweep({ now }));
}

function resetQuotaState() {
  lastSweepAt = 0;
}

// ---------------------------------------------------------------------------
// What the customer sees (Auto DM page meter, billing row)
// ---------------------------------------------------------------------------

async function usage(userId) {
  const ctx = await contextFor(userId);
  const [row, activeAutomations, pausedForLimit, held] = await Promise.all([
    findUsageRow(ctx),
    prisma.autoDmAutomation.count({ where: { userId, status: 'active' } }),
    prisma.autoDmAutomation.count({ where: { userId, status: 'paused_limit' } }),
    prisma.autoDmRun.count({ where: { userId, status: 'WAITING_QUOTA' } }),
  ]);
  const used = row ? row.used : 0;
  const limit = ctx.limits.monthlyDms;

  let notice = null;
  if (ctx.enforced) {
    if (!ctx.active) notice = 'no_plan';
    else if (used >= limit) notice = 'limit';
    else if (used >= Math.ceil(limit * WARN_AT)) notice = 'warn80';
  }

  return {
    planCode: ctx.planCode,
    used,
    limit,
    displayUnlimited: ctx.limits.displayUnlimited,
    maxAutomations: ctx.limits.maxAutomations,
    activeAutomations,
    pausedForLimit,
    held,
    enforced: ctx.enforced,
    periodStart: ctx.periodStart,
    periodEnd: ctx.periodEnd,
    notice,
  };
}

module.exports = {
  JOB_NAME,
  SWEEP_EVERY_MS,
  WARN_AT,
  contextFor,
  reserve,
  release,
  automationLimitBlock,
  sweep,
  maybeSweep,
  resetQuotaState,
  usage,
};
