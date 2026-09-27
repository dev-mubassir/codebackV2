/**
 * Instagram connect flow hooks — users with Auto DM access only
 * (access.js hasAutoDmAccess). For everyone else they are no-ops, so the
 * scope string and subscribed_fields stay byte-identical to the pre-Auto-DM
 * flow.
 */

const prisma = require('../../lib/prisma');
const config = require('./config');
const graph = require('./graph');
const log = require('./log');
const { hasAutoDmAccess } = require('./access');

/**
 * Options for lib/instagram.getAuthorizationUrl(). `undefined` for anyone
 * without Auto DM access — the URL is then exactly what it always was. Never
 * throws (any doubt = no extra scope).
 */
async function connectScopeOptions(user) {
  try {
    return (await hasAutoDmAccess(user)) ? { extraScopes: [config.COMMENTS_SCOPE] } : undefined;
  } catch {
    return undefined;
  }
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
    if (!(await hasAutoDmAccess({ id: userId, email }))) return;

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

/**
 * The admin panel's "re-subscribe webhooks" (routes/admin.js) sends the
 * default field set, which would silently drop `comments`. Right after that
 * call succeeds, an account that holds the comments scope AND whose owner has
 * Auto DM access gets the extended call too. Everyone else: nothing happens,
 * so the admin action stays byte-identical. Never throws.
 */
async function afterAdminResubscribe(account, accessToken) {
  try {
    if (!config.isEnabled() || !account || !accessToken) return false;
    const state = await prisma.autoDmAccountState.findUnique({
      where: { instagramAccountId: account.id },
      select: { commentsGranted: true, userId: true },
    });
    if (!state || !state.commentsGranted || state.userId !== account.userId) return false;
    const owner = await prisma.user.findUnique({ where: { id: account.userId }, select: { id: true, email: true } });
    if (!(await hasAutoDmAccess(owner))) return false;

    const at = await subscribeExtended(account.igUserId, accessToken);
    if (at) {
      await prisma.autoDmAccountState.update({ where: { instagramAccountId: account.id }, data: { commentsSubscribedAt: at } });
    }
    log.info(`account ${account.id}: admin re-subscribe ${at ? 'restored' : 'could not restore'} the comments field`);
    return Boolean(at);
  } catch (err) {
    log.error(`admin re-subscribe hook failed (${err && err.code ? err.code : graph.safeErrorCode(err)})`);
    return false;
  }
}

module.exports = { connectScopeOptions, afterInstagramConnect, afterAdminResubscribe, subscribeExtended };
