/**
 * The Instagram identity ledger and the trial grant.
 *
 * WHAT THIS DEFENDS AGAINST. Without a ledger, "delete your account and sign
 * up again" is an unlimited free trial. The obvious fix — recording which
 * Instagram accounts have had a trial — cannot live on the User row, because
 * deleting the user would delete the evidence. So InstagramIdentity has NO
 * relation to User and survives account deletion by design.
 *
 * PSEUDONYMISED. The raw Instagram id is never stored. igUserIdHash is
 * HMAC-SHA256(igUserId, IG_IDENTITY_PEPPER), so the table cannot be used to
 * enumerate which Instagram accounts have ever used Codeback, and a database
 * leak does not reveal the customer list.
 *
 * THE PEPPER CAN NEVER BE ROTATED. Every hash is derived from it; change it
 * and every row becomes unmatchable, which silently hands every past trial
 * user a fresh trial. That is the failure mode that makes the whole ledger
 * pointless, so getPepper() refuses to fall back to anything.
 *
 * ATOMICITY. The grant, the ledger stamp and the link count are ONE
 * transaction. A trial granted without a matching trialConsumedAt stamp is
 * precisely the bug this exists to prevent, so they cannot be allowed to come
 * apart under a crash or a concurrent connect.
 */

const crypto = require('crypto');
const prisma = require('./prisma');

const TRIAL_DAYS = 3;

/**
 * Why a connect did or did not start a trial — machine-readable, returned on
 * EVERY branch of claimInstagramIdentity().
 *
 * These exist because the reason used to be thrown away. A connect that
 * granted nothing returned only `trialGranted: false`, the callback discarded
 * even that, and the page showed "No plan yet": a spent trial, an unconfirmed
 * email and a genuine bug all looked the same.
 *
 * TRIAL_NOT_STARTED is never returned by a claim. It is what the billing
 * summary reports for a tenant who has not connected an account that could
 * claim one yet, so the pages have one vocabulary for "why no trial".
 */
const TRIAL_OUTCOMES = Object.freeze({
  TRIAL_GRANTED: 'TRIAL_GRANTED',
  TRIAL_ALREADY_CONSUMED: 'TRIAL_ALREADY_CONSUMED',
  EMAIL_UNVERIFIED: 'EMAIL_UNVERIFIED',
  ACCOUNT_ALREADY_LINKED: 'ACCOUNT_ALREADY_LINKED',
  ACCOUNT_BLOCKED: 'ACCOUNT_BLOCKED',
  /**
   * The user already has (or had) a trial or plan. Connecting another account
   * never starts or resets one — and does NOT stamp that account's
   * trialConsumedAt, since it received nothing.
   */
  ALREADY_ENTITLED: 'ALREADY_ENTITLED',
  TRIAL_NOT_STARTED: 'TRIAL_NOT_STARTED',
});

/**
 * Auto-reply credits granted at trial start.
 *
 * A deliberate taste of the paid feature, not a full allowance. This was 0 —
 * classification-only — which made the trial demonstrate the half of the
 * product nobody is buying: it sorted the inbox and then refused to answer
 * anything. 25 is enough to watch real replies go out on real conversations
 * and still run out well before it substitutes for a plan.
 *
 * Abuse is bounded elsewhere, not by this number: trialConsumedAt is recorded
 * per Instagram IDENTITY, so a second account or a fresh email does not earn a
 * second trial. That is what makes raising this safe.
 *
 * Also seeds billing_plans.auto_reply_credits_per_cycle and _bank_cap for the
 * TRIAL row — kept in code, not just in the seed data, since this is the value
 * the grant transaction itself writes regardless of what the Plan row says.
 * The two are kept in step by migration 20260914154500_trial_auto_reply_credits;
 * change one and you must change the other.
 */
const TRIAL_AUTO_REPLY_CREDITS = 25;

/** How long a pseudonymised ledger row is retained. See PRIVACY_NOTES.md. */
const LEDGER_RETENTION_MONTHS = 24;

function getPepper() {
  const pepper = (process.env.IG_IDENTITY_PEPPER || '').trim();
  if (!pepper) {
    throw new Error(
      'IG_IDENTITY_PEPPER is not set. The trial-abuse ledger cannot be read or written ' +
        'without it, and using a fallback would silently grant every past trial user a new trial.'
    );
  }
  return pepper;
}

/** HMAC-SHA256 of the Instagram user id under the pepper. */
function hashIgUserId(igUserId) {
  return crypto.createHmac('sha256', getPepper()).update(String(igUserId)).digest('hex');
}

