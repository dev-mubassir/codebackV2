'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/api';
import AppShell from '@/app/components/AppShell';
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
          <h1 className={styles.pageTitle}>🔔 Notifications</h1>
          <p className={styles.pageSubtitle}>
            Important updates regarding brand deals, high priority messages, and connection health.
          </p>
        </div>
        {notifications.some(n => !n.isRead) && (
          <button className="btn btn-secondary btn-sm" onClick={handleMarkAllRead}>
            Mark all as read
          </button>
        )}
      </div>

      {loading ? (
        <div className={styles.loadingContainer}>
          <div className="spinner spinner-lg" />
        </div>
      ) : notifications.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🔔</div>
          <h3 className={styles.emptyTitle}>No notifications yet</h3>
          <p className={styles.emptyDesc}>
            We&apos;ll notify you here when AI detects high-priority brand deals or critical conversations.
          </p>
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
                <div className={styles.itemTime}>{new Date(n.createdAt).toLocaleString()}</div>
              </div>
              {n.conversationId && (
                <span className={styles.itemArrow}>→</span>
              )}
            </button>
          ))}
        </div>
      )}
    </AppShell>
  );
}
