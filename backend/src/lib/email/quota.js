/**
 * Email quotas — per-recipient throttles and a global daily cap.
 *
 * WHY A GLOBAL CAP AND NOT JUST PER-RECIPIENT LIMITS.
 *
 * Per-recipient limits bound what ONE person can trigger; they say nothing
 * about the total. Forty users sending three emails each is 120 — past the
 * Resend free tier's 100/day — and once that is hit, sending stops for
 * EVERYONE. Including password resets. A marketing-ish burst of trial-ending
 * notices can therefore lock a real user out of their own account.
 *
 * So there are two independent layers, and a send must pass both.
 *
 * CRITICAL vs DEFERRABLE, and why deferrable yields.
 *
 *   CRITICAL    someone is BLOCKED right now and is waiting on this mail:
 *                 sendPasswordReset   — cannot get in without it
 *                 sendVerification    — cannot verify, so cannot connect
 *                                       Instagram or be granted a trial
 *
 *                 renewalExpiry       — the plan expires TODAY; this and the
 *                 renewalGraceFinal      grace notice are the customer's last
 *                                       two chances to keep service running,
 *                                       and a day's delay means the grace
 *                                       window closes unannounced
 *
 *   DEFERRABLE  informational; nobody is stuck mid-flow, and tomorrow's send
 *               is nearly as good as today's:
 *                 sendTrialEnding     — a notice; the trial state is also
 *                                       visible in the dashboard
 *                 sendTokenExpiry     — the account has ALREADY stopped
 *                                       working and the dashboard says so;
 *                                       a day's delay changes little
 *                 renewalDay27        — the early renewal nudges; there are
 *                 renewalDay29          three more messages behind them, so
 *                                       slipping a day costs nothing
 *
 * Deferrable sends stop at (cap - reserve). Critical sends may use the whole
 * cap. That reserve is the point: a day full of trial notices can never eat
 * the capacity a password reset needs.
 *
 * The cap is set BELOW the provider limit deliberately, so there is headroom
 * for retries and for anything sent outside this module.
 */

const DEFAULT_DAILY_CAP = 80; // under Resend free tier's 100
const DEFAULT_CRITICAL_RESERVE = 20; // of that cap, critical-only

const PER_RECIPIENT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PER_RECIPIENT_MAX = 3;

/**
 * Per-type overrides of PER_RECIPIENT_MAX.
 *
 * The per-recipient throttle stops one requester flooding one mailbox. Contact
 * enquiries break its assumption: every one of them goes to the SAME address,
 * SUPPORT_EMAIL, from different people — so a shared limit of 3 an hour would
 * silently drop the fourth genuine enquiry. Their flood protection is instead
 * the contact route's per-IP limiter plus the daily cap, and both types are
 * DEFERRABLE, so no volume of enquiries can eat the password-reset reserve.
 */
const PER_RECIPIENT_MAX_BY_TYPE = Object.freeze({
  supportEnquiry: 30,
  enterpriseEnquiry: 30,
  // Billing alerts all go to SUPPORT_EMAIL too, and each one is an event a
  // human must see — three an hour must not silently swallow the fourth.
  billingPaidAfterExpiry: 20,
  billingStaleOrdersExpired: 20,
  billingPartialRefund: 20,
  billingRefundOutsideSiffty: 20,
  billingRefundSnapshotMissing: 20,
});

function perRecipientMax(type) {
  return PER_RECIPIENT_MAX_BY_TYPE[type] ?? PER_RECIPIENT_MAX;
}

/**
 * Which sends are critical. Anything not listed is treated as deferrable.
 *
 * billingReconciliationMismatch: a mismatch means a customer paid and the
 * webhook that should have granted their plan/credits never arrived — the
 * closest thing this codebase has to "money is unaccounted for." One
 * digest per nightly run (never one per mismatch), so this can never be
 * the thing that exhausts the reserve a password reset needs.
 *
 * renewalExpiry / renewalGraceFinal: these are customer-facing, which makes
 * them the first entries here that could in principle arrive in a burst —
 * so it is worth being explicit about why that cannot happen. Each one is
 * written to RenewalReminder BEFORE it is sent, under a unique constraint
 * on (tenantId, cycleStartedAt, reminderType), so a tenant can receive at
 * most two critical renewal emails per 30-day cycle no matter how often
 * jobs/renewalReminderJob.js runs. The ceiling is structural, not a
 * convention someone has to remember. The early nudges (renewalDay27,
 * renewalDay29) are deliberately NOT here: they are informational, they
 * have later messages behind them, and letting them into the reserve would
 * be exactly the trial-notice-starves-a-password-reset failure this file
 * exists to prevent.
 */
