'use client';

/**
 * Admin overview — alerts, headline counts, message processing, backlog and
 * recent sign-ups.
 *
 * Data layer is master's: one GET /api/admin/stats, rendered as it arrives.
 * Changed: ~20 inline styles became classes, the three "red when above zero"
 * inline ternaries became one `.valueDanger` class with the same condition,
 * and the loading spinner is the shared skeleton.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAdminStats } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { Badge, Skeleton, srOnly } from '@/app/components/ui';
import { admin as t, common, errors } from '@/content/copy';
import { alertLevelLabel } from '@/content/labels';
import { formatCount, formatDate } from '@/content/format';
import styles from './admin.module.css';

/** Adds the danger colour to a count only when it is actually above zero. */
const dangerIf = (n) => ((n || 0) > 0 ? styles.valueDanger : '');

export default function AdminDashboardHome() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadStats() {
      try {
        setStats(await getAdminStats());
      } catch {
        setError(errors.admin.stats);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  if (loading) return <div className={styles.loading}><Skeleton lines={5} height={48} /></div>;

  if (error) {
    return (
      <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
        <span className={styles.noticeText}>{error}</span>
      </div>
    );
  }

  const ai = stats?.aiStats || {};

  return (
    <div className={styles.stack}>
      {stats?.alerts?.length > 0 && stats.alerts.map((alert, idx) => (
        <div key={idx} className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
          <div className={styles.noticeBody}>
            <span className={styles.noticeTitle}>{alertLevelLabel(alert.level).label} — {alert.title}: </span>
            <span className={styles.noticeText}>{alert.message}</span>
          </div>
          {/* Both levels route to the accounts view; /admin/logs has no page
              and would 404. */}
          <Link href="/admin/accounts" className={styles.linkBtn}>
            {t.dashboard.investigate}
            <Icon name="arrowRight" size={13} />
          </Link>
        </div>
      ))}

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.metrics.users.label}</span>
          <span className={styles.metricValue}>{formatCount(stats?.totalUsers)}</span>
          <span className={styles.metricHint}>{t.dashboard.metrics.users.hint}</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.metrics.accounts.label}</span>
          <span className={styles.metricValue}>{formatCount(stats?.totalAccounts)}</span>
          <span className={styles.metricHint}>
            {formatCount(stats?.activeAccounts)} active, {formatCount(stats?.expiredAccounts)} need reconnecting
          </span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.metrics.messages.label}</span>
          <span className={styles.metricValue}>{formatCount(stats?.messagesToday)}</span>
          <span className={styles.metricHint}>{formatCount(stats?.messagesThisWeek)} in the last 7 days</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>{t.dashboard.metrics.failedWebhooks.label}</span>
          <span className={`${styles.metricValue} ${dangerIf(stats?.failedWebhooks24h)}`}>
            {formatCount(stats?.failedWebhooks24h)}
          </span>
          <span className={styles.metricHint}>{t.dashboard.metrics.failedWebhooks.hint}</span>
        </div>
      </div>

      {/* Message processing. These three counters live in the API process's
          memory, so they reset to zero on every restart and count only the
          process serving this request. The subtitle says so — without it the
          numbers look like all-time totals and lead to wrong conclusions. */}
      <section className={styles.panel}>
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
            <span className={styles.statTileLabel}>{t.dashboard.processing.keywordMatches.label}</span>
            <span className={styles.statTileValue}>{formatCount(ai.keywordMatches)}</span>
            <span className={styles.statTileHint}>{t.dashboard.processing.keywordMatches.hint}</span>
          </div>
          <div className={styles.statTile}>
            <span className={styles.statTileLabel}>{t.dashboard.processing.totalCalls.label}</span>
            <span className={styles.statTileValue}>{formatCount(ai.totalCalls)}</span>
            <span className={styles.statTileHint}>
              {formatCount(ai.aiSuccess)} {t.dashboard.processing.totalCalls.hint}
            </span>
          </div>
          <div className={styles.statTile}>
            <span className={styles.statTileLabel}>{t.dashboard.processing.failures.label}</span>
            <span className={`${styles.statTileValue} ${dangerIf(ai.aiFailures)}`}>{formatCount(ai.aiFailures)}</span>
            <span className={styles.statTileHint}>{t.dashboard.processing.failures.hint}</span>
          </div>
        </div>
      </section>

      {/* Backlog. The stats endpoint already returned these three, and nothing
          rendered them — they are the numbers that actually tell an operator
          whether anything is stuck. */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{t.dashboard.backlog.title}</h2>
            <p className={styles.panelSubtitle}>{t.dashboard.backlog.subtitle}</p>
          </div>
        </div>
        <div className={styles.statStrip}>
          <div className={styles.statTile}>
            <span className={styles.statTileLabel}>{t.dashboard.backlog.pending.label}</span>
            <span className={styles.statTileValue}>{formatCount(stats?.pendingAiMessages)}</span>
            <span className={styles.statTileHint}>{t.dashboard.backlog.pending.hint}</span>
          </div>
          <div className={styles.statTile}>
            <span className={styles.statTileLabel}>{t.dashboard.backlog.failed.label}</span>
            <span className={`${styles.statTileValue} ${dangerIf(stats?.failedAiMessages)}`}>
              {formatCount(stats?.failedAiMessages)}
            </span>
            <span className={styles.statTileHint}>{t.dashboard.backlog.failed.hint}</span>
          </div>
          <div className={styles.statTile}>
            <span className={styles.statTileLabel}>{t.dashboard.backlog.queueMode.label}</span>
            <span className={`${styles.statTileValue} ${styles.statTileValueText}`}>
              {stats?.queueMode || common.unknown}
            </span>
            <span className={styles.statTileHint}>{t.dashboard.backlog.queueMode.hint}</span>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{t.dashboard.recentSignups.title}</h2>
          <Link href="/admin/users" className={styles.linkBtn}>
            {t.dashboard.recentSignups.viewAll}
            <Icon name="arrowRight" size={13} />
          </Link>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t.dashboard.recentSignups.columns.user}</th>
                <th>{t.dashboard.recentSignups.columns.accounts}</th>
                <th>{t.dashboard.recentSignups.columns.joined}</th>
                <th className={styles.alignRight}>
                  <span className={srOnly}>{t.dashboard.recentSignups.inspect}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!stats?.recentSignups?.length ? (
                <tr><td colSpan="4" className={styles.cellEmpty}>{t.dashboard.recentSignups.empty}</td></tr>
              ) : stats.recentSignups.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className={styles.cellPrimary}>{user.name || t.users.unnamed}</div>
                    <div className={styles.cellSub}>{user.email || t.users.noEmail}</div>
                  </td>
                  <td>
                    {user.instagramAccounts?.length === 0 ? (
                      <span className={styles.cellMuted}>{t.users.noAccounts}</span>
                    ) : (
                      <div className={styles.badgeRow}>
                        {user.instagramAccounts.map((acc) => (
                          <Badge key={acc.id} tone="neutral">@{acc.igUsername || 'account'}</Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td className={styles.alignRight}>
                    <Link
                      href={`/admin/users?search=${encodeURIComponent(user.email || user.name || user.id)}`}
                      className={styles.linkBtn}
                    >
                      {t.dashboard.recentSignups.inspect}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
