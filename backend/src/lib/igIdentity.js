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
 *   { ok: true, trialGranted: boolean, identity, subscription }
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
    const alreadyConsumed = Boolean(identity.trialConsumedAt);
    let subscription = await tx.subscription.findUnique({ where: { userId } });
    let trialGranted = false;

    if (!alreadyConsumed && emailVerified) {
      const now = new Date();
      subscription = await tx.subscription.upsert({
        where: { userId },
        create: {
          userId,
          status: 'TRIALING',
          trialStartedAt: now,
          trialEndsAt: trialEndDate(now),
        },
        update: {
          // Only lift a subscription that has never been anything. Someone
          // already TRIALING or TRIAL_EXPIRED must not be reset by connecting
          // a second Instagram account.
          ...(subscription && subscription.status !== 'NONE'
            ? {}
            : { status: 'TRIALING', trialStartedAt: now, trialEndsAt: trialEndDate(now) }),
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

    return { ok: true, trialGranted, identity, subscription };
  });
}

/**
 * Is this user entitled to AI processing right now?
 *
 * On expiry, auto-reply and classification stop. The inbox stays readable and
 * the account is NOT locked — a user who cannot log in cannot pay you later.
 */
async function hasActiveEntitlement(userId) {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { status: true, trialEndsAt: true },
  });

  if (!subscription) return false;
  if (subscription.status !== 'TRIALING') return false;
  if (subscription.trialEndsAt && subscription.trialEndsAt.getTime() <= Date.now()) {
    // Expired but the sweeper has not run yet. Treat as expired immediately
    // rather than granting a grace period the schedule happens to create.
    return false;
  }
  return true;
}

module.exports = {
  TRIAL_DAYS,
  LEDGER_RETENTION_MONTHS,
  hashIgUserId,
  claimInstagramIdentity,
  hasActiveEntitlement,
  trialEndDate,
  purgeAfterDate,
};