const CRITICAL_TYPES = new Set([
  'passwordReset',
  'verification',
  'billingReconciliationMismatch',
  // A money-taken anomaly: a downgrade GRANTED while the paid plan was still
  // active. Same reasoning as a reconciliation mismatch — a human has to look.
  'billingPlanAnomaly',
  // lib/billingAlerts.js — money taken with nothing granted, a safety net that
  // should never fire, or money refunded while access stays. All need a human.
  'billingPaidAfterExpiry',
  'billingStaleOrdersExpired',
  'billingPartialRefund',
  'billingRefundOutsideSiffty',
  'billingRefundSnapshotMissing',
  'renewalExpiry',
  'renewalGraceFinal',
]);

/**
 * Admin security mail — login alerts, lockouts, and (from Gate 7) the alert
 * cron — has its OWN daily bucket, entirely outside the shared cap above.
 *
 * Why separate rather than just "deferrable":
 *   - a lockout alert is a security signal; a day of trial notices must not be
 *     able to starve it, which is what sharing the deferrable pool would allow;
 *   - it must also never touch the critical reserve a password reset needs,
 *     which is what classifying it as critical would allow.
 * So neither pool can drain the other. Worst case for the provider is
 * DEFAULT_DAILY_CAP + ADMIN_DAILY_CAP = 90, still under Resend's 100/day.
 */
const ADMIN_TYPES = new Set(['adminLoginAlert', 'adminLockoutAlert', 'adminOpsAlert']);
const ADMIN_DAILY_CAP = 10;
// Of those 10, the last 3 are for lockout alerts only — the same
// reserve idea as the customer pool. A day of routine sign-in alerts (or an
// attacker who knows the password generating them) stops at 7 and can never
// spend the sends a real attack warning needs.
const ADMIN_CRITICAL_TYPES = new Set(['adminLockoutAlert']);
const ADMIN_CRITICAL_RESERVE = 3;

function dailyCap() {
  const raw = parseInt(process.env.EMAIL_DAILY_CAP || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_CAP;
}

function criticalReserve() {
  const raw = parseInt(process.env.EMAIL_CRITICAL_RESERVE || '', 10);
  const reserve = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CRITICAL_RESERVE;
  // A reserve at or above the cap would block every deferrable send outright.
  return Math.min(reserve, Math.max(0, dailyCap() - 1));
}

// ---------------------------------------------------------------------------
// State
//
// Two stores with one set of rules (evaluate() below):
//
//   Redis   when REDIS_URL is configured — the cap is ONE cap across every
//           instance and survives a restart, which is what the provider's
//           100/day actually is. deliver() uses checkShared()/recordSendShared().
//   memory  this process only. The fallback when Redis is not configured or is
//           unreachable, and what the synchronous check()/recordSend() read —
//           kept for tests and callers that only need this instance's view.
//
// recordSendShared() also updates the memory counters, so this instance's
// stats() stay meaningful for the send log line either way.
// ---------------------------------------------------------------------------
let dayKey = null;
let sentToday = 0;
let adminSentToday = 0;
const perRecipient = new Map(); // `${type}:${recipient}` -> { count, resetAt }

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rollDayIfNeeded() {
  const key = today();
  if (dayKey !== key) {
    dayKey = key;
    sentToday = 0;
    adminSentToday = 0;
  }
}

// Bound the per-recipient map so a stream of unique addresses cannot grow it
// without limit.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of perRecipient) {
    if (now > entry.resetAt) perRecipient.delete(key);
  }
}, PER_RECIPIENT_WINDOW_MS);
if (typeof sweep.unref === 'function') sweep.unref();

