/**
 * The paid renewal sequence — day 27, day 29, expiry day, grace day 2.
 *
 * Registered in jobs/index.js by Wave 0 (every 6 hours, ~4 passes a day)
 * precisely so this gate never has to edit that shared file. Nothing outside
 * this file and lib/email/** was touched to build it.
 *
 * WHY THIS EXISTS AT ALL. There is no autopay on this product: every renewal
 * is a decision someone has to make, on a date they will not remember. If
 * nothing reminds them, the plan lapses by inattention rather than by choice,
 * and the first they hear of it is a customer complaining that auto-replies
 * stopped. Four messages, ending one day before the grace window closes.
 *
 * ---------------------------------------------------------------------
 * THE WINDOWS, and why they are ranges rather than dates
 * ---------------------------------------------------------------------
 * Each stage is a range of "time left until validUntil", and the four ranges
 * PARTITION the span from three days before expiry to the end of grace, with
 * no gaps and no overlap:
 *
 *   DAY_27       3 days out .. 1 day out      DEFERRABLE
 *   DAY_29       1 day out  .. expiry         DEFERRABLE
 *   EXPIRY       expiry     .. grace day 2    CRITICAL
 *   GRACE_FINAL  grace day 2 .. grace ends    CRITICAL
 *
 * Ranges, not "is it exactly day 27 today", for two reasons. A job that fires
 * four times a day can only ever see four instants, so an exact-date test
 * drops anyone whose expiry falls between two passes. And a deploy, an
 * outage, or a slow night must not silently delete a message from the
 * sequence — a range means a late pass still catches the tenant, just later.
 * That latitude is exactly what "the early nudges may slip a day" buys, and
 * the idempotency table below is what makes a wide window safe.
 *
 * Because the ranges are disjoint, a tenant matches at most ONE stage per
 * pass, so no tenant can ever receive two renewal emails from a single run.
 *
 * "Grace day 2" is read the same way as "day 27": N days elapsed since the
 * stage's own start. Day 27 of a 30-day cycle is three days before expiry, so
 * grace day 2 is two days after it — which, with a three-day grace period,
 * leaves the customer one full day to act. It is the LAST message: a notice
 * timed to arrive as the window shuts cannot be acted on, so there is no
 * day-3 stage.
 *
 * ---------------------------------------------------------------------
 * WHY THE STORED status COLUMN IS NOT IN THE QUERY
 * ---------------------------------------------------------------------
 * entitlementService's central rule is that validUntil/graceUntil are the
 * source of truth and `status` is a lazily-written cache (see its
 * "EFFECTIVE STATUS IS LAZY" note). Filtering on status here would make this
 * job's behaviour depend on whether some other sweep had run yet: a tenant
 * whose row was already flipped to EXPIRED at validUntil would be excluded
 * from the EXPIRY and GRACE_FINAL notices — the two that matter most, to the
 * customers most likely to be about to leave. The time windows are the gate;
 * status is only used to skip rows that were never granted anything (NONE).
 *
 * TRIAL tenants are excluded outright. A trial is 3 days, so "day 27" is
 * meaningless for one, and jobs/trialJob.js already warns them with the
 * trialEnding template. A trial also has no graceUntil at all.
 */

const prisma = require('../lib/prisma');
// Bound as `mailer`, never `email` — see routes/auth.js. A local `email`
// variable shadowing this module silently broke registration once already.
const mailer = require('../lib/email');
// Read-only import: the grace window's length belongs to the entitlement
// service, and hardcoding a second copy of "3 days" here would silently
// desynchronise the day this job keeps emailing tenants whose grace has
// already ended.
const { GRACE_PERIOD_MS } = require('../services/entitlementService');

const DAY_MS = 24 * 60 * 60 * 1000;

const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * The sequence, as bounds on `msUntilExpiry` (validUntil - now; negative once
 * the plan has expired). A stage matches when `min < msUntilExpiry <= max`.
 *
 * Half-open on the same side throughout is what makes the set a partition:
 * every instant in [-GRACE_PERIOD_MS, +3 days) belongs to exactly one stage.
 * The boundary instant itself (msUntilExpiry === 0, i.e. validUntil to the
 * millisecond) belongs to EXPIRY rather than DAY_29, which is the correct
 * reading — at that moment the plan has run out.
 */
const STAGES = [
  // `optional`: the two early nudges are the only part of the sequence a
  // customer can switch off (User.renewalNudgeEmails). EXPIRY and GRACE_FINAL
  // are not reminders — they say service has stopped and credits are about to
  // be cleared — so they send regardless, and the settings page says so.
  { reminderType: 'DAY_27', min: 1 * DAY_MS, max: 3 * DAY_MS, optional: true },
  { reminderType: 'DAY_29', min: 0, max: 1 * DAY_MS, optional: true },
  { reminderType: 'EXPIRY', min: -2 * DAY_MS, max: 0 },
  // Ends at the real end of grace, not at a hardcoded -3 days: past
  // graceUntil the tenant is a cold start (grantPlan forfeits the credit
  // bank), so the "your replies carry over" promise would no longer be true.
  { reminderType: 'GRACE_FINAL', min: -GRACE_PERIOD_MS, max: -2 * DAY_MS },
];

/** Which stage, if any, a tenant is in right now. */
function stageFor(msUntilExpiry) {
  return STAGES.find((s) => msUntilExpiry > s.min && msUntilExpiry <= s.max) || null;
}

