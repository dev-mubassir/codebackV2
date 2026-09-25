'use client';

/**
 * Admin — business metrics (Gate 7). Counts only: signups, DMs received and
 * classified per day, active customers, trial-to-paid, connected accounts.
 * No message content is ever fetched.
 */

import { useEffect, useState } from 'react';
import { getAdminMetrics } from '@/lib/api';
import { Select, Skeleton } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import styles from '../admin.module.css';

const m = t.metricsPage;
const RANGES = [7, 30, 90, 365];

function sum(rows) {
  return rows.reduce((a, r) => a + r.count, 0);
}

export default function AdminMetricsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getAdminMetrics(days)
      .then((d) => { if (!cancelled) { setData(d); setError(''); } })
      .catch(() => { if (!cancelled) setError(errors.admin.settings); });
    return () => { cancelled = true; };
  }, [days]);

  if (!data && !error) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;
  if (error) return <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{error}</span></div>;

  // One row per day that had any activity, newest first.
  const byDay = new Map();
  for (const [key, rows] of [['signups', data.signupsPerDay], ['dms', data.dmsPerDay], ['classified', data.classifiedPerDay]]) {
    for (const r of rows) byDay.set(r.day, { ...(byDay.get(r.day) || {}), [key]: r.count });
  }
  const days_ = [...byDay.keys()].sort().reverse();

  const tiles = [
    [m.signups, sum(data.signupsPerDay)],
    [m.dms, sum(data.dmsPerDay)],
    [m.classified, sum(data.classifiedPerDay)],
    [m.active24h, data.activeUsers.last24h],
    [m.active7d, data.activeUsers.last7d],
    [m.active30d, data.activeUsers.last30d],
    [m.igAccounts, data.activeInstagramAccounts],
    [m.trialToPaid, `${(data.trialToPaid.rate * 100).toFixed(1)}%`, m.trialToPaidHint(data.trialToPaid.converted, data.trialToPaid.trials)],
  ];

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Select label={m.range} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {RANGES.map((n) => <option key={n} value={n}>{m.days(n)}</option>)}
        </Select>
      </div>

      <div className={styles.statStrip}>
        {tiles.map(([label, value, hint]) => (
          <div key={label} className={styles.statTile}>
            <span className={styles.statTileLabel}>{label}</span>
            <span className={styles.statTileValue}>{value}</span>
            {hint && <span className={styles.statTileHint}>{hint}</span>}
          </div>
        ))}
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{m.perDay}</h2></div>
        {days_.length === 0 ? (
          <p className={styles.cellEmpty}>{m.empty}</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.tableCompact}`}>
              <thead><tr><th>{m.day}</th><th>{m.signups}</th><th>{m.dms}</th><th>{m.classified}</th></tr></thead>
              <tbody>
                {days_.map((d) => {
                  const row = byDay.get(d);
                  return (
                    <tr key={d}>
                      <td className={styles.cellMono}>{d}</td>
                      <td>{row.signups || 0}</td>
                      <td>{row.dms || 0}</td>
                      <td>{row.classified || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
