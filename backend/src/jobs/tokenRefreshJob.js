/**
 * Daily Instagram token maintenance (Gate 3B), recorded as the
 * `instagram_token_refresh` job run.
 *
 *   1. refreshDueTokens — refresh long-lived tokens within 10 days of expiry
 *      (lib/tokenRefresh.js); failures go to the admins in ONE digest email.
 *   2. flagExpiredTokens — the existing sweep (lib/tokenHealth.js) that was
 *      written but never scheduled: tokens that expired anyway (refresh kept
 *      failing, or an account nobody used) are marked NEEDS_RECONNECT and the
 *      owner is emailed once. Kept rather than replaced: refresh cannot help
 *      an already-expired token (Meta refuses it), and this is the part that
 *      tells the customer.
 */

const { refreshDueTokens } = require('../lib/tokenRefresh');
const { flagExpiredTokens } = require('../lib/tokenHealth');
const { sendAdminOpsAlert } = require('../lib/adminAlerts');

async function alertFailures(failures) {
  await sendAdminOpsAlert({
    title: `Instagram token refresh failed for ${failures.length} account(s)`,
    lead:
      'The daily refresh could not renew these Instagram access tokens. Accounts marked "dead" need the customer to reconnect; the rest are retried tomorrow.',
    facts: failures.map((f) => `@${f.igUsername || f.accountId} · ${f.errorCode}${f.tokenDead ? ' · dead — reconnect needed' : ''}`),
  });
}

async function runTokenMaintenance({ now = new Date() } = {}) {
  const refresh = await refreshDueTokens({ now, onFailures: alertFailures });
  const flaggedExpired = await flagExpiredTokens();
  return { ...refresh, flaggedExpired };
}

module.exports = { runTokenMaintenance, alertFailures };
