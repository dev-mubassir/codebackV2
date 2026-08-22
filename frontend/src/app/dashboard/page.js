'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getAccounts, getInstagramAuthUrl, disconnectAccount, getDashboardSummary } from '@/lib/api';
import AppShell from '@/app/components/AppShell';
import styles from './dashboard.module.css';

/**
 * Dashboard page — the Creator Home. Shows what AI handled while the
 * creator was away, what needs their attention now, and their connected
 * Instagram accounts.
 */
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const userData = await getMe();
        if (!userData?.onboardingCompleted) {
          router.push('/onboarding');
          return;
        }
        setUser(userData);

        const accountsData = await getAccounts();
        setAccounts(accountsData);

        getDashboardSummary().then(setSummary).catch((e) => console.error('Failed to load dashboard summary:', e));
      } catch (err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleConnect(e) {
    if (e) e.preventDefault();
    // Programmatic navigation prevents mobile OS from intercepting universal links into the native app
    window.location.href = getInstagramAuthUrl();
  }

  async function handleDisconnect(accountId) {
    if (!confirm('Disconnect this Instagram account? Your conversation history will be kept safe and will reappear if you reconnect.')) return;

    try {
      await disconnectAccount(accountId);
      setAccounts(prev => prev.map(a => (a.id === accountId ? { ...a, connectionStatus: 'DISCONNECTED' } : a)));
    } catch (err) {
      alert('Failed to disconnect account');
    }
  }

  if (loading) {
    return (
      <AppShell activeRoute="/dashboard">
        <div className={styles.loadingSkeleton}>
          <div className={`skeleton ${styles.skeletonTitle}`} />
          <div className={styles.skeletonCards}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className={`skeleton ${styles.skeletonCard}`} />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  const breakdown = summary?.breakdown || {};
  const away = summary?.whileYouWereAway;

  return (
    <AppShell activeRoute="/dashboard">
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            Good {greetingTimeOfDay()}{user?.name ? `, ${user.name}` : ''}
          </h1>
          <p className={styles.pageSubtitle}>
            {summary
              ? `AI reviewed ${summary.totalDmsReviewed.toLocaleString()} DMs. ${summary.attentionQueueCount} conversation${summary.attentionQueueCount === 1 ? '' : 's'} need${summary.attentionQueueCount === 1 ? 's' : ''} your attention.`
              : 'Manage your connected Instagram accounts and monitor AI activity.'}
          </p>
        </div>
        <a
          href={getInstagramAuthUrl()}
          onClick={handleConnect}
          className="btn btn-primary"
          id="connect-instagram-dashboard-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
          </svg>
          {accounts.length > 0 ? 'Add Account' : 'Connect Instagram'}
        </a>
      </div>

      {/* Connection problems */}
      {summary?.connectionProblems?.length > 0 && (
        <div className={styles.alertBanner}>
          <div className={styles.alertIcon}>⚠️</div>
          <div className={styles.alertContent}>
            <strong>Account attention needed</strong>
            <span>{summary.connectionProblems.map(a => `@${a.igUsername || 'account'}`).join(', ')} need{summary.connectionProblems.length === 1 ? 's' : ''} reconnection.</span>
          </div>
        </div>
      )}

      {/* Metrics Cards */}
      {summary && (
        <div className={styles.metricsGrid}>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=important')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconAttention}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            </div>
            <div className={styles.metricValue}>{summary.attentionQueueCount}</div>
            <div className={styles.metricLabel}>Need Attention</div>
          </button>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=hot_leads')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconDeals}`}>🔥</div>
            <div className={styles.metricValue}>{breakdown.hotLeads || breakdown.brandDeals || 0}</div>
            <div className={styles.metricLabel}>Hot Leads</div>
          </button>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=collaboration')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconCollabs}`}>🤝</div>
            <div className={styles.metricValue}>{breakdown.collaborations || 0}</div>
            <div className={styles.metricLabel}>Collaborations</div>
          </button>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=unread')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconUnread}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </div>
            <div className={styles.metricValue}>{summary.unreadCount || 0}</div>
            <div className={styles.metricLabel}>Unread Messages</div>
          </button>
        </div>
      )}

      {/* While You Were Away */}
      {away && (
        <div className={styles.awayCard}>
          <div className={styles.awayHeader}>
            <h2 className={styles.cardTitle}>While you were away</h2>
            <span className={styles.awaySubtext}>{away.newMessages} new DM{away.newMessages === 1 ? '' : 's'}</span>
          </div>
          <div className={styles.awayGrid}>
            {Object.entries(away.categoryCounts || {}).map(([category, count]) => (
              <button key={category} className={styles.awayChip} onClick={() => router.push(`/inbox?filter=${category}`)}>
                <span className={styles.awayChipCount}>{count}</span>
                <span className={styles.awayChipLabel}>{category.replace(/_/g, ' ')}</span>
              </button>
            ))}
          </div>
          {away.needsAttention > 0 && (
            <button className="btn btn-primary btn-sm" onClick={() => router.push('/inbox?filter=important')} style={{ marginTop: '16px' }}>
              Review {away.needsAttention} important conversation{away.needsAttention === 1 ? '' : 's'} →
            </button>
          )}
        </div>
      )}

      {/* Connected Accounts */}
      <div className={styles.sectionHeader}>
        <h2 className={styles.cardTitle}>Connected Accounts</h2>
        <span className={styles.sectionCount}>{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
      </div>

      {accounts.length > 0 ? (
        <div className={styles.accountsList}>
          {accounts.map((account) => {
            const isDisconnected = account.connectionStatus === 'DISCONNECTED';
            const needsReconnect = account.tokenStatus === 'NEEDS_RECONNECT' || isDisconnected;
            return (
              <div key={account.id} className={styles.accountRow}>
                <div className={styles.accountLeft}>
                  {account.igProfilePic ? (
                    <img src={account.igProfilePic} alt={account.igUsername} className={styles.accountAvatar} />
                  ) : (
                    <div className={`avatar avatar-lg ${styles.accountAvatarFallback}`}>
                      {(account.igUsername || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <div className={styles.accountInfo}>
                    <div className={styles.accountUsername}>@{account.igUsername || 'unknown'}</div>
                    {account.igName && <div className={styles.accountName}>{account.igName}</div>}
                  </div>
                </div>
                <div className={styles.accountMeta}>
                  {isDisconnected ? (
                    <span className="badge badge-warning">Disconnected</span>
                  ) : (
                    <span className="badge badge-success">Connected</span>
                  )}
                  {account.tokenExpiresAt && (
                    <span className={styles.accountMetaItem}>
                      Token expires {new Date(account.tokenExpiresAt).toLocaleDateString()}
                    </span>
                  )}
                  {account._count?.conversations !== undefined && (
                    <span className={styles.accountMetaItem}>
                      {account._count.conversations} conversation{account._count.conversations !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className={styles.accountActions}>
                  {needsReconnect ? (
                    <a href={getInstagramAuthUrl()} onClick={handleConnect} className="btn btn-primary btn-sm">Reconnect</a>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => router.push(`/inbox?accountId=${account.id}`)}>
                      Open Inbox
                    </button>
                  )}
                  {!isDisconnected && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleDisconnect(account.id)}>
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
          <div className={styles.emptyIcon}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
          </div>
          <h3 className={styles.emptyTitle}>No accounts connected</h3>
          <p className={styles.emptyDesc}>Connect your Instagram Professional account to start managing DMs with AI.</p>
          <a href={getInstagramAuthUrl()} onClick={handleConnect} className="btn btn-primary" style={{ marginTop: '12px' }}>Connect Instagram</a>
        </div>
      )}
    </AppShell>
  );
}

function greetingTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}
