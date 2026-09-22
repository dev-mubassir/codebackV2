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
 *
 * ONE EXCEPTION: a TRIAL. Its limit is part of what the trial is — the offer
 * names it before anyone connects — and a trialing tenant who reaches it needs
 * to see why sorting stopped. The server sends it only for a live trial
 * (summary.trial), never for Starter or Pro.
 */

import Icon from '@/app/components/Icon';
import { formatCount, formatDate } from '@/content/format';
import { LOW_CREDIT_PERCENT } from './BillingBanners';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';

export default function UsageStrip({ summary }) {
  const { usage, cycleStartedAt, plan, trial } = summary;
  const used = usage.classificationsThisCycle;
  const limit = plan?.code === 'TRIAL' ? (trial?.classificationLimit ?? null) : null;
  const percent = limit ? Math.min(100, Math.max(0, Math.round((used / limit) * 100))) : 0;
  const tone = percent >= 100 ? styles.meterFillDanger : percent >= LOW_CREDIT_PERCENT ? styles.meterFillWarning : '';

  return (
    <section className={styles.panel} aria-label={billing.usage.heading}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.panelIcon}>
            <Icon name="barChart" size={18} />
          </span>
          <h2 className={styles.panelTitle}>{billing.usage.heading}</h2>
        </div>
      </div>

      <div className={styles.usageStrip}>
        <div className={styles.usageTile}>
          <div className={styles.usageTileHeader}>
            <Icon name="target" size={14} />
            <span className={styles.label}>{billing.usage.classified}</span>
          </div>
          <span className={styles.usageValue}>
            {limit != null ? billing.usage.ofLimit(formatCount(used), formatCount(limit)) : formatCount(used)}
          </span>
          {limit != null && (
            <div
              className={`${styles.meter} ${styles.usageMeter}`}
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={billing.usage.ofLimit(formatCount(used), formatCount(limit))}
            >
              <div className={`${styles.meterFill} ${tone}`} style={{ width: `${percent}%` }} />
            </div>
          )}
          <p className={styles.help}>{billing.usage.classifiedHelp}</p>
        </div>

        <div className={styles.usageTile}>
          <div className={styles.usageTileHeader}>
            <Icon name="messageSquare" size={14} />
            <span className={styles.label}>{billing.usage.autoReplies}</span>
          </div>
          <span className={styles.usageValue}>{formatCount(usage.autoRepliesThisCycle)}</span>
          <p className={styles.help}>{billing.credits.spentThisCycle(usage.autoRepliesThisCycle)}</p>
        </div>

        {cycleStartedAt && (
          <div className={styles.usageTile}>
            <div className={styles.usageTileHeader}>
              <Icon name="clock" size={14} />
              <span className={styles.label}>{billing.usage.cycleStarted}</span>
            </div>
            <span className={styles.usageValue} style={{ fontSize: '18px' }}>{formatDate(cycleStartedAt)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
