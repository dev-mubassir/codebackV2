'use client';

/**
 * Keeps the customer session honest about ACTIVITY, and warns before it ends.
 *
 * The backend ends a session after 30 minutes (a setting) with no activity,
 * and it only counts mutating requests and POST /auth/activity — never a GET.
 * So this component is the only thing that turns "the person is actually
 * here" into activity:
 *
 *   - a click (pointerdown), a keystroke, or a page change sends the
 *     heartbeat — at most once a minute across ALL open tabs;
 *   - nothing on a timer does. Polling, refetch-on-focus and socket updates
 *     stay background traffic, so an unattended tab really does time out.
 *
 * Two minutes before the deadline it re-checks the deadline with a GET (a
 * mutation in any tab may have moved it), and only if it still stands shows
 * "You'll be logged out in 2 minutes — Stay signed in?". Clicking Stay is
 * activity. At the deadline the next request gets 401 SESSION_IDLE_EXPIRED,
 * and lib/api.js sends every tab to /login with the reason.
 *
 * Tabs agree through lib/sessionChannel.js: a heartbeat or a new deadline in
 * one tab reschedules (and closes the warning in) all of them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getSessionStatus, sendActivity, logout } from '@/lib/api';
import { broadcastSession, onSessionMessage, SESSION_EXPIRED_URL } from '@/lib/sessionChannel';
import { Button, Modal } from '@/app/components/ui';
import { sessionWarning as t } from '@/content/copy';

const WARN_BEFORE_MS = 2 * 60 * 1000;
const HEARTBEAT_MIN_GAP_MS = 60 * 1000;

export default function SessionGuard() {
  const pathname = usePathname();
  const [deadline, setDeadline] = useState(null); // ms epoch
  const [warning, setWarning] = useState(false);
  const lastBeat = useRef(0);

  const applyDeadline = useCallback((iso, { share = false } = {}) => {
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return;
    setDeadline(at);
    setWarning(false);
    if (share) broadcastSession({ type: 'deadline', at });
  }, []);

  const beat = useCallback(
    async ({ force = false } = {}) => {
      const now = Date.now();
      if (!force && now - lastBeat.current < HEARTBEAT_MIN_GAP_MS) return;
      lastBeat.current = now;
      broadcastSession({ type: 'beat', at: now });
      try {
        const d = await sendActivity();
        applyDeadline(d.idleExpiresAt, { share: true });
      } catch {
        // An ended session is handled by the api.js interceptor; a network
        // blip just means the next real action tries again.
      }
    },
    [applyDeadline]
  );

  // The starting deadline — a GET, so looking does not extend anything.
  useEffect(() => {
    getSessionStatus().then((d) => applyDeadline(d.idleExpiresAt)).catch(() => {});
  }, [applyDeadline]);

  // Real input is activity.
  useEffect(() => {
    const onInput = () => beat();
    window.addEventListener('pointerdown', onInput, { passive: true });
    window.addEventListener('keydown', onInput, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onInput);
      window.removeEventListener('keydown', onInput);
    };
  }, [beat]);

  // So is moving to another page. Skipped on first mount: loading a page is
  // not proof someone is there (a tab restored by the browser, for one).
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    beat();
  }, [pathname, beat]);

  // Other tabs.
  useEffect(
    () =>
      onSessionMessage((msg) => {
        if (msg.type === 'beat' && typeof msg.at === 'number') lastBeat.current = Math.max(lastBeat.current, msg.at);
        if (msg.type === 'deadline' && typeof msg.at === 'number') {
          setDeadline(msg.at);
          setWarning(false);
        }
        if (msg.type === 'expired') window.location.href = SESSION_EXPIRED_URL;
        if (msg.type === 'logout') window.location.href = '/login';
      }),
    []
  );

  // Warn two minutes out; check at the deadline itself.
  useEffect(() => {
    if (!deadline) return undefined;
    const now = Date.now();

    const warnTimer = setTimeout(async () => {
      try {
        const d = await getSessionStatus();
        const real = Date.parse(d.idleExpiresAt);
        if (real > deadline + 1000) setDeadline(real); // moved by a mutation somewhere
        else setWarning(true);
      } catch {
        // 401 → the interceptor has already redirected.
      }
    }, Math.max(0, deadline - WARN_BEFORE_MS - now));

    // A GET just past the deadline: 401 sends every tab to login.
    const expireTimer = setTimeout(() => {
      getSessionStatus().then((d) => applyDeadline(d.idleExpiresAt)).catch(() => {});
    }, Math.max(0, deadline - now + 1000));

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(expireTimer);
    };
  }, [deadline, applyDeadline]);

  async function logOutNow() {
    await logout().catch(() => {});
    broadcastSession({ type: 'logout' });
    window.location.href = '/login';
  }

  if (!warning) return null;

  return (
    <Modal
      title={t.title}
      onClose={() => beat({ force: true })}
      actions={(
        <>
          <Button size="sm" onClick={logOutNow}>{t.logOut}</Button>
          <Button size="sm" variant="primary" onClick={() => beat({ force: true })}>{t.stay}</Button>
        </>
      )}
    >
      <p>{t.body}</p>
    </Modal>
  );
}
