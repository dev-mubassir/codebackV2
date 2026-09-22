/**
 * Keeping the account owner's OWN Instagram profile picture alive.
 *
 * THE PROBLEM. `InstagramAccount.igProfilePic` is written once, at OAuth
 * connect (routes/auth.js), and never again. It is an Instagram CDN URL signed
 * with an `oe=` expiry roughly four days out, so within a week of connecting,
 * the picture shown on /profile and in the admin accounts table is a URL that
 * returns HTTP 403. The frontend <Avatar> already degrades to an initial, so
 * nothing looks broken — the photo just silently never appears again.
 *
 * WHY IT HANGS OFF GET /auth/me. Every authenticated screen calls /auth/me at
 * mount, so it is the one request guaranteed to happen while someone is
 * actually looking at their own avatar. No new scheduled job, no new Graph API
 * traffic beyond one call per account per few days, and no schema change.
 *
 * WHAT IT MUST NEVER DO. /auth/me is the app's bootstrap call: if it is slow,
 * every page is slow, and if it throws, the user is bounced to /login. So this
 * runs AFTER the response has been sent and its promise is deliberately not
 * awaited. A Graph failure logs and leaves the stored value alone.
 */

const prisma = require('./prisma');
const instagram = require('./instagram');
const { decrypt } = require('./crypto');

/** One Instagram call per account per day, even when every attempt fails. */
const MIN_ATTEMPT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * accountId -> timestamp of the last attempt.
 *
 * In memory, and deliberately so: adding a column for this would be a schema
 * change for a cosmetic refresh. A restart forgets the attempts and the next
 * /auth/me retries, which is the harmless direction to fail in. A SUCCESSFUL
 * refresh does not depend on this map at all — it writes a URL whose `oe=` is
 * days away, so `isProfilePicExpiring()` returns false and nothing retries.
 * The map exists to stop a FAILING account being retried on every page load.
 */
const lastAttempt = new Map();

/** Exported for tests, and for a future admin "force refresh" control. */
function resetAvatarRefreshThrottle() {
  lastAttempt.clear();
}

function shouldAttempt(account, now) {
  if (!account?.id) return false;
  // Only a live connection has a token worth spending.
  if (account.connectionStatus !== 'CONNECTED') return false;
  if (account.tokenStatus === 'NEEDS_RECONNECT') return false;
  // A URL we cannot parse is not evidence of expiry — isProfilePicExpiring
  // returns false for those, and we leave them alone.
  if (!instagram.isProfilePicExpiring(account.igProfilePic)) return false;

  const previous = lastAttempt.get(account.id);
  if (previous && now - previous < MIN_ATTEMPT_INTERVAL_MS) return false;

  return true;
}

/**
 * Refresh one account's stored picture. Resolves to true only when a new URL
 * was written. Never rejects.
 */
async function refreshOne(account, now) {
  lastAttempt.set(account.id, now);

  try {
    const full = await prisma.instagramAccount.findUnique({
      where: { id: account.id },
      select: { id: true, accessToken: true, tokenKeyVersion: true },
    });
    if (!full?.accessToken) return false;

    const profile = await instagram.fetchMyProfile(decrypt(full.accessToken));
    const fresh = profile?.profile_picture_url;

    // fetchMyProfile resolves with whatever Meta returned; no picture in the
    // payload is not an error, it just means there is nothing to store.
    if (!fresh || fresh === account.igProfilePic) return false;

    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { igProfilePic: fresh },
    });

    console.log(`[AccountAvatar] Refreshed profile picture for account ${account.id}.`);
    return true;
  } catch (err) {
    // Keep the old value and move on. This is cosmetic: a stale picture is a
    // letter in a circle, and it is not worth flagging the account over —
    // that judgement belongs to tokenHealth, on a call that actually matters.
    console.warn(`[AccountAvatar] Refresh failed for account ${account.id}: ${err.message}`);
    return false;
  }
}

/**
 * Fire-and-forget refresh for every account on the payload /auth/me just sent.
 *
 * Callers MUST NOT await this, and it never rejects, so an unhandled rejection
 * cannot reach the request. Returns a promise only so tests can wait for it.
 */
function refreshExpiringAccountAvatars(accounts) {
  const now = Date.now();
  const due = (accounts || []).filter((a) => shouldAttempt(a, now));
  if (due.length === 0) return Promise.resolve(0);

  return Promise.all(due.map((a) => refreshOne(a, now)))
    .then((results) => results.filter(Boolean).length)
    .catch((err) => {
      console.warn('[AccountAvatar] Refresh sweep failed:', err.message);
      return 0;
    });
}

module.exports = {
  refreshExpiringAccountAvatars,
  resetAvatarRefreshThrottle,
  MIN_ATTEMPT_INTERVAL_MS,
};