/**
 * May this send proceed?
 *
 * Checks WITHOUT consuming — call recordSend() only once the send succeeds, so
 * a provider failure does not burn quota.
 *
 * @param {string} type       'passwordReset' | 'verification' | 'trialEnding' | 'tokenExpiry'
 * @param {string} recipient
 * @returns {{ok: true} | {ok: false, reason: string, detail: string}}
 */
function check(type, recipient) {
  rollDayIfNeeded();
  const entry = perRecipient.get(`${type}:${String(recipient).toLowerCase()}`);
  return evaluate(type, {
    sentToday,
    adminSentToday,
    recipientCount: entry && Date.now() <= entry.resetAt ? entry.count : 0,
  });
}

/**
 * The quota rules, applied to a set of counts from either store.
 * @param {string} type
 * @param {{sentToday: number, adminSentToday: number, recipientCount: number}} counts
 */
function evaluate(type, { sentToday, adminSentToday, recipientCount }) {
  // The admin bucket is checked on its own and never falls through to the
  // shared cap — see ADMIN_TYPES. No per-recipient throttle either: a burst of
  // lockouts is exactly the thing the owner needs to see, and the daily cap
  // already bounds it.
  if (ADMIN_TYPES.has(type)) {
    const limit = ADMIN_CRITICAL_TYPES.has(type) ? ADMIN_DAILY_CAP : ADMIN_DAILY_CAP - ADMIN_CRITICAL_RESERVE;
    if (adminSentToday >= limit) {
      return {
        ok: false,
        reason: 'admin_daily_cap',
        detail: `admin alert cap reached for ${type} (${adminSentToday}/${limit})`,
      };
    }
    return { ok: true };
  }

  const cap = dailyCap();
  const reserve = criticalReserve();
  const isCritical = CRITICAL_TYPES.has(type);
  const limitForThisSend = isCritical ? cap : cap - reserve;

  if (sentToday >= limitForThisSend) {
    return {
      ok: false,
      reason: 'daily_cap',
      detail: isCritical
        ? `daily cap reached (${sentToday}/${cap})`
        : `deferrable sends exhausted (${sentToday}/${limitForThisSend}); ${reserve} reserved for password resets and verification`,
    };
  }

  const max = perRecipientMax(type);
  if (recipientCount >= max) {
    return {
      ok: false,
      reason: 'per_recipient',
      detail: `${type}: ${max} per hour per recipient already sent`,
    };
  }

  return { ok: true };
}

