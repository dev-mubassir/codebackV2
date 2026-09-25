/**
 * Instagram long-lived token auto-refresh (Gate 3B).
 *
 * Meta (verified against developers.facebook.com, Instagram Platform
 * "refresh_access_token", 2026-09-25):
 *   GET https://graph.instagram.com/refresh_access_token
 *       ?grant_type=ig_refresh_token&access_token=<long-lived token>
 *   - the token must be long-lived, AT LEAST 24 HOURS OLD, and NOT EXPIRED;
 *   - needs instagram_business_basic;
 *   - the refreshed token is valid for 60 days; response
 *     { access_token, token_type: 'bearer', expires_in }.
 *
 * Which accounts: CONNECTED, tokenStatus VALID, tokenExpiresAt in the future
 * and within 10 days. Token AGE is not stored; a 60-day token within 10 days
 * of expiry is at least 50 days old, and the query additionally requires
 * tokenExpiresAt <= now + 59 days, i.e. at least a day old, so the 24-hour
 * rule holds by construction. An expired token is never sent (Meta refuses
 * it; flagExpiredTokens marks it for reconnect instead).
 *
 * Failure handling:
 *   - Meta says the token itself is dead (code 190 etc.): the account is
 *     marked NEEDS_RECONNECT via tokenHealth.markNeedsReconnect (which also
 *     emails the customer once).
 *   - anything else (network, 5xx, rate limit): the token stays VALID and is
 *     retried on the next daily run — there are up to 10 runs in the window.
 *   - either way tokenRefreshFailedAt + a SAFE error code are recorded for
 *     the admin health page, and the run's failures go to the admins in one
 *     digest email through the admin email bucket.
 *
 * NEVER LOGS A TOKEN. Errors are reduced to a code (META_<code>, HTTP_<n>,
 * NETWORK, BAD_RESPONSE); the axios error object — whose config carries the
 * token as a query parameter — is never logged or stored.
 */

const prisma = require('./prisma');
const instagram = require('./instagram');
const { readAccountToken, writeAccountToken } = require('./crypto');
const { markNeedsReconnect } = require('./tokenHealth');

const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_WINDOW_DAYS = 10;
const MIN_TOKEN_AGE_DAYS = 1;
const TOKEN_LIFETIME_DAYS = 60;

/** A Meta/network error reduced to a short code that is safe to store and show. */
function refreshErrorCode(err) {
  const meta = err?.response?.data?.error;
  if (meta && meta.code != null) return `META_${String(meta.code).replace(/\D/g, '').slice(0, 6)}`;
  if (err?.response?.status) return `HTTP_${err.response.status}`;
  if (err?.code === 'BAD_RESPONSE') return 'BAD_RESPONSE';
  return 'NETWORK';
}

/**
 * Refresh one account's token. Never throws.
 * @returns {Promise<{ok: true, tokenExpiresAt: Date} | {ok: false, tokenDead: boolean, errorCode: string}>}
 */
async function refreshAccountToken(account, { now = new Date() } = {}) {
  try {
    const data = await instagram.refreshLongLivedToken(readAccountToken(account));
    if (!data || typeof data.access_token !== 'string' || !data.access_token || !(Number(data.expires_in) > 0)) {
      throw Object.assign(new Error('refresh response missing fields'), { code: 'BAD_RESPONSE' });
    }
    const tokenExpiresAt = new Date(now.getTime() + Number(data.expires_in) * 1000);
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: {
        ...writeAccountToken(data.access_token),
        tokenExpiresAt,
        tokenStatus: 'VALID',
        tokenRefreshedAt: now,
        tokenRefreshFailedAt: null,
        tokenRefreshError: null,
      },
    });
    return { ok: true, tokenExpiresAt };
  } catch (err) {
    const tokenDead = instagram.isTokenInvalidError(err);
    const errorCode = refreshErrorCode(err);
    await prisma.instagramAccount
      .update({ where: { id: account.id }, data: { tokenRefreshFailedAt: now, tokenRefreshError: errorCode } })
      .catch(() => {});
    if (tokenDead) {
      await markNeedsReconnect(account.id, { reason: 'refresh_rejected' }).catch((e) =>
        console.error('[TokenRefresh] Could not flag account:', e.message)
      );
    }
    return { ok: false, tokenDead, errorCode };
  }
}

/** Accounts due for a refresh now. */
function dueAccountsWhere(now = new Date()) {
  return {
    connectionStatus: 'CONNECTED',
    tokenStatus: 'VALID',
    tokenExpiresAt: {
      gt: now,
      lte: new Date(now.getTime() + Math.min(REFRESH_WINDOW_DAYS, TOKEN_LIFETIME_DAYS - MIN_TOKEN_AGE_DAYS) * DAY_MS),
    },
  };
}

/**
 * The daily run. Sequential on purpose — a handful of accounts a day, and no
 * reason to burst Meta's rate limit.
 *
 * @param {object} [opts]
 * @param {(failures: object[]) => Promise<void>} [opts.onFailures]  alert hook (admin digest)
 */
async function refreshDueTokens({ now = new Date(), limit = 500, onFailures } = {}) {
  const due = await prisma.instagramAccount.findMany({
    where: dueAccountsWhere(now),
    orderBy: { tokenExpiresAt: 'asc' },
    take: limit,
  });

  const failures = [];
  let refreshed = 0;
  for (const account of due) {
    const result = await refreshAccountToken(account, { now });
    if (result.ok) refreshed += 1;
    else failures.push({ accountId: account.id, igUsername: account.igUsername, errorCode: result.errorCode, tokenDead: result.tokenDead });
  }

  if (failures.length && onFailures) {
    await onFailures(failures).catch((err) => console.error('[TokenRefresh] Failure alert could not be sent:', err.message));
  }
  return { due: due.length, refreshed, failed: failures.length, markedReconnect: failures.filter((f) => f.tokenDead).length };
}

module.exports = { refreshAccountToken, refreshDueTokens, dueAccountsWhere, refreshErrorCode, REFRESH_WINDOW_DAYS };