/**
 * ONE button, to a prefilled checkout URL.
 *
 * Cross-gate contract with Gate 5, which reads ?renew= on the billing page and
 * opens checkout for that plan directly. The alternative — linking to the
 * dashboard and asking someone to find the billing page — is a
 * login-then-navigate flow, and every extra screen between an email and a
 * payment loses people who meant to pay.
 *
 * `src=email_<reminderType>` is what makes the four stages separable in
 * attribution: without it there is no way to learn whether the day-27 nudge or
 * the grace notice is doing the work.
 */
function checkoutUrlFor(planCode, reminderType) {
  return `${frontendUrl()}/billing?renew=${planCode}&src=email_${reminderType}`;
}

/**
 * Run one pass of the sequence.
 *
 * @returns {Promise<number>} emails actually sent (a send that failed or was
 *   blocked by quota is not counted — the caller logs a number that means
 *   "reached a mailbox", not "was attempted")
 */
async function sendRenewalReminders() {
  const now = new Date();

  // One query for all four stages. The bounds are the union of the stage
  // ranges, so the database returns only rows that are in SOME window; which
  // one is decided in memory, where the boundaries are easier to read than as
  // four OR'd date pairs.
  const candidates = await prisma.entitlement.findMany({
    where: {
      // A row with no plan code has nothing to renew and nothing to put in
      // ?renew=, so it is excluded explicitly. SQL's three-valued logic
      // already drops it — `plan_code <> 'TRIAL'` evaluates to NULL, not
      // true, for a NULL plan_code (verified against Prisma 6.19 on Postgres
      // in tests/renewal-reminders.test.js) — but "no plan means no renewal
      // notice" is a rule of this sequence, not a side effect of NULL
      // comparison semantics, so it is written down.
      AND: [{ planCode: { not: 'TRIAL' } }, { planCode: { not: null } }],
      status: { not: 'NONE' }, // never granted anything; nothing to renew
      validUntil: {
        gt: new Date(now.getTime() - GRACE_PERIOD_MS),
        lte: new Date(now.getTime() + 3 * DAY_MS),
      },
    },
    select: {
      userId: true,
      planCode: true,
      validUntil: true,
      // GRACE_FINAL names the exact instant the credit bank is cleared, and
      // that instant IS graceUntil. Omitting it from this select does not
      // fail loudly — the template just quietly falls back to wording with
      // no deadline in it, which is the one thing that message must not do.
      graceUntil: true,
      cycleStartedAt: true,
      replyCreditsCurrent: true,
      replyCreditsBanked: true,
      user: { select: { email: true, renewalNudgeEmails: true } },
    },
  });

  let sent = 0;

  for (const entitlement of candidates) {
    const stage = stageFor(entitlement.validUntil.getTime() - now.getTime());
    if (!stage) continue; // only reachable if the query bounds and STAGES drift apart

    const to = entitlement.user?.email;
    if (!to) continue;

    // Opted out of the nudges. Checked BEFORE the idempotency insert, so no
    // row is written: switching reminders back on inside the same window still
    // delivers that stage rather than finding it already "sent".
    if (stage.optional && entitlement.user.renewalNudgeEmails === false) continue;

    // INSERT FIRST, SEND SECOND — the same shape as
    // entitlementService.recordClassification, and for the same reason.
    //
    // This job re-evaluates the same windows on every pass, roughly four times
    // a day, and a window is a day or more wide: without a durable guard a
    // tenant three days out would be emailed on every single run. The unique
    // constraint on (tenantId, cycleStartedAt, reminderType) is that guard,
    // and a P2002 is the normal, expected outcome for most rows here — it
    // means "already sent this cycle", not an error.
    //
    // The order matters more than it looks. Insert-then-send means a crash
    // between the two loses ONE notice; send-then-insert means the same crash
    // emails a paying customer twice. The three remaining stages are
    // independent rows, so a lost notice never breaks the rest of the
    // sequence — there is no recovery path for having double-mailed someone.
    try {
      await prisma.renewalReminder.create({
        data: {
          tenantId: entitlement.userId,
          cycleStartedAt: entitlement.cycleStartedAt,
          reminderType: stage.reminderType,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') continue; // already sent for this cycle
      throw err;
    }

    // cycleStartedAt is part of the key, and grantPlan()/rollCycle() restamp
    // it. A renewed tenant is therefore eligible for a fresh set of reminders
    // automatically, with no cleanup step and no rows to expire.
    try {
      await mailer.sendRenewalReminder(to, {
        reminderType: stage.reminderType,
        unusedCredits: entitlement.replyCreditsCurrent + entitlement.replyCreditsBanked,
        checkoutUrl: checkoutUrlFor(entitlement.planCode, stage.reminderType),
        // The exact instant the credit bank is cleared. GRACE_FINAL names it
        // outright — see the template's note on why "today" is not enough
        // when something is about to be lost for good.
        forfeitAt: entitlement.graceUntil,
      });
      sent += 1;
    } catch (err) {
      // A failed send is logged, never rethrown: one tenant's bad address or a
      // quota block must not abandon the rest of the sweep, and the rows that
      // did go out have already been recorded.
      console.error(
        `[Jobs] Renewal reminder (${stage.reminderType}) failed for tenant ${entitlement.userId}: ${err.message}`
      );
    }
  }

  if (sent > 0) console.log(`[Jobs] Sent ${sent} renewal reminder(s).`);
  return sent;
}

module.exports = { sendRenewalReminders, STAGES, checkoutUrlFor };
