/**
 * Where the onboarding guard was taking someone before it interrupted them.
 *
 * WHY THIS EXISTS. The guard bounces an unfinished user off every internal
 * page, and onboarding then always finished at /dashboard. That silently ate
 * query strings — the one that matters is the Instagram connect landing on
 * `/dashboard?trial=<outcome>`, which is the only place the trial confirmation
 * is ever shown. Connect while unfinished and the trial was granted but never
 * mentioned.
 *
 * Stored in sessionStorage, not a route param: the guard fires from four
 * different places and the wizard is three steps long, so threading it through
 * the URL would mean every one of those steps carrying a redirect parameter.
 * Per-tab is also the right lifetime — a destination from a tab you closed
 * yesterday is not somewhere to send you today.
 *
 * NOTHING HERE TOUCHES TRIAL OR BILLING LOGIC. It restores a URL; whatever
 * that page does with its own query string is unchanged.
 */

const KEY = 'siffty.pendingDestination';

/**
 * Paths that must never be restored.
 *
 * `/onboarding` would loop straight back into the wizard, and the auth pages
 * are where you go when a session ends, never where you were headed.
 */
const NEVER_RESTORE = ['/onboarding', '/login', '/register', '/logout'];

/**
 * True for a path that is safe to hand to router.push().
 *
 * The leading-slash check is the important one. A value like
 * `//evil.example.com/x` is a PROTOCOL-RELATIVE URL: the browser reads it as a
 * different origin, so restoring it unchecked would turn this into an open
 * redirect. sessionStorage is same-origin, but it is also writable by anything
 * running on the page, so the value is validated on the way out rather than
 * trusted because of where it came from.
 */
function isSafeInternalPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  // `/\evil.com` is read as protocol-relative by some browsers.
  if (value.startsWith('/\\')) return false;
  const path = value.split('?')[0].split('#')[0];
  return !NEVER_RESTORE.includes(path);
}

/** Remember the current URL, path and query, before redirecting away from it. */
export function rememberDestination() {
  if (typeof window === 'undefined') return;
  const here = `${window.location.pathname}${window.location.search}`;
  if (!isSafeInternalPath(here)) return;
  try {
    window.sessionStorage.setItem(KEY, here);
  } catch {
    // Private mode, blocked storage. Losing the destination costs a query
    // string, so it must never cost the redirect itself.
  }
}

/**
 * Read the stored destination and clear it, so a later visit to onboarding
 * does not get sent somewhere the user has long since moved on from.
 *
 * @returns {string|null} a safe internal path, or null.
 */
export function takeDestination() {
  if (typeof window === 'undefined') return null;
  let stored = null;
  try {
    stored = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  return isSafeInternalPath(stored) ? stored : null;
}
