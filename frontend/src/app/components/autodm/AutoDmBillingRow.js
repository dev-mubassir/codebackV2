'use client';

/**
 * The one Auto DM row on the billing page: this period's Auto DMs against the
 * plan's allowance (or "Unlimited*"). Renders nothing for a user without Auto
 * DM access — /api/autodm/usage answers 404 for them, so the billing page is
 * unchanged. Numbers come from the API only.
 */

import { useEffect, useState } from 'react';
import { getAutoDmUsage } from '@/lib/autodmApi';
import { usage as t } from './copy';
import styles from '@/app/components/billing/billing.module.css';

const n = (x) => Number(x || 0).toLocaleString('en-IN');

export default function AutoDmBillingRow() {
  const [u, setU] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getAutoDmUsage()
      .then((d) => { if (!cancelled) setU(d); })
      .catch(() => {}); // no access (404) or unavailable: no row
    return () => { cancelled = true; };
  }, []);

  if (!u) return null;
  const pct = u.displayUnlimited || !u.limit ? 0 : Math.min(100, Math.round((u.used / u.limit) * 100));
  const period = u.planCode === 'TRIAL' ? t.inTrial : t.thisMonth;
  const resets = new Date(u.periodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  return (
    <section className={styles.panel} aria-label={t.billingHeading}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{t.billingHeading}</h2>
        <a href="/autodm" className={styles.help}>{t.open}</a>
      </div>
      <div className={styles.metaItem}>
        <span className={styles.usageValue}>
          {u.displayUnlimited ? (
            <>{n(u.used)} {period} · <a href="/terms#fair-use">{t.unlimited}</a></>
          ) : (
            <>{n(u.used)} / {n(u.limit)} {period}</>
          )}
        </span>
        {!u.displayUnlimited && (
          <div className={`${styles.meter} ${styles.usageMeter}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t.label}>
            <div className={`${styles.meterFill} ${pct >= 100 ? styles.meterFillDanger : pct >= 80 ? styles.meterFillWarning : ''}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className={styles.help}>{t.billingHelp(resets)}</p>
      </div>
    </section>
  );
}
