'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAdminStats } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { admin as t, common, errors, empty } from '@/content/copy';
import { alertLevelLabel } from '@/content/labels';
import { formatCount, formatDate } from '@/content/format';
import styles from './admin.module.css';

export default function AdminDashboardHome() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadStats() {
      try {
        const data = await getAdminStats();
        setStats(data);
      } catch (err) {
        setError(errors.admin.stats);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }} aria-busy="true" aria-label={common.loading}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.alertBox} ${styles.alertBoxWarning}`} role="alert">
        <span className={styles.alertText}>{error}</span>
      </div>
    );
  }

  const ai = stats?.aiStats || {};

  return (
    <div>
      {stats?.alerts?.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          {stats.alerts.map((alert, idx) => (
            <div key={idx} className={`${styles.alertBox} ${styles.alertBoxWarning}`}>
              <div>
                <span className={styles.alertTitle}>{alertLevelLabel(alert.level).label} — {alert.title}: </span>
                <span className={styles.alertText}>{alert.message}</span>
              </div>
              {/* Both levels route to the accounts view; /admin/logs has no page
                  and would 404. */}
              <Link href="/admin/accounts" className="btn btn-secondary btn-sm">
                {t.dashboard.investigate}
                <Icon name="arrowRight" size={13} />
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span className={styles.metricTitle}>{t.dashboard.metrics.users.label}</span>
            <div className={styles.metricIcon}>
              <Icon name="users" size={18} />
            </div>
          </div>
          <div className={styles.metricValue}>{formatCount(stats?.totalUsers)}</div>
          <div className={styles.metricSub}>{t.dashboard.metrics.users.hint}</div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span className={styles.metricTitle}>{t.dashboard.metrics.accounts.label}</span>
            <div className={styles.metricIcon}>
              <Icon name="instagram" size={18} />
            </div>
          </div>
          <div className={styles.metricValue}>{formatCount(stats?.totalAccounts)}</div>
          <div className={styles.metricSub}>
            {formatCount(stats?.activeAccounts)} active, {formatCount(stats?.expiredAccounts)} need reconnecting
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span className={styles.metricTitle}>{t.dashboard.metrics.messages.label}</span>
            <div className={styles.metricIcon}>
              <Icon name="messageSquare" size={18} />
            </div>
          </div>
          <div className={styles.metricValue}>{formatCount(stats?.messagesToday)}</div>
          <div className={styles.metricSub}>{formatCount(stats?.messagesThisWeek)} in the last 7 days</div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricTop}>
            <span className={styles.metricTitle}>{t.dashboard.metrics.failedWebhooks.label}</span>
            <div className={styles.metricIcon}>
              <Icon name="alertTriangle" size={18} />
            </div>
          </div>
          <div
            className={styles.metricValue}
            style={{ color: (stats?.failedWebhooks24h || 0) > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}
          >
            {formatCount(stats?.failedWebhooks24h)}
          </div>
          <div className={styles.metricSub}>{t.dashboard.metrics.failedWebhooks.hint}</div>
        </div>
      </div>

      {/* Message processing. These three counters live in the API process's
          memory, so they reset to zero on every restart and count only the
          process serving this request. The subtitle says so — without it the
          numbers look like all-time totals and lead to wrong conclusions. */}
      <div className={styles.tableContainer} style={{ marginBottom: '24px' }}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{t.dashboard.processing.title}</h2>
            <p className={styles.panelSubtitle}>{t.dashboard.processing.subtitle}</p>
          </div>
          <span className={styles.panelMeta}>
            {t.dashboard.processing.provider}: {ai.lastSuccessfulProvider || t.dashboard.processing.providerNone}
          </span>
        </div>

        <div className={styles.statStrip}>
          <div className={styles.statTile}>
            <div className={styles.statTileLabel}>{t.dashboard.processing.keywordMatches.label}</div>
            <div className={styles.statTileValue}>{formatCount(ai.keywordMatches)}</div>
            <div className={styles.statTileHint}>{t.dashboard.processing.keywordMatches.hint}</div>
          </div>

          <div className={styles.statTile}>
            <div className={styles.statTileLabel}>{t.dashboard.processing.totalCalls.label}</div>
            <div className={styles.statTileValue}>{formatCount(ai.totalCalls)}</div>
            <div className={styles.statTileHint}>
              {formatCount(ai.aiSuccess)} {t.dashboard.processing.totalCalls.hint}
            </div>
          </div>

          <div className={styles.statTile}>
            <div className={styles.statTileLabel}>{t.dashboard.processing.failures.label}</div>
            <div
              className={styles.statTileValue}
              style={{ color: (ai.aiFailures || 0) > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}
            >
              {formatCount(ai.aiFailures)}
            </div>
            <div className={styles.statTileHint}>{t.dashboard.processing.failures.hint}</div>
          </div>
        </div>
      </div>

      {/* Backlog. The stats endpoint already returned these three, and nothing
          rendered them — they are the numbers that actually tell an operator
          whether anything is stuck. */}
      <div className={styles.tableContainer} style={{ marginBottom: '24px' }}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{t.dashboard.backlog.title}</h2>
            <p className={styles.panelSubtitle}>{t.dashboard.backlog.subtitle}</p>
          </div>
        </div>

        <div className={styles.statStrip}>
          <div className={styles.statTile}>
            <div className={styles.statTileLabel}>{t.dashboard.backlog.pending.label}</div>
            <div className={styles.statTileValue}>{formatCount(stats?.pendingAiMessages)}</div>
            <div className={styles.statTileHint}>{t.dashboard.backlog.pending.hint}</div>
          </div>

          <div className={styles.statTile}>
            <div className={styles.statTileLabel}>{t.dashboard.backlog.failed.label}</div>
            <div
              className={styles.statTileValue}
              style={{ color: (stats?.failedAiMessages || 0) > 0 ? 'var(--color-error)' : 'var(--text-primary)' }}
            >
              {formatCount(stats?.failedAiMessages)}
            </div>
            <div className={styles.statTileHint}>{t.dashboard.backlog.failed.hint}</div>
          </div>

          <div className={styles.statTile}>
            <div className={styles.statTileLabel}>{t.dashboard.backlog.queueMode.label}</div>
            <div className={styles.statTileValue} style={{ fontSize: 'var(--text-md)' }}>
              {stats?.queueMode || common.unknown}
            </div>
            <div className={styles.statTileHint}>{t.dashboard.backlog.queueMode.hint}</div>
          </div>
        </div>
      </div>

      <div className={styles.tableContainer}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{t.dashboard.recentSignups.title}</h2>
          <Link href="/admin/users" className="btn btn-secondary btn-sm">
            {t.dashboard.recentSignups.viewAll}
            <Icon name="arrowRight" size={13} />
          </Link>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t.dashboard.recentSignups.columns.user}</th>
              <th>{t.dashboard.recentSignups.columns.accounts}</th>
              <th>{t.dashboard.recentSignups.columns.joined}</th>
              <th>
                <span className="sr-only">{t.dashboard.recentSignups.inspect}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!stats?.recentSignups || stats.recentSignups.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '24px' }}>
                  {t.dashboard.recentSignups.empty}
                </td>
              </tr>
            ) : (
              stats.recentSignups.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.name || t.users.unnamed}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      {user.email || t.users.noEmail}
                    </div>
                  </td>
                  <td>
                    {user.instagramAccounts?.length === 0 ? (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                        {t.users.noAccounts}
                      </span>
                    ) : (
                      user.instagramAccounts.map((acc) => (
                        <span key={acc.id} className={styles.badgeValid} style={{ marginRight: '6px' }}>
                          <Icon name="instagram" size={11} />
                          <span>@{acc.igUsername || 'account'}</span>
                        </span>
                      ))
                    )}
                  </td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <Link
                      href={`/admin/users?search=${encodeURIComponent(user.email || user.name || user.id)}`}
                      className="btn btn-secondary btn-sm"
                    >
                      {t.dashboard.recentSignups.inspect}
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
