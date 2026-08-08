'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAdminStats } from '@/lib/api';
import styles from './admin.module.css';

export default function AdminDashboardHome() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const data = await getAdminStats();
        setStats(data);
      } catch (err) {
        console.error('Failed to load admin stats:', err);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div>
      {/* System Alerts */}
      {stats?.alerts && stats.alerts.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          {stats.alerts.map((alert, idx) => (
            <div key={idx} className={`${styles.alertBox} ${styles.alertBoxWarning}`}>
              <div>
                <span className={styles.alertTitle}>[{alert.level}] {alert.title}: </span>
                <span className={styles.alertText}>{alert.message}</span>
              </div>
              <Link href={alert.level === 'ERROR' ? '/admin/accounts' : '/admin/logs'} className="btn btn-secondary btn-sm">
                Investigate ↗
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Metrics Cards Grid */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Total Users</div>
          <div className={styles.metricValue}>{stats?.totalUsers || 0}</div>
          <div className={styles.metricSub}>Registered on platform</div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Connected IG Accounts</div>
          <div className={styles.metricValue}>{stats?.totalAccounts || 0}</div>
          <div className={styles.metricSub}>{stats?.activeAccounts || 0} active / {stats?.expiredAccounts || 0} expired</div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Messages Today</div>
          <div className={styles.metricValue}>{stats?.messagesToday || 0}</div>
          <div className={styles.metricSub}>{stats?.messagesThisWeek || 0} this week</div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricTitle}>Failed Webhooks (24h)</div>
          <div className={styles.metricValue} style={{ color: (stats?.failedWebhooks24h || 0) > 0 ? '#ff4444' : '#ffffff' }}>
            {stats?.failedWebhooks24h || 0}
          </div>
          <div className={styles.metricSub}>Webhook delivery failures</div>
        </div>
      </div>

      {/* AI Performance & DM Classification Monitoring */}
      <div className={styles.tableContainer} style={{ marginBottom: '24px' }}>
        <div style={{ padding: '16px', background: '#141414', borderBottom: '1px solid #262626', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 800, textTransform: 'uppercase' }}>
            🤖 AI DM Classification & API Performance Monitoring
          </h2>
          <span style={{ fontSize: '0.75rem', color: '#a3a3a3', fontFamily: 'var(--font-mono)' }}>Provider: Gemini 1.5 Flash</span>
        </div>

        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <div style={{ background: '#000000', border: '1px solid #262626', padding: '12px' }}>
            <div style={{ fontSize: '0.6875rem', color: '#a3a3a3', textTransform: 'uppercase' }}>Fast Keyword Matches</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff' }}>{stats?.aiStats?.keywordMatches || 0}</div>
            <div style={{ fontSize: '0.6875rem', color: '#00ff66' }}>⚡ 0ms API Latency (Free)</div>
          </div>

          <div style={{ background: '#000000', border: '1px solid #262626', padding: '12px' }}>
            <div style={{ fontSize: '0.6875rem', color: '#a3a3a3', textTransform: 'uppercase' }}>Total AI API Calls</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{stats?.aiStats?.totalCalls || 0}</div>
            <div style={{ fontSize: '0.6875rem', color: '#a3a3a3' }}>{stats?.aiStats?.aiSuccess || 0} successful</div>
          </div>

          <div style={{ background: '#000000', border: '1px solid #262626', padding: '12px' }}>
            <div style={{ fontSize: '0.6875rem', color: '#a3a3a3', textTransform: 'uppercase' }}>Failed AI API Calls</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: (stats?.aiStats?.aiFailures || 0) > 0 ? '#ff4444' : '#ffffff' }}>
              {stats?.aiStats?.aiFailures || 0}
            </div>
            <div style={{ fontSize: '0.6875rem', color: '#737373' }}>Fallback to "Other"</div>
          </div>
        </div>
      </div>

      {/* Recent Signups Section */}
      <div className={styles.tableContainer} style={{ marginTop: '24px' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #262626', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '0.9375rem', fontWeight: 800, textTransform: 'uppercase' }}>Recent Signups</h2>
          <Link href="/admin/users" className="btn btn-secondary btn-sm">View All Users ↗</Link>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>User</th>
              <th>Connected Accounts</th>
              <th>Joined Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {!stats?.recentSignups || stats.recentSignups.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', color: '#737373', padding: '24px' }}>No signups recorded yet.</td>
              </tr>
            ) : (
              stats.recentSignups.map(user => (
                <tr key={user.id}>
                  <td>
                    <div style={{ fontWeight: 'bold' }}>{user.name || 'Unnamed User'}</div>
                    <div style={{ fontSize: '0.75rem', color: '#a3a3a3' }}>{user.email || 'No email set'}</div>
                  </td>
                  <td>
                    {user.instagramAccounts?.length === 0 ? (
                      <span style={{ color: '#737373' }}>None</span>
                    ) : (
                      user.instagramAccounts.map(acc => (
                        <span key={acc.id} className={styles.badgeValid} style={{ marginRight: '6px' }}>
                          @{acc.igUsername || 'account'}
                        </span>
                      ))
                    )}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <Link href={`/admin/users?search=${encodeURIComponent(user.name || user.id)}`} className="btn btn-secondary btn-sm">
                      Inspect
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
