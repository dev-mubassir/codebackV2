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
 * IDEMPOTENCY, required: a re-run must not re-send. Key on
 * (entitlement, cycle, reminder type). Note that no table for this exists
 * yet — schema.prisma is a shared file Gate 7 may NOT edit, so either
 * derive idempotency from existing columns or FLAG IT and queue the schema
 * change for Wave 2. Do not edit the schema in a Wave 1 worktree.
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
