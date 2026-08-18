'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/api';
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

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <a href="/dashboard" className={styles.navBrand}>Codeback</a>
        <button className="btn btn-secondary btn-sm" onClick={() => router.push('/dashboard')}>← Dashboard</button>
      </nav>

      <main className={styles.content}>
        <div className={styles.header}>
          <h1>🔔 Notifications</h1>
          {notifications.some(n => !n.isRead) && (
            <button className="btn btn-secondary btn-sm" onClick={handleMarkAllRead}>Mark all read</button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No notifications yet. We&apos;ll let you know about brand deals and important conversations here.</p>
          </div>
        ) : (
          <div className={styles.list}>
            {notifications.map(n => (
              <button key={n.id} className={`${styles.item} ${!n.isRead ? styles.itemUnread : ''}`} onClick={() => handleClick(n)}>
                <span className={`${styles.itemDot} ${n.isRead ? styles.itemDotRead : ''}`} />
                <div className={styles.itemBody}>
                  <div className={styles.itemTitle}>{n.title}</div>
                  {n.body && <div className={styles.itemMessage}>{n.body}</div>}
                  <div className={styles.itemTime}>{new Date(n.createdAt).toLocaleString()}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
