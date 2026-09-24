'use client';

/**
 * Notifications — brand deals, priority conversations, customers, and account
 * problems, newest first.
 *
 * The DATA LAYER is master's: the same three endpoints, the same optimistic
 * mark-read on click, the same deep link into the conversation.
 *
 * WHAT CHANGED, AND WHY
 *
 *   1. ANY LOAD FAILURE SENT YOU TO THE MARKETING PAGE. Master caught getMe()
 *      and getNotifications() together and did `router.push('/')`, so a
 *      network blip on the notifications call threw a logged-in user onto the
 *      landing page with no explanation. Auth failures still go to /login; a
 *      failed list now shows `errors.notifications`, which already existed in
 *      copy.js and was never used.
 *   2. "MARK ALL READ" FAILED SILENTLY. The catch was `console.error` and
 *      nothing else, so the button did nothing visible. It now says so, and
 *      `toast.notificationsRead` — also present, also unused — confirms success.
 *   3. THE LIST IS CAPPED AT 30 AND NEVER SAID SO. The API takes `limit`
 *      (default 30, max 100) while `unreadCount` counts everything, so the
 *      badge could read 45 above a list of 30. The page now says when it is
 *      showing a capped list.
 *   4. The subtitle borrowed `empty.notifications.body`, so an empty page
 *      printed the same sentence twice, one line apart.
 *
 * Each notification carries a tinted tile, because here the colour IS the
 * type: an account problem is something you must fix, a priority conversation
 * needs a reply, a customer is money, a brand deal is an opportunity.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/api';
import { rememberDestination } from '@/lib/pendingDestination';
import AppShell from '@/app/components/ui/AppShell';
import Icon from '@/app/components/Icon';
import { Button, EmptyState, ErrorState, IconTile, Skeleton } from '@/app/components/ui';
import { nav, empty, errors, toast, notificationsPage as t } from '@/content/copy';
import { formatDateTime } from '@/content/format';
import styles from './notifications.module.css';

/** The API's own default page size. The list is capped at this. */
const API_LIMIT = 30;

/**
 * Notification.type -> tile. Same rule as the inbox folders: the colour is a
 * claim, and warning is spent only on things you must act on.
 */
const TYPE_PRESENTATION = {
  instagram_connection_problem: { icon: 'alertTriangle', tone: 'warning' },
  high_priority_conversation: { icon: 'messageSquare', tone: 'warning' },
  important_customer: { icon: 'wallet', tone: 'success' },
  new_brand_deal: { icon: 'handshake', tone: 'accent' },
};

const FALLBACK = { icon: 'bell', tone: 'neutral' };

export default function NotificationsPage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [markAllState, setMarkAllState] = useState(''); // '' | 'ok' | 'error'
  const [marking, setMarking] = useState(false);

  async function loadList() {
    try {
      const data = await getNotifications();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
      setLoadError('');
    } catch {
      // A failed LIST is not a failed session. Say so, in place, and let the
      // person retry — do not throw them to the landing page.
      setLoadError(errors.notifications);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let me;
      try {
        me = await getMe();
      } catch {
        if (!cancelled) router.push('/login');
        return;
      }
      if (cancelled) return;
      if (!me?.onboardingCompleted) {
        rememberDestination();
        router.replace('/onboarding');
        return;
      }
      setUser(me);
      await loadList();
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [router]);

  function handleOpen(n) {
    if (!n.isRead) {
      // Optimistic, as master was. A failure here is recovered on the next
      // load, which reads the server's state.
      markNotificationRead(n.id).catch(() => {});
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    if (n.conversationId) router.push(`/inbox?conversationId=${n.conversationId}`);
  }

  async function handleMarkAll() {
    if (marking) return;
    setMarking(true);
    setMarkAllState('');
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
      setMarkAllState('ok');
    } catch {
      setMarkAllState('error');
    } finally {
      setMarking(false);
    }
  }

  const hasUnread = notifications.some((n) => !n.isRead);
  const capped = notifications.length >= API_LIMIT;

  return (
    <AppShell
      user={user}
      title={nav.notifications}
      activeRoute="/notifications"
      notificationCount={unreadCount}
      navCounts={{ '/notifications': unreadCount }}
      actions={hasUnread ? (
        <Button size="sm" onClick={handleMarkAll} loading={marking}>
          <Icon name="check" size={13} />
          {t.markAllRead}
        </Button>
      ) : null}
    >
      <header className={styles.pageHead}>
        <p className={styles.pageSub}>{t.subtitle}</p>
        {markAllState === 'ok' && (
          <p className={styles.okNote} role="status">
            <Icon name="check" size={14} /> {toast.notificationsRead}
          </p>
        )}
        {markAllState === 'error' && (
          <p className={styles.errNote} role="alert">{t.markAllError}</p>
        )}
      </header>

      {loading ? (
        <Skeleton lines={5} height={64} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={loadList} />
      ) : notifications.length === 0 ? (
        <EmptyState icon="bell" title={empty.notifications.title} body={empty.notifications.body} />
      ) : (
        <>
          <ul className={styles.list}>
            {notifications.map((n) => {
              const p = TYPE_PRESENTATION[n.type] || FALLBACK;
              const typeLabel = t.types[n.type];
              const clickable = Boolean(n.conversationId) || !n.isRead;
              const Row = clickable ? 'button' : 'div';
              return (
                <li key={n.id}>
                  <Row
                    {...(clickable ? { type: 'button', onClick: () => handleOpen(n) } : {})}
                    className={`${styles.item} ${!n.isRead ? styles.itemUnread : ''} ${clickable ? styles.itemClickable : ''}`}
                  >
                    <IconTile name={p.icon} tone={p.tone} />
                    <span className={styles.body}>
                      <span className={styles.topLine}>
                        <span className={styles.title}>{n.title}</span>
                        {!n.isRead && <span className={styles.unreadDot} aria-label={t.unread} />}
                      </span>
                      {n.body && <span className={styles.message}>{n.body}</span>}
                      <span className={styles.meta}>
                        {typeLabel && <span>{typeLabel}</span>}
                        {typeLabel && <span aria-hidden="true">·</span>}
                        <time dateTime={n.createdAt}>{formatDateTime(n.createdAt)}</time>
                      </span>
                    </span>
                    {n.conversationId && (
                      <span className={styles.arrow} aria-label={t.openConversation}>
                        <Icon name="chevronRight" size={16} />
                      </span>
                    )}
                  </Row>
                </li>
              );
            })}
          </ul>

          {capped && <p className={styles.capNote}>{t.truncated(notifications.length)}</p>}
        </>
      )}
    </AppShell>
  );
}
