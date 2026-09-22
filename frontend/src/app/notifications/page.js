'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/api';
import AppShell from '@/app/components/AppShell';
import Icon from '@/app/components/Icon';
import { nav, common, empty, errors, toast } from '@/content/copy';
import { formatDateTime } from '@/content/format';
import styles from './notifications.module.css';

/**
 * Returns duotone icon name and CSS wrapper class based on notification content.
 */
function getNotificationMeta(n) {
  const text = `${n.title || ''} ${n.body || ''} ${n.type || ''}`.toLowerCase();
  if (text.includes('brand') || text.includes('deal')) {
    return { icon: 'sparkle', className: styles.iconBrand };
  }
  if (text.includes('priority') || text.includes('lead') || text.includes('urgent')) {
    return { icon: 'flame', className: styles.iconLead };
  }
  if (text.includes('warning') || text.includes('quota') || text.includes('problem') || text.includes('disconnect') || text.includes('reconnect')) {
    return { icon: 'alertTriangle', className: styles.iconWarning };
  }
  if (text.includes('instagram')) {
    return { icon: 'instagram', className: styles.iconDefault };
  }
  return { icon: 'bell', className: styles.iconDefault };
}

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread' | 'priority'

  useEffect(() => {
    async function load() {
      try {
        await getMe();
        const data = await getNotifications();
        setNotifications(data.notifications || []);
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
      setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)));
    }
    if (notification.conversationId) {
      router.push(`/inbox?conversationId=${notification.conversationId}`);
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (err) {
      console.error(err);
    }
  }

  const unreadCount = useMemo(() => notifications.filter((n) => !n.isRead).length, [notifications]);

  const filteredNotifications = useMemo(() => {
    if (filter === 'unread') return notifications.filter((n) => !n.isRead);
    if (filter === 'priority') {
      return notifications.filter((n) => {
        const text = `${n.title || ''} ${n.body || ''} ${n.type || ''}`.toLowerCase();
        return text.includes('priority') || text.includes('brand') || text.includes('lead') || text.includes('warning');
      });
    }
    return notifications;
  }, [notifications, filter]);

  return (
    <AppShell activeRoute="/notifications">
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <div className={styles.headerIconBadge}>
            <Icon name="bell" size={24} />
          </div>
          <div>
            <h1 className={styles.pageTitle}>{nav.notifications}</h1>
            <p className={styles.pageSubtitle}>{empty.notifications.body}</p>
          </div>
        </div>

        <div className={styles.headerActions}>
          {unreadCount > 0 && (
            <span className={styles.unreadCountBadge}>
              {unreadCount} unread
            </span>
          )}
          {unreadCount > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={handleMarkAllRead}>
              <Icon name="check" size={13} />
              <span>Mark all read</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className={styles.filterTabs}>
        <button
          className={`${styles.filterBtn} ${filter === 'all' ? styles.filterBtnActive : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({notifications.length})
        </button>
        <button
          className={`${styles.filterBtn} ${filter === 'unread' ? styles.filterBtnActive : ''}`}
          onClick={() => setFilter('unread')}
        >
          Unread ({unreadCount})
        </button>
        <button
          className={`${styles.filterBtn} ${filter === 'priority' ? styles.filterBtnActive : ''}`}
          onClick={() => setFilter('priority')}
        >
          Priority
        </button>
      </div>

      {loading ? (
        <div className={styles.loadingContainer} aria-busy="true" aria-label={common.loading}>
          <div className="spinner spinner-lg" />
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <Icon name="bell" size={28} />
          </div>
          <h3 className={styles.emptyTitle}>
            {filter === 'unread' ? 'No unread notifications' : empty.notifications.title}
          </h3>
          <p className={styles.emptyDesc}>
            {filter === 'unread'
              ? 'You have caught up with all your alerts and messages.'
              : empty.notifications.body}
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {filteredNotifications.map((n) => {
            const meta = getNotificationMeta(n);
            return (
              <button
                key={n.id}
                className={`${styles.item} ${!n.isRead ? styles.itemUnread : ''}`}
                onClick={() => handleClick(n)}
              >
                <div className={`${styles.itemDot} ${n.isRead ? styles.itemDotRead : ''}`} />
                <div className={`${styles.itemIconWrapper} ${meta.className}`}>
                  <Icon name={meta.icon} size={18} />
                </div>
                <div className={styles.itemBody}>
                  <div className={styles.itemTitle}>{n.title}</div>
                  {n.body && <div className={styles.itemMessage}>{n.body}</div>}
                  <div className={styles.itemTime}>
                    <Icon name="clock" size={12} />
                    <span>{formatDateTime(n.createdAt)}</span>
                  </div>
                </div>
                {n.conversationId && (
                  <span className={styles.itemArrow}>
                    <Icon name="arrowRight" size={16} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
