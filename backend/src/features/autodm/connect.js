/**
 * Instagram connect flow hooks — allowlisted users only, and only while
 * AUTODM_ENABLED is on. For everyone else both functions are no-ops, so the
 * scope string and subscribed_fields stay byte-identical to the pre-Auto-DM
 * flow.
 */

const prisma = require('../../lib/prisma');
const config = require('./config');
const graph = require('./graph');
const log = require('./log');

/**
 * Options for lib/instagram.getAuthorizationUrl(). `undefined` for anyone not
 * allowlisted — the URL is then exactly what it always was.
 */
function connectScopeOptions(email) {
  return config.isScopeAllowed(email) ? { extraScopes: [config.COMMENTS_SCOPE] } : undefined;
}

/**
 * After the existing subscribe call succeeded or failed (it is untouched):
 * record what Meta granted, and for an allowlisted user whose comments scope
 * was granted (or whose grant Meta did not report) make a SECOND
 * subscribed_apps call adding `comments` (+ `messaging_postbacks`). Never
 * throws — a connect must not fail because of Auto DM.
 *
 * When Meta returns no permissions list, the comments scope counts as granted
 * only if the extended subscribe call succeeds.
 */
async function afterInstagramConnect({ userId, email, igUserId, accessToken, grantedScopes }) {
  try {
    if (!config.isScopeAllowed(email)) return;

    const account = await prisma.instagramAccount.findFirst({
      where: { userId, igUserId: String(igUserId), connectionStatus: 'CONNECTED' },
      select: { id: true },
    });
    if (!account) return;

    const scopes = Array.isArray(grantedScopes) ? grantedScopes.filter((s) => typeof s === 'string') : [];
    const reported = scopes.length > 0;
    let commentsGranted = reported && scopes.includes(config.COMMENTS_SCOPE);
    let subscribedAt = null;

    if (commentsGranted || !reported) {
      subscribedAt = await subscribeExtended(igUserId, accessToken);
      if (!reported) commentsGranted = Boolean(subscribedAt);
    }

    const data = {
      grantedScopes: reported ? scopes.join(',').slice(0, 1000) : null,
      commentsGranted,
      commentsSubscribedAt: subscribedAt,
    };
    await prisma.autoDmAccountState.upsert({
      where: { instagramAccountId: account.id },
      create: { instagramAccountId: account.id, userId, ...data },
      update: { userId, ...data },
    });
    log.info(`account ${account.id}: comments scope ${commentsGranted ? 'granted' : 'not granted'}${subscribedAt ? ', comments subscribed' : ''}`);
  } catch (err) {
    log.error(`connect hook failed (${err && err.code ? err.code : graph.safeErrorCode(err)}); the connect itself is unaffected`);
  }
}

/** Fields incl. comments + messaging_postbacks; if refused, retry without postbacks. */
async function subscribeExtended(igUserId, accessToken) {
  for (const fields of [config.EXTENDED_FIELDS, config.EXTENDED_FIELDS_NO_POSTBACKS]) {
    try {
      await graph.subscribeWithComments(igUserId, accessToken, fields);
      return new Date();
    } catch (err) {
      log.warn(`extended webhook subscription refused (${graph.safeErrorCode(err)})`);
    }
  }
  return null;
}

module.exports = { connectScopeOptions, afterInstagramConnect };