/**
 * The ONLY entitlement columns the Instagram connect path reads or returns.
 *
 * Pinned to an explicit list rather than a full-row read for a reason worth
 * not relearning: Prisma Client SELECTs every column a model declares, so a
 * bare `findUnique`/`upsert` here silently takes a dependency on every
 * column that will EVER be added to Entitlement. When the Gate 3.1 migration
 * added `region_source` and a database had the new client but not yet the
 * new column, this transaction threw and **Instagram connect broke for
 * every user** — with billing switched off, because the trial grant is not
 * behind BILLING_ENABLED and must not be. /health stayed green throughout.
 *
 * Naming the fields means connect only breaks if one of THESE changes, which
 * is a change someone is already thinking about. hasActiveEntitlement() has
 * always done this, which is exactly why it kept working while this did not.
 *
 * lib/migrationGuard.js stops a behind-schema deploy from booting at all;
 * this is the second layer, so the most important flow in the product does
 * not rest on that guard alone.
 */
const ENTITLEMENT_CONNECT_FIELDS = {
  id: true,
  userId: true,
  planCode: true,
  status: true,
  validUntil: true,
  cycleStartedAt: true,
  replyCreditsCurrent: true,
};

function trialEndDate(from = new Date()) {
  return new Date(from.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

function purgeAfterDate(from = new Date()) {
  const d = new Date(from);
  d.setMonth(d.getMonth() + LEDGER_RETENTION_MONTHS);
  return d;
}

/**
 * Decide whether `userId` may link `igUserId`, and grant a trial if they are
 * entitled to one. Everything happens in a single transaction.
 *
 * Returns one of (every shape carries `trialOutcome`, a TRIAL_OUTCOMES value):
 *   { ok: false, reason: 'blocked', trialOutcome: ACCOUNT_BLOCKED }
 *   { ok: false, reason: 'connected_elsewhere', trialOutcome: ACCOUNT_ALREADY_LINKED, ownerUserId, conversationCount }
 *   { ok: true, trialGranted: boolean, trialOutcome, identity, entitlement }
 *
 * `trialGranted` is true ONLY when a trial was actually started by this call.
 *
 * @param {object} args
 * @param {string} args.userId          the Codeback user connecting the account
 * @param {string} args.igUserId        the raw Instagram user id (hashed here, never stored)
 * @param {boolean} args.emailVerified  a trial requires a confirmed address
 */
async function claimInstagramIdentity({ userId, igUserId, emailVerified }) {
  const igUserIdHash = hashIgUserId(igUserId);

  return prisma.$transaction(async (tx) => {
    // --- 1. Find or create the ledger row -------------------------------
    // Upsert rather than find-then-create: two concurrent connects of the same
    // account would both see "not found" and both insert.
    let identity = await tx.instagramIdentity.upsert({
      where: { igUserIdHash },
      create: { igUserIdHash, purgeAfter: purgeAfterDate() },
      update: {},
    });

    // --- 2. Hard block ---------------------------------------------------
    if (identity.blockedAt) {
      return { ok: false, reason: 'blocked', trialOutcome: TRIAL_OUTCOMES.ACCOUNT_BLOCKED };
    }

    // --- 3. Is it actively linked to someone else? -----------------------
    // At most one CONNECTED row can exist per Instagram account
    // (ig_one_active_link), so this is a single lookup rather than a scan.
    const activeLink = await tx.instagramAccount.findFirst({
      where: { igUserId: String(igUserId), connectionStatus: 'CONNECTED' },
      select: { id: true, userId: true },
    });

    if (activeLink && activeLink.userId !== userId) {
      const conversationCount = await tx.conversation.count({
        where: { instagramAccountId: activeLink.id },
      });
      return {
        ok: false,
        reason: 'connected_elsewhere',
        trialOutcome: TRIAL_OUTCOMES.ACCOUNT_ALREADY_LINKED,
        ownerUserId: activeLink.userId,
        activeAccountId: activeLink.id,
        conversationCount,
      };
    }

    // --- 4. Trial entitlement --------------------------------------------
    // Reconnecting the SAME account must be idempotent: no error, and no
    // second trial. trialConsumedAt is what makes that true, and it is
    // stamped exactly once, ever.
    //
    // Grants into Entitlement directly (planCode 'TRIAL', cycleStartedAt +
    // validUntil) rather than through entitlementService.grantPlan — that
    // function's renewal math (rolling a bank, extending from a prior
    // validUntil) does not apply to a first-ever trial grant, and a trial
    // is not a Plan a tenant "purchases". See schema.prisma's Entitlement
    // comment for the full Subscription -> Entitlement field mapping.
    const alreadyConsumed = Boolean(identity.trialConsumedAt);
    let entitlement = await tx.entitlement.findUnique({
      where: { userId },
      select: ENTITLEMENT_CONNECT_FIELDS,
    });
    let trialGranted = false;
    // Captured BEFORE the grant block: a user who already has (or had) a trial
    // or plan is never re-granted by connecting another account.
    const hadEntitlement = Boolean(entitlement && entitlement.status !== 'NONE');

    // STAMP ONLY WHAT WAS GRANTED. trialConsumedAt is a permanent record that
    // this Instagram account has had its one free trial. Stamping an identity
    // that received nothing — because the connecting user already had a trial
    // or plan — was a false record: it silently and permanently denied that
    // account a legitimate trial later, on any Siffty account. So the grant
    // and the stamp happen together or not at all, and a user who already
    // has an entitlement gets neither.
    if (!alreadyConsumed && emailVerified && !hadEntitlement) {
      const now = new Date();
      const trialFields = {
        planCode: 'TRIAL',
        status: 'TRIALING',
        cycleStartedAt: now,
        validUntil: trialEndDate(now),
        replyCreditsCurrent: TRIAL_AUTO_REPLY_CREDITS,
      };
      entitlement = await tx.entitlement.upsert({
        where: { userId },
        select: ENTITLEMENT_CONNECT_FIELDS,
        create: { userId, ...trialFields },
        // Reached only with no row or a NONE row (hadEntitlement is false), so
        // lifting it cannot reset a real trial or plan.
        update: trialFields,
      });

      // The stamp and the grant are in the same transaction. This is the
      // invariant the whole ledger rests on.
      identity = await tx.instagramIdentity.update({
        where: { igUserIdHash },
        data: { trialConsumedAt: now },
      });
      trialGranted = true;
    }

    // Every branch has a reason, and the reason is RETURNED. Order matters: a
    // spent trial outranks an unverified email, because confirming the address
    // would not change the answer.
    const trialOutcome = hadEntitlement
      ? TRIAL_OUTCOMES.ALREADY_ENTITLED
      : trialGranted
        ? TRIAL_OUTCOMES.TRIAL_GRANTED
        : alreadyConsumed
          ? TRIAL_OUTCOMES.TRIAL_ALREADY_CONSUMED
          : TRIAL_OUTCOMES.EMAIL_UNVERIFIED;

    // --- 5. Link count ----------------------------------------------------
    identity = await tx.instagramIdentity.update({
      where: { igUserIdHash },
      data: { linkCount: { increment: 1 }, purgeAfter: purgeAfterDate() },
    });

    return { ok: true, trialGranted, trialOutcome, identity, entitlement };
  });
}

/**
 * Is this user entitled to AI processing right now?
 *
 * TRIAL-ONLY CHECK, kept for the existing (currently commented-out, see
 * FINDINGS.md / Gate 0) call site in messageAnalysisJob.js and for the
 * tests that predate billing. It deliberately does NOT recognize ACTIVE/
 * GRACE — a paying tenant would read as "not entitled" here. Gate 4 swaps
 * that call site over to entitlementService.canClassify(), which handles
 * every status; this function should be considered superseded by it and
 * not extended further.
 *
 * On expiry, auto-reply and classification stop. The inbox stays readable and
 * the account is NOT locked — a user who cannot log in cannot pay you later.
 */
async function hasActiveEntitlement(userId) {
  const entitlement = await prisma.entitlement.findUnique({
    where: { userId },
    select: { status: true, validUntil: true },
  });

  if (!entitlement) return false;
  if (entitlement.status !== 'TRIALING') return false;
  if (entitlement.validUntil && entitlement.validUntil.getTime() <= Date.now()) {
    // Expired but the sweeper has not run yet. Treat as expired immediately
    // rather than granting a grace period the schedule happens to create.
    return false;
  }
  return true;
}

module.exports = {
  TRIAL_DAYS,
  TRIAL_OUTCOMES,
  TRIAL_AUTO_REPLY_CREDITS,
  LEDGER_RETENTION_MONTHS,
  hashIgUserId,
  claimInstagramIdentity,
  hasActiveEntitlement,
  trialEndDate,
  purgeAfterDate,
};
