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
        <div className="spinner spinner-lg" />
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
              {/* Non-ERROR alerts previously pointed at /admin/logs, which has no
                  page and 404s. Both levels route to the accounts view until a
                  logs page exists. */}
              <Link href="/admin/accounts" className="btn btn-secondary btn-sm">
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
          <div className={styles.metricValue} style={{ color: (stats?.failedWebhooks24h || 0) > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}>
            {stats?.failedWebhooks24h || 0}
          </div>
          <div className={styles.metricSub}>Webhook delivery failures</div>
        </div>
      </div>

      {/* AI Performance & DM Classification Monitoring */}
      <div className={styles.tableContainer} style={{ marginBottom: '24px' }}>
        <div style={{ padding: '14px 20px', background: 'var(--bg-surface-secondary)', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
            🤖 AI DM Classification & API Performance Monitoring
          </h2>
          {/* Was hardcoded to "Gemini 1.5 Flash", which no longer matched the
              failover chain (Gemini Flash Lite → Grok → OpenAI). Read the live
              provider off aiStats instead. */}
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            Provider: {stats?.aiStats?.lastSuccessfulProvider || 'none yet'}
          </span>
        </div>

        <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Fast Keyword Matches</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>{stats?.aiStats?.keywordMatches || 0}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', marginTop: '2px' }}>⚡ 0ms API Latency (Free)</div>
          </div>

          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Total AI API Calls</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginTop: '4px' }}>{stats?.aiStats?.totalCalls || 0}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '2px' }}>{stats?.aiStats?.aiSuccess || 0} successful</div>
          </div>

          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '14px' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Failed AI API Calls</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: (stats?.aiStats?.aiFailures || 0) > 0 ? 'var(--color-error)' : 'var(--text-primary)', marginTop: '4px' }}>
              {stats?.aiStats?.aiFailures || 0}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>Fallback to &quot;Other&quot;</div>
          </div>
        </div>
      </div>

      {/* Recent Signups Section */}
      <div className={styles.tableContainer}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Recent Signups</h2>
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
                <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '24px' }}>No signups recorded yet.</td>
              </tr>
            ) : (
              stats.recentSignups.map(user => (
                <tr key={user.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.name || 'Unnamed User'}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{user.email || 'No email set'}</div>
                  </td>
                  <td>
                    {user.instagramAccounts?.length === 0 ? (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>None</span>
                    ) : (
                      user.instagramAccounts.map(acc => (
                        <span key={acc.id} className={styles.badgeValid} style={{ marginRight: '6px' }}>
                          @{acc.igUsername || 'account'}
                        </span>
                      ))
                    )}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
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
