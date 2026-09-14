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
 * Auto-reply credits granted at trial start. The trial is classification-only
 * by current spec (0) — a single constant so that changes later (a small
 * taste of auto-reply during the trial) is one number, not a hunt through
 * the grant transaction. Also seeds billing_plans.auto_reply_credits_per_cycle
 * for the TRIAL row (see the plan-catalogue seed migration) — kept in code,
 * not just in that seed data, since this is the value the grant transaction
 * itself writes, independent of whatever the Plan row currently says.
 */
const TRIAL_AUTO_REPLY_CREDITS = 0;

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
 * Returns one of:
 *   { ok: false, reason: 'blocked' }
 *   { ok: false, reason: 'connected_elsewhere', ownerUserId, conversationCount }
 *   { ok: true, trialGranted: boolean, identity, entitlement }
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
      return { ok: false, reason: 'blocked' };
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
    let entitlement = await tx.entitlement.findUnique({ where: { userId } });
    let trialGranted = false;

    if (!alreadyConsumed && emailVerified) {
      const now = new Date();
      entitlement = await tx.entitlement.upsert({
        where: { userId },
        create: {
          userId,
          planCode: 'TRIAL',
          status: 'TRIALING',
          cycleStartedAt: now,
          validUntil: trialEndDate(now),
          replyCreditsCurrent: TRIAL_AUTO_REPLY_CREDITS,
        },
        update: {
          // Only lift an entitlement that has never been anything. Someone
          // already TRIALING/ACTIVE/GRACE/EXPIRED must not be reset by
          // connecting a second Instagram account.
          ...(entitlement && entitlement.status !== 'NONE'
            ? {}
            : {
                planCode: 'TRIAL',
                status: 'TRIALING',
                cycleStartedAt: now,
                validUntil: trialEndDate(now),
                replyCreditsCurrent: TRIAL_AUTO_REPLY_CREDITS,
              }),
        },
      });

      // The stamp and the grant are in the same transaction. This is the
      // invariant the whole ledger rests on.
      identity = await tx.instagramIdentity.update({
        where: { igUserIdHash },
        data: { trialConsumedAt: now },
      });
      trialGranted = true;
    }

    // --- 5. Link count ----------------------------------------------------
    identity = await tx.instagramIdentity.update({
      where: { igUserIdHash },
      data: { linkCount: { increment: 1 }, purgeAfter: purgeAfterDate() },
    });

    return { ok: true, trialGranted, identity, entitlement };
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
  TRIAL_AUTO_REPLY_CREDITS,
  LEDGER_RETENTION_MONTHS,
  hashIgUserId,
  claimInstagramIdentity,
  hasActiveEntitlement,
  trialEndDate,
  purgeAfterDate,
};
