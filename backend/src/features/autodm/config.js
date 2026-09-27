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
 *   AUTODM_POLL_MODE       off | allowlist | all (default allowlist). The
 *                          comment poller — insurance for comment webhooks
 *                          Meta never sends: every 2 minutes it reads recent
 *                          comments on active automations' posts and feeds
 *                          them to the same intake (unique commentId dedupes).
 *                          `allowlist` = only accounts whose owner is on the
 *                          scope allowlist; `all` = every account with the
 *                          comments scope (after approval). Any other value
 *                          is treated as `off`.
 */

const COMMENTS_SCOPE = 'instagram_business_manage_comments';

// The existing per-account webhook fields (lib/instagram.js subscribeToWebhooks),
// plus `comments` and `messaging_postbacks` (the opener's button tap). Sent in a
// SECOND subscribed_apps call, allowlisted users only. If Meta refuses that set,
// the call is retried once without messaging_postbacks.
const BASE_FIELDS = 'messages,message_reactions,messaging_seen';
const EXTENDED_FIELDS = `${BASE_FIELDS},comments,messaging_postbacks`;
const EXTENDED_FIELDS_NO_POSTBACKS = `${BASE_FIELDS},comments`;

function flag(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function isEnabled() {
  return flag('AUTODM_ENABLED');
}

function isScopeAll() {
  return flag('AUTODM_SCOPE_ALL');
}

/** 'off' | 'allowlist' | 'all' — always 'off' while the kill switch is off. */
function pollMode() {
  if (!isEnabled()) return 'off';
  const raw = process.env.AUTODM_POLL_MODE;
  if (raw === undefined || String(raw).trim() === '') return 'allowlist';
  const v = String(raw).trim().toLowerCase();
  return v === 'allowlist' || v === 'all' ? v : 'off';
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

/** On the explicit email list (ignores AUTODM_SCOPE_ALL) — poll mode `allowlist`. */
function isOnAllowlist(email) {
  if (typeof email !== 'string' || !email.trim()) return false;
  return allowlist().has(email.trim().toLowerCase());
}

/**
 * May this Siffty user use Auto DM (and be asked for the comments scope)?
 * Always false while the kill switch is off.
 */
function isScopeAllowed(email) {
  if (!isEnabled()) return false;
  if (isScopeAll()) return true;
  return isOnAllowlist(email);
}

module.exports = {
  COMMENTS_SCOPE,
  BASE_FIELDS,
  EXTENDED_FIELDS,
  EXTENDED_FIELDS_NO_POSTBACKS,
  isEnabled,
  isScopeAll,
  pollMode,
  isOnAllowlist,
  isScopeAllowed,
};
