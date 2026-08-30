'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/api';
import AppShell from '@/app/components/AppShell';
import Icon from '@/app/components/Icon';
import { nav, common, empty, errors, toast } from '@/content/copy';
import { formatDateTime } from '@/content/format';
import styles from './notifications.module.css';

/**
 * Notification center — new_brand_deal, high_priority_conversation,
 * important_customer, ai_analysis_completed, instagram_connection_problem.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        await getMe();
        const data = await getNotifications();
        setNotifications(data.notifications);
      } catch (err) {
        router.push('/');
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleClick(notification) {
    if (!notification.isRead) {
      markNotificationRead(notification.id).catch(() => {});
      setNotifications(prev => prev.map(n => (n.id === notification.id ? { ...n, isRead: true } : n)));
    }
    if (notification.conversationId) {
      router.push(`/inbox?conversationId=${notification.conversationId}`);
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <AppShell activeRoute="/notifications">
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{nav.notifications}</h1>
          <p className={styles.pageSubtitle}>{empty.notifications.body}</p>
        </div>
        {notifications.some(n => !n.isRead) && (
          <button className="btn btn-secondary btn-sm" onClick={handleMarkAllRead}>
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className={styles.loadingContainer} aria-busy="true" aria-label={common.loading}>
          <div className="spinner spinner-lg" />
        </div>
      ) : notifications.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><Icon name="bell" size={32} strokeWidth={1.5} /></div>
          <h3 className={styles.emptyTitle}>{empty.notifications.title}</h3>
          <p className={styles.emptyDesc}>{empty.notifications.body}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {notifications.map(n => (
            <button
              key={n.id}
              className={`${styles.item} ${!n.isRead ? styles.itemUnread : ''}`}
              onClick={() => handleClick(n)}
            >
              <div className={`${styles.itemDot} ${n.isRead ? styles.itemDotRead : ''}`} />
              <div className={styles.itemBody}>
                <div className={styles.itemTitle}>{n.title}</div>
                {n.body && <div className={styles.itemMessage}>{n.body}</div>}
                <div className={styles.itemTime}>{formatDateTime(n.createdAt)}</div>
              </div>
              {n.conversationId && (
                <span className={styles.itemArrow}><Icon name="arrowRight" size={14} /></span>
              )}
            </button>
          ))}
        </div>
      )}
    </AppShell>
  );
}
