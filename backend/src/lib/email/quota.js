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
  'renewalExpiry',
  'renewalGraceFinal',
]);

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
// In memory, matching lib/rateLimit.js and for the same stated reasons
// (single instance, pre-launch). KNOWN LIMITATION: a restart resets the daily
// counter, so a process that restarts mid-day can exceed the real provider
// limit. That is acceptable while this is one instance deployed rarely; it is
// NOT acceptable once deploys are frequent or there is more than one instance.
// Recorded in FINDINGS.md.
// ---------------------------------------------------------------------------
let dayKey = null;
let sentToday = 0;
const perRecipient = new Map(); // `${type}:${recipient}` -> { count, resetAt }

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rollDayIfNeeded() {
  const key = today();
  if (dayKey !== key) {
    dayKey = key;
    sentToday = 0;
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

  const key = `${type}:${String(recipient).toLowerCase()}`;
  const entry = perRecipient.get(key);
  if (entry && Date.now() <= entry.resetAt && entry.count >= PER_RECIPIENT_MAX) {
    return {
      ok: false,
      reason: 'per_recipient',
      detail: `${type}: ${PER_RECIPIENT_MAX} per hour per recipient already sent`,
    };
  }

  return { ok: true };
}

/** Consume quota. Call ONLY after a send actually succeeded. */
function recordSend(type, recipient) {
  rollDayIfNeeded();
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
  };
}

/** Test seam. */
function _reset() {
  dayKey = today();
  sentToday = 0;
  perRecipient.clear();
}

module.exports = {
  check,
  recordSend,
  stats,
  _reset,
  CRITICAL_TYPES,
  PER_RECIPIENT_MAX,
  DEFAULT_DAILY_CAP,
  DEFAULT_CRITICAL_RESERVE,
};
