/**
 * Renewal reminder sequence. STUB — Gate 7 implements the body.
 *
 * Registered in jobs/index.js by Wave 0 precisely so that Gate 7 never has
 * to edit that shared file. Gate 7 owns THIS file and
 * lib/email/templates.js; it should not need to touch anything else.
 *
 * ---------------------------------------------------------------------
 * CONTRACT Gate 7 implements
 * ---------------------------------------------------------------------
 * sendRenewalReminders() runs on a schedule and returns the number of
 * emails actually sent. It must be safe to run repeatedly.
 *
 * Sequence, for PAID 30-day cycles only, keyed off Entitlement.validUntil:
 *   day 27 (3 days out)  DEFERRABLE
 *   day 29 (1 day out)   DEFERRABLE
 *   expiry day           CRITICAL
 *   grace day 2          CRITICAL
 * The early nudges may slip a day; the last two are the customer's final
 * chance to keep service running, so they must not be starved by the
 * deferrable reserve (see lib/email/quota.js CRITICAL_TYPES).
 *
 * TRIAL entitlements are NOT in this sequence. A trial is 3 days, so
 * "day 27" is meaningless; the existing trialEnding template and
 * jobs/trialJob.js already cover it. Filter on planCode !== 'TRIAL'.
 *
 * Each email is ONE button to a prefilled checkout URL — never a
 * login-then-navigate flow.
 *
 * Subject line carries the real number of unused reply credits
 * (replyCreditsCurrent + replyCreditsBanked), e.g. "Your plan expires in 3
 * days — you have 340 unused replies waiting." With no autopay doing the
 * work, unused credits are the strongest renewal lever available.
 *
 * IDEMPOTENCY, required: a re-run must not re-send. This job runs several
 * times a day and re-evaluates the same windows every pass, so without a
 * guard a tenant three days out would be emailed on every run.
 *
 * Wave 0 has provided the table: prisma.renewalReminder, unique on
 * (tenantId, cycleStartedAt, reminderType). Use it the way
 * recordClassification uses CreditLedger — INSERT FIRST, and treat a P2002
 * as "already sent, skip" rather than an error:
 *
 *   try {
 *     await prisma.renewalReminder.create({ data: { tenantId, cycleStartedAt, reminderType } });
 *   } catch (err) {
 *     if (err.code === 'P2002') continue;   // already sent this cycle
 *     throw err;
 *   }
 *   await mailer.sendX(...)
 *
 * Inserting before sending means a crash between the two sends nothing
 * twice; the opposite order can double-send. cycleStartedAt is restamped by
 * grantPlan() and rollCycle(), so a renewed tenant becomes eligible for a
 * fresh set of reminders automatically, with no cleanup step.
 *
 * reminderType values: 'DAY_27' | 'DAY_29' | 'EXPIRY' | 'GRACE_DAY_2'.
 *
 * CHECKOUT LINK — cross-gate contract with Gate 5, use exactly this shape:
 *   `${FRONTEND_URL}/billing?renew=<PLAN_CODE>&src=email_<reminderType>`
 * The email cannot POST to the checkout endpoint, so it links to the
 * billing page, which reads ?renew= and opens checkout for that plan
 * directly. Gate 5 implements the receiving half. Anything else here is a
 * login-then-navigate flow, which is what the brief rules out.
 *
 * All sends go through lib/email (the sole email egress point — never
 * import `resend` here), from noreply@mail.siffty.com.
 * ---------------------------------------------------------------------
 */

/**
 * @returns {Promise<number>} emails sent
 */
async function sendRenewalReminders() {
  // Gate 7 implements. Returning 0 keeps the scheduler registration in
  // jobs/index.js honest until then.
  return 0;
}

module.exports = { sendRenewalReminders };
