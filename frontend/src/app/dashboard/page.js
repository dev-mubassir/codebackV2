'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getAccounts, getInstagramAuthUrl, disconnectAccount, logout, getDashboardSummary, getNotifications } from '@/lib/api';
import styles from './dashboard.module.css';

/**
 * Dashboard page — the Creator Home. Shows what AI handled while the
 * creator was away, what needs their attention now, and their connected
 * Instagram accounts.
 * Redirects to login if not authenticated.
 */
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const userData = await getMe();
        setUser(userData);

        const accountsData = await getAccounts();
        setAccounts(accountsData);

        getDashboardSummary().then(setSummary).catch((e) => console.error('Failed to load dashboard summary:', e));
        getNotifications().then((d) => setNotifUnreadCount(d.unreadCount || 0)).catch(() => {});
      } catch (err) {
        // Not logged in → redirect to landing
        router.push('/');
      } finally {
        setLoading(false);
      }
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDisconnect(accountId) {
    if (!confirm('Disconnect this Instagram account? Your conversation history will be kept safe and will reappear if you reconnect.')) return;

    try {
      await disconnectAccount(accountId);
      setAccounts(prev => prev.map(a => (a.id === accountId ? { ...a, connectionStatus: 'DISCONNECTED' } : a)));
    } catch (err) {
      alert('Failed to disconnect account');
    }
  }

  async function handleLogout() {
    try {
      await logout();
      router.push('/');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className="spinner" />
      </div>
    );
  }

  const breakdown = summary?.breakdown || {};
  const away = summary?.whileYouWereAway;

  return (
    <div className={styles.dashboard}>
      {/* Top nav */}
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <div className={styles.navLogo}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <span className={styles.navTitle}>Codeback</span>
        </div>
        <div className={styles.navActions}>
          <button className="btn btn-secondary btn-sm" onClick={() => router.push('/notifications')} id="notifications-btn">
            🔔 Notifications{notifUnreadCount > 0 ? ` (${notifUnreadCount})` : ''}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => router.push('/brand-deals')} id="brand-deals-btn">
            🔥 Brand Deals
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => router.push('/settings')} id="settings-btn">
            ⚙️ AI Settings
          </button>
          {accounts.length > 0 && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => router.push('/inbox')}
              id="go-to-inbox-btn"
            >
              📥 Open Inbox
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={handleLogout} id="logout-btn">
            Log out
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className={styles.content}>
        <div className={styles.header}>
          <h1>Good {greetingTimeOfDay()}{user?.name ? `, ${user.name}` : ''} 👋</h1>
          <p className={styles.subtitle}>
            {summary
              ? `AI reviewed ${summary.totalDmsReviewed.toLocaleString()} DMs. You need to review ${summary.attentionQueueCount} conversation${summary.attentionQueueCount === 1 ? '' : 's'}.`
              : 'Manage your connected Instagram accounts'}
          </p>
        </div>

        {/* Connection problems */}
        {summary?.connectionProblems?.length > 0 && (
          <div className={styles.alertBanner}>
            ⚠️ {summary.connectionProblems.map(a => `@${a.igUsername || 'account'}`).join(', ')} need{summary.connectionProblems.length === 1 ? 's' : ''} your attention (reconnect below).
          </div>
        )}

        {/* While You Were Away */}
        {away && (
          <div className={styles.awayPanel}>
            <h2 className={styles.awayTitle}>While you were away</h2>
            <p className={styles.awaySubtitle}>{away.newMessages} new DM{away.newMessages === 1 ? '' : 's'} arrived. AI identified:</p>
            <div className={styles.awayGrid}>
              {Object.entries(away.categoryCounts || {}).map(([category, count]) => (
                <button key={category} className={styles.awayItem} onClick={() => router.push(`/inbox?filter=${category}`)}>
                  <span className={styles.awayCount}>{count}</span>
                  <span className={styles.awayLabel}>{category.replace(/_/g, ' ')}</span>
                </button>
              ))}
            </div>
            {away.needsAttention > 0 && (
              <button className="btn btn-primary btn-sm" onClick={() => router.push('/inbox?filter=important')} style={{ marginTop: '12px' }}>
                {away.needsAttention} conversation{away.needsAttention === 1 ? '' : 's'} need your attention →
              </button>
            )}
          </div>
        )}

        {/* AI Work Summary Cards */}
        {summary && (
          <div className={styles.metricsGrid}>
            <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=important')}>
              <span className={styles.metricIcon}>⚠️</span>
              <span className={styles.metricValue}>{summary.attentionQueueCount}</span>
              <span className={styles.metricLabel}>Need Your Attention</span>
            </button>
            <button className={styles.metricCard} onClick={() => router.push('/brand-deals')}>
              <span className={styles.metricIcon}>🔥</span>
              <span className={styles.metricValue}>{breakdown.brandDeals || 0}</span>
              <span className={styles.metricLabel}>Brand Deals</span>
            </button>
            <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=collaboration')}>
              <span className={styles.metricIcon}>🤝</span>
              <span className={styles.metricValue}>{breakdown.collaborations || 0}</span>
              <span className={styles.metricLabel}>Collaborations</span>
            </button>
            <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=customer')}>
              <span className={styles.metricIcon}>💰</span>
              <span className={styles.metricValue}>{breakdown.customers || 0}</span>
              <span className={styles.metricLabel}>Customer Opportunities</span>
            </button>
            <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=unread')}>
              <span className={styles.metricIcon}>●</span>
              <span className={styles.metricValue}>{summary.unreadCount || 0}</span>
              <span className={styles.metricLabel}>Unread</span>
            </button>
          </div>
        )}

        <div className={styles.sectionHeader}>
          <h2>Connected Instagram Accounts</h2>
        </div>

        {/* Connected accounts */}
        {accounts.length > 0 ? (
          <div className={styles.accountsGrid}>
            {accounts.map((account, index) => {
              const isDisconnected = account.connectionStatus === 'DISCONNECTED';
              const needsReconnect = account.tokenStatus === 'NEEDS_RECONNECT' || isDisconnected;
              return (
                <div
                  key={account.id}
                  className={styles.accountCard}
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className={styles.accountHeader}>
                    {account.igProfilePic ? (
                      <img src={account.igProfilePic} alt={account.igUsername} className="avatar avatar-lg" />
                    ) : (
                      <div className="avatar avatar-lg">
                        {(account.igUsername || '?')[0].toUpperCase()}
                      </div>
                    )}
                    <div className={styles.accountInfo}>
                      <h3>@{account.igUsername || 'unknown'}</h3>
                      {account.igName && <p className={styles.accountName}>{account.igName}</p>}
                    </div>
                  </div>

                  <div className={styles.accountMeta}>
                    <div className={styles.metaItem}>
                      {isDisconnected ? (
                        <span className="badge badge-warning">Disconnected</span>
                      ) : (
                        <span className="badge badge-success">Connected</span>
                      )}
                    </div>
                    {account.tokenExpiresAt && (
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>Token expires</span>
                        <span className={styles.metaValue}>
                          {new Date(account.tokenExpiresAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                    {account._count?.conversations !== undefined && (
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>Conversations</span>
                        <span className={styles.metaValue}>{account._count.conversations}</span>
                      </div>
                    )}
                  </div>

                  <div className={styles.accountActions}>
                    {needsReconnect ? (
                      <a href={getInstagramAuthUrl()} className="btn btn-primary btn-sm">
                        Reconnect
                      </a>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => router.push(`/inbox?accountId=${account.id}`)}
                      >
                        Open Inbox
                      </button>
                    )}
                    {!isDisconnected && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDisconnect(account.id)}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📱</div>
            <h2>No accounts connected</h2>
            <p>Connect your Instagram Professional account to start managing DMs</p>
          </div>
        )}

        {/* Connect another account */}
        <div className={styles.connectSection}>
          <a href={getInstagramAuthUrl()} className="btn btn-primary btn-lg" id="connect-instagram-dashboard-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
            {accounts.length > 0 ? 'Connect Another Account' : 'Connect Instagram'}
          </a>
        </div>
      </main>
    </div>
  );
}

function greetingTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}
