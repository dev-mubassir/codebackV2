'use client';

/**
 * Reply credits, split the way they are actually spent.
 *
 * The split is not decoration. entitlementService.spendReplyCredit drains
 * BANKED first and only then this cycle's grant (FIFO — oldest credits go
 * first), and the bank is what survives a renewal, capped at the plan's bank
 * cap. A customer looking at one merged number cannot tell which part of
 * their balance is about to roll over and which part is at risk, so the two
 * are shown separately with the rollover rule stated next to them.
 *
 * The meter reads "% used THIS CYCLE", and its denominator is the pool the
 * cycle actually had (what is left plus what has been spent), computed
 * server-side. That is why buying a pack visibly moves the bar back down
 * instead of leaving a stuck 90% that no purchase can clear.
 */

import { formatCount } from '@/content/format';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';
import { LOW_CREDIT_PERCENT } from './BillingBanners';

/** The bar turns amber at the same threshold that raises the banner, and red at empty. */
function meterToneClass(usedPercent, remaining) {
  if (remaining === 0) return styles.meterFillDanger;
  if (usedPercent >= LOW_CREDIT_PERCENT) return styles.meterFillWarning;
  return '';
}

export default function CreditsCard({ summary }) {
  const { credits } = summary;
  const isEmpty = credits.remaining === 0;

  return (
    <section className={styles.panel} aria-label={billing.credits.heading}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{billing.credits.heading}</h2>
      </div>

      <div className={styles.creditsHero}>
        <span className={`${styles.creditsBig} ${isEmpty ? styles.creditsBigEmpty : ''}`}>
          {formatCount(credits.remaining)}
        </span>
        <span className={styles.creditsUnit}>{isEmpty ? billing.credits.empty : billing.credits.remaining}</span>
      </div>

      <div
        className={styles.meter}
        role="progressbar"
        aria-valuenow={credits.usedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={billing.credits.usedThisCycle(credits.usedPercent)}
      >
        <div
          className={`${styles.meterFill} ${meterToneClass(credits.usedPercent, credits.remaining)}`}
          // Clamped: a pool that shrank mid-cycle (a plan change, a manual
          // adjustment) could in principle produce more than 100%, and a bar
          // overflowing its track looks like a rendering bug rather than data.
          style={{ width: `${Math.min(100, Math.max(0, credits.usedPercent))}%` }}
        />
      </div>
      <p className={styles.help}>{billing.credits.usedThisCycle(credits.usedPercent)}</p>

      <div style={{ marginTop: 12 }}>
        <div className={styles.splitRow}>
          <span>{billing.credits.current}</span>
          <span className={styles.splitValue}>{formatCount(credits.current)}</span>
        </div>
        <div className={styles.splitRow}>
          <span>{billing.credits.banked}</span>
          <span className={styles.splitValue}>{formatCount(credits.banked)}</span>
        </div>
      </div>

      <p className={styles.help} style={{ marginTop: 10 }}>
        {billing.credits.bankedHelp}
      </p>
    </section>
  );
}
