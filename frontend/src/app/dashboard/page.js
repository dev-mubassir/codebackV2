'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getAccounts, getInstagramAuthUrl, disconnectAccount, logout } from '@/lib/api';
import styles from './dashboard.module.css';

/**
 * Dashboard page — shows connected Instagram accounts and the "Connect" CTA.
 * Redirects to login if not authenticated.
 */
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const userData = await getMe();
      setUser(userData);

      const accountsData = await getAccounts();
      setAccounts(accountsData);
    } catch (err) {
      // Not logged in → redirect to landing
      router.push('/');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect(accountId) {
    if (!confirm('Are you sure you want to disconnect this account? All messages will be deleted.')) return;

    try {
      await disconnectAccount(accountId);
      setAccounts(accounts.filter(a => a.id !== accountId));
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
          <h1>Welcome{user?.name ? `, ${user.name}` : ''}</h1>
          <p className={styles.subtitle}>Manage your connected Instagram accounts</p>
        </div>

        {/* Connected accounts */}
        {accounts.length > 0 ? (
          <div className={styles.accountsGrid}>
            {accounts.map((account, index) => (
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
                    <span className="badge badge-success">Connected</span>
                  </div>
                  {account.tokenExpiresAt && (
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Token expires</span>
                      <span className={styles.metaValue}>
                        {new Date(account.tokenExpiresAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>

                <div className={styles.accountActions}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => router.push(`/inbox?accountId=${account.id}`)}
                  >
                    Open Inbox
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDisconnect(account.id)}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
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
