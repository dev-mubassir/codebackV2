'use client';

/**
 * "N recent messages were not sorted" — above the inbox conversation list.
 *
 * WHY IT EXISTS. With billing on, an inbound DM the classification gate
 * refuses is stored and shown, but never read by the AI. That used to be
 * silent: sorting simply stopped, and a customer whose trial had not started
 * yet had no way to tell their leads were piling up unsorted. The count comes
 * from GET /api/billing/summary (unsortedMessages), so a message recovered
 * after a trial or plan starts drops out of it on the next load.
 *
 * HONEST ABOUT THE CAUSE. The "no active trial or plan" wording is used only
 * when a skip was actually RECORDED as not_entitled. Skips from before reasons
 * were stored get the neutral line, because their cause is not knowable. The
 * call to action appears only while the tenant is still without a live
 * entitlement — telling someone mid-trial to start a trial would be false.
 *
 * Mounted only when features.billing is on: with billing dark nothing is
 * gated, so nothing is ever skipped for these reasons.
 */

import Link from 'next/link';
import Icon from '@/app/components/Icon';
import useBillingSummary from './useBillingSummary';
import { inbox as t } from '@/content/copy';
import styles from './billing.module.css';

const LIVE_STATUSES = ['TRIALING', 'ACTIVE', 'GRACE'];

export default function UnsortedMessagesBanner({ className = '' }) {
  const { summary } = useBillingSummary();
  const unsorted = summary?.unsortedMessages;
  if (!unsorted || unsorted.count === 0) return null;

  const fromNoEntitlement = (unsorted.byReason?.not_entitled || 0) > 0;
  const entitledNow = LIVE_STATUSES.includes(summary.status);

  return (
    <div className={`${styles.banner} ${styles.bannerWarning} ${className}`} role="status">
      <span className={styles.bannerIcon}>
        <Icon name="alertTriangle" size={18} />
      </span>
      <div className={styles.bannerBody}>
        <div className={styles.bannerTitle}>{t.unsorted.title(unsorted.count)}</div>
        <div className={styles.bannerText}>{fromNoEntitlement ? t.unsorted.notEntitled : t.unsorted.other}</div>
        {fromNoEntitlement && !entitledNow && (
          <Link href="/billing" className={styles.bannerAction}>
            {t.unsorted.action}
          </Link>
        )}
      </div>
    </div>
  );
}
