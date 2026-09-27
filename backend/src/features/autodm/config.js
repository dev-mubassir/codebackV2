/**
 * Auto DM flags. Read from the environment on EVERY call, never cached at
 * boot, so flipping a value and restarting the service is always enough —
 * and so a test can flip them per case.
 *
 *   AUTODM_ENABLED         master kill switch (default false). Off means:
 *                          comment webhooks ignored, the messaging seam returns
 *                          false before any DB query, the worker loop idles,
 *                          the API answers 404, the sidebar item is hidden, and
 *                          the Instagram connect flow is byte-identical to the
 *                          pre-Auto-DM one for everybody.
 *   AUTODM_SCOPE_ALLOWLIST comma-separated Siffty user emails whose Instagram
 *                          connect asks for instagram_business_manage_comments
 *                          and subscribes the `comments` webhook field.
 *   AUTODM_SCOPE_ALL       true = every user is on the allowlist (after Meta
 *                          App Review approval).
 *   AUTODM_POLL_FALLBACK   insurance for missing comment webhooks: poll the
 *                          comments of active automations' media every 30s
 *                          (allowlisted accounts only). Default false.
 */

const COMMENTS_SCOPE = 'instagram_business_manage_comments';

// The existing per-account webhook fields (lib/instagram.js subscribeToWebhooks),
// plus `comments`. Sent in a SECOND subscribed_apps call, allowlisted users only.
const BASE_FIELDS = 'messages,message_reactions,messaging_seen';
const EXTENDED_FIELDS = `${BASE_FIELDS},comments`;

function flag(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function isEnabled() {
  return flag('AUTODM_ENABLED');
}

function isScopeAll() {
  return flag('AUTODM_SCOPE_ALL');
}

function isPollFallbackEnabled() {
  return isEnabled() && flag('AUTODM_POLL_FALLBACK');
}

let cachedRaw = null;
let cachedSet = new Set();

function allowlist() {
  const raw = String(process.env.AUTODM_SCOPE_ALLOWLIST || '');
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSet = new Set(
      raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
  }
  return cachedSet;
}

/**
 * May this Siffty user use Auto DM (and be asked for the comments scope)?
 * Always false while the kill switch is off.
 */
function isScopeAllowed(email) {
  if (!isEnabled()) return false;
  if (isScopeAll()) return true;
  if (typeof email !== 'string' || !email.trim()) return false;
  return allowlist().has(email.trim().toLowerCase());
}

module.exports = {
  COMMENTS_SCOPE,
  BASE_FIELDS,
  EXTENDED_FIELDS,
  isEnabled,
  isScopeAll,
  isPollFallbackEnabled,
  isScopeAllowed,
};
