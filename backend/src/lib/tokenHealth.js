/**
 * Reacting to a dead Instagram token.
 *
 * WHAT WAS BROKEN. tokenExpiresAt was persisted correctly and the short->long
 * exchange was performed, but NOTHING ever acted on either. No job compared
 * the expiry to now; nothing marked a token bad when Meta rejected it. So at
 * day 60 tokens died silently, tokenStatus stayed 'VALID', the dashboard
 * showed no problem, and the first symptom was DMs failing to send. Meanwhile
 * every send kept retrying against a token that would never work again,
 * burning quota indefinitely.
 *
 * `EXPIRED` was documented in the schema but written by no code path at all.
 */

const prisma = require('./prisma');
const instagram = require('./instagram');
const email = require('./email');

const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * Mark an account as needing reconnection and tell its owner — once.
 *
 * The status write is conditional on the account not ALREADY being flagged, so
 * a burst of failures against the same dead token produces exactly one email
 * rather than one per message.
 */
async function markNeedsReconnect(accountId, { reason = 'token_invalid' } = {}) {
  const updated = await prisma.instagramAccount.updateMany({
    where: { id: accountId, tokenStatus: { not: 'NEEDS_RECONNECT' } },
    data: { tokenStatus: 'NEEDS_RECONNECT' },
  });

  // Someone else already flagged it; they sent the email.
  if (updated.count === 0) return false;

  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    select: { igUsername: true, user: { select: { email: true } } },
  });

  console.warn(`[TokenHealth] Account ${accountId} flagged NEEDS_RECONNECT (${reason}).`);

  if (account?.user?.email) {
    try {
      await email.sendTokenExpiry(account.user.email, {
        igUsername: account.igUsername,
        reconnectUrl: `${frontendUrl()}/dashboard`,
      });
    } catch (err) {
      console.error('[TokenHealth] Reconnect email failed:', err.message);
    }
  }

  return true;
}

/**
 * Inspect an error from a Meta call and, if it means "this token is dead",
 * flag the account and stop.
 *
 * Returns true when the token was the problem — the caller should then abandon
 * the operation rather than retry it. This is what turns an infinite retry
 * loop into a single failure plus an email.
 */
async function handleMetaError(error, accountId) {
  if (!instagram.isTokenInvalidError(error)) return false;
  await markNeedsReconnect(accountId, { reason: 'meta_oauth_exception' });
  return true;
}

/**
 * Sweep accounts whose stored expiry has simply passed.
 *
 * Catches the case where nothing has tried to USE the token recently, so no
 * Meta error has surfaced to trigger handleMetaError.
 */
async function flagExpiredTokens() {
  const due = await prisma.instagramAccount.findMany({
    where: {
      connectionStatus: 'CONNECTED',
      tokenStatus: 'VALID',
      tokenExpiresAt: { lt: new Date() },
    },
    select: { id: true },
  });

  let flagged = 0;
  for (const account of due) {
    if (await markNeedsReconnect(account.id, { reason: 'expired' })) flagged += 1;
  }

  if (flagged > 0) console.log(`[TokenHealth] Flagged ${flagged} expired token(s).`);
  return flagged;
}

module.exports = { markNeedsReconnect, handleMetaError, flagExpiredTokens };