/** Consume quota. Call ONLY after a send actually succeeded. */
function recordSend(type, recipient) {
  rollDayIfNeeded();
  if (ADMIN_TYPES.has(type)) {
    adminSentToday += 1;
    return;
  }
  sentToday += 1;

  const key = `${type}:${String(recipient).toLowerCase()}`;
  const now = Date.now();
  const entry = perRecipient.get(key);
  if (!entry || now > entry.resetAt) {
    perRecipient.set(key, { count: 1, resetAt: now + PER_RECIPIENT_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

/** For boot logging, admin surfaces and tests. */
function stats() {
  rollDayIfNeeded();
  const cap = dailyCap();
  const reserve = criticalReserve();
  return {
    day: dayKey,
    sentToday,
    cap,
    reserve,
    deferrableLimit: cap - reserve,
    remainingCritical: Math.max(0, cap - sentToday),
    remainingDeferrable: Math.max(0, cap - reserve - sentToday),
    adminSentToday,
    adminCap: ADMIN_DAILY_CAP,
  };
}

// ---------------------------------------------------------------------------
// Shared (Redis) store
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const { getRedis, isRedisReady } = require('../redis');
const { redisHit } = require('../rateLimit');

const DAY_KEY_TTL_S = 36 * 60 * 60; // a day's counter outlives the day by 12h, then goes
const rcptHash = (type, recipient) =>
  crypto.createHash('sha256').update(`${type}:${String(recipient).toLowerCase()}`).digest('hex').slice(0, 32);
const keys = {
  sent: (day) => `email:quota:${day}:sent`,
  admin: (day) => `email:quota:${day}:admin`,
  rcpt: (type, recipient) => `email:quota:rcpt:${rcptHash(type, recipient)}`,
};

function sharedClient() {
  const client = getRedis();
  return client && isRedisReady() ? client : null;
}

/**
 * check(), against the cross-instance counters when Redis is up; falls back to
 * this process's memory otherwise. Never rejects.
 */
async function checkShared(type, recipient) {
  const client = sharedClient();
  if (!client) return check(type, recipient);
  try {
    const [sent, admin, rcpt] = await client.mget(keys.sent(today()), keys.admin(today()), keys.rcpt(type, recipient));
    return evaluate(type, {
      sentToday: Number(sent) || 0,
      adminSentToday: Number(admin) || 0,
      recipientCount: Number(rcpt) || 0,
    });
  } catch (err) {
    console.warn('[email] quota: Redis unavailable, checking this instance only:', err.message);
    return check(type, recipient);
  }
}

/** recordSend(), on both stores. Never rejects. */
async function recordSendShared(type, recipient) {
  recordSend(type, recipient);
  const client = sharedClient();
  if (!client) return;
  try {
    const day = today();
    const dayKey = ADMIN_TYPES.has(type) ? keys.admin(day) : keys.sent(day);
    await client.multi().incr(dayKey).expire(dayKey, DAY_KEY_TTL_S).exec();
    // The recipient window starts at the first send, like the memory entry —
    // the same atomic INCR-then-PEXPIRE the rate limiter uses.
    if (!ADMIN_TYPES.has(type)) await redisHit(keys.rcpt(type, recipient), PER_RECIPIENT_WINDOW_MS);
  } catch (err) {
    console.warn('[email] quota: could not record the send in Redis:', err.message);
  }
}

/**
 * A send refused by the quota. Counted per day (all instances when Redis is
 * up) so the alert cron can page someone — a blocked CRITICAL send (password
 * reset, verification) is never allowed to stay silent in the logs.
 */
let blockedTodayLocal = { day: null, all: 0, critical: 0 };
async function recordBlocked(type) {
  const day = today();
  if (blockedTodayLocal.day !== day) blockedTodayLocal = { day, all: 0, critical: 0 };
  blockedTodayLocal.all += 1;
  const critical = CRITICAL_TYPES.has(type);
  if (critical) blockedTodayLocal.critical += 1;
  const client = sharedClient();
  if (!client) return;
  try {
    const multi = client.multi().incr(`email:quota:${day}:blocked`).expire(`email:quota:${day}:blocked`, DAY_KEY_TTL_S);
    if (critical) multi.incr(`email:quota:${day}:blocked_critical`).expire(`email:quota:${day}:blocked_critical`, DAY_KEY_TTL_S);
    await multi.exec();
  } catch {
    /* counted locally */
  }
}

/** Today's counters for alerting: shared across instances when Redis is up. */
async function sharedStats() {
  const cap = dailyCap();
  const day = today();
  const client = sharedClient();
  if (client) {
    try {
      const [sent, admin, blocked, blockedCritical] = await client.mget(
        keys.sent(day), keys.admin(day), `email:quota:${day}:blocked`, `email:quota:${day}:blocked_critical`
      );
      return { cap, reserve: criticalReserve(), sentToday: Number(sent) || 0, adminSentToday: Number(admin) || 0, blockedToday: Number(blocked) || 0, blockedCriticalToday: Number(blockedCritical) || 0, shared: true };
    } catch {
      /* fall through */
    }
  }
  rollDayIfNeeded();
  const b = blockedTodayLocal.day === day ? blockedTodayLocal : { all: 0, critical: 0 };
  return { cap, reserve: criticalReserve(), sentToday, adminSentToday, blockedToday: b.all, blockedCriticalToday: b.critical, shared: false };
}

/** Test seam. */
function _reset() {
  blockedTodayLocal = { day: null, all: 0, critical: 0 };
  dayKey = today();
  sentToday = 0;
  adminSentToday = 0;
  perRecipient.clear();
}

module.exports = {
  check,
  recordSend,
  checkShared,
  recordSendShared,
  recordBlocked,
  sharedStats,
  stats,
  _reset,
  CRITICAL_TYPES,
  ADMIN_TYPES,
  ADMIN_DAILY_CAP,
  ADMIN_CRITICAL_TYPES,
  ADMIN_CRITICAL_RESERVE,
  PER_RECIPIENT_MAX,
  PER_RECIPIENT_MAX_BY_TYPE,
  DEFAULT_DAILY_CAP,
  DEFAULT_CRITICAL_RESERVE,
};
