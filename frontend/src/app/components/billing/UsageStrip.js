'use client';

/**
 * What this cycle has actually consumed.
 *
 * NOTE WHAT IS NOT HERE: there is no "X of Y" anywhere in this component,
 * and there must not be. Classification has a per-cycle cap and an hourly
 * throttle, both enforced in entitlementService, but both are an INTERNAL
 * burst guard — the schema says so at Plan.classificationCapCycle, and
 * GET /api/billing/summary deliberately does not send either number. Showing
 * a ceiling would turn an anti-abuse limit into an advertised product
 * feature, and then into a support conversation about why it is not higher.
 *
 * So: the customer's own usage, stated plainly, with no denominator.
 */

import { formatCount, formatDate } from '@/content/format';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';

export default function UsageStrip({ summary }) {
  const { usage, cycleStartedAt } = summary;

  return (
    <section className={styles.panel} aria-label={billing.usage.heading}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{billing.usage.heading}</h2>
      </div>

      <div className={styles.usageStrip}>
        <div className={styles.metaItem}>
          <span className={styles.label}>{billing.usage.classified}</span>
          <span className={styles.usageValue}>{formatCount(usage.classificationsThisCycle)}</span>
          <p className={styles.help}>{billing.usage.classifiedHelp}</p>
        </div>

        <div className={styles.metaItem}>
          <span className={styles.label}>{billing.usage.autoReplies}</span>
          <span className={styles.usageValue}>{formatCount(usage.autoRepliesThisCycle)}</span>
          <p className={styles.help}>{billing.credits.spentThisCycle(usage.autoRepliesThisCycle)}</p>
        </div>

        {cycleStartedAt && (
          <div className={styles.metaItem}>
            <span className={styles.label}>{billing.usage.cycleStarted}</span>
            <span className={styles.usageValue}>{formatDate(cycleStartedAt)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
