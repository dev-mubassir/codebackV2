/**
 * One BroadcastChannel shared by every open tab of the app, so the tabs agree
 * about the session instead of each running its own idea of it:
 *
 *   { type: 'deadline', at }  the server moved the idle deadline (some tab sent
 *                             activity) — every tab reschedules and closes its
 *                             warning
 *   { type: 'beat', at }      a tab just sent a heartbeat — the others skip
 *                             theirs, so N tabs do not send N heartbeats
 *   { type: 'expired' }       the session timed out — every tab goes to login
 *                             with the "signed out for inactivity" message
 *   { type: 'logout' }        the person logged out — every tab goes to login
 *
 * Browsers without BroadcastChannel (and server rendering) get a no-op: each
 * tab then simply works on its own, which is still correct, just chattier.
 */

const NAME = 'siffty-session';
let channel = null;

function getChannel() {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return null;
  if (!channel) channel = new window.BroadcastChannel(NAME);
  return channel;
}

export function broadcastSession(message) {
  try {
    getChannel()?.postMessage(message);
  } catch {
    // A closed channel during page teardown — nothing to tell anyone.
  }
}

/** Subscribe; returns the unsubscribe function. */
export function onSessionMessage(handler) {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (event) => handler(event.data || {});
  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
}

export const SESSION_EXPIRED_URL = '/login?error=session_expired';
