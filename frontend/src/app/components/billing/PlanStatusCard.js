'use client';

/**
 * Where a customer looks first: what am I on, how long have I got, and what
 * happens if I pay now.
 *
 * THE RENEWAL PROMISE IS THE POINT OF THIS CARD. Siffty has no auto-debit,
 * so every renewal is a deliberate act — and the single biggest reason
 * someone puts that act off is the fear that paying on day 18 throws away
 * the 12 days they already bought. It does not: entitlementService.grantPlan
 * anchors a warm renewal on the existing validUntil, never on today. That is
 * only worth anything if the customer can SEE it, so this card states the
 * exact date they will end up with, before they pay.
 *
 * Both dates come from the server (summary.renewal), computed with
 * grantPlan's own branch. The browser deliberately does not do this
 * arithmetic: a date computed here could drift from the one the grant
 * actually produces, and a promise that turns out to be off by a day is
 * worse than no promise.
 */

import Icon from '@/app/components/Icon';
import { formatDate } from '@/content/format';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';

/** effectiveStatus -> the globals.css badge class that reads right for it. */
const STATUS_BADGE = {
  NONE: 'badge-default',
  TRIALING: 'badge-info',
  ACTIVE: 'badge-success',
  GRACE: 'badge-warning',
  EXPIRED: 'badge-error',
};

export default function PlanStatusCard({ summary, onRenew }) {
  const { plan, status, validUntil, daysRemaining, renewal, extraIgAccounts, currency } = summary;

  // The date this plan's renewal would land on. Falls back to the Starter
  // preview for a tenant with no plan yet, so the promise is visible before
  // the first purchase too.
  const previewCode = plan?.purchasable ? plan.code : 'STARTER';
  const previewDate = renewal?.validUntilByPlan?.[previewCode];

  return (
    <section className={styles.panel} aria-label={billing.plan.heading}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{billing.plan.heading}</h2>
        <span className={`badge ${STATUS_BADGE[status] || 'badge-default'}`}>
          {billing.status[status] || status}
        </span>
      </div>

      {plan ? (
        <>
          <div className={styles.planTop}>
            <span className={styles.planName}>{plan.name}</span>
          </div>

          <div className={styles.planMetaRow}>
            <div className={styles.metaItem}>
              <span className={styles.label}>
                {status === 'GRACE' || status === 'EXPIRED' ? billing.plan.expiresLabel : billing.plan.renewedUntilLabel}
              </span>
              <span className={styles.metaValue}>{formatDate(validUntil)}</span>
            </div>

            {typeof daysRemaining === 'number' && daysRemaining > 0 && (
              <div className={styles.metaItem}>
                <span className={styles.label}>{billing.plan.timeLeftLabel}</span>
                <span className={styles.metaValue}>{billing.plan.daysLeft(daysRemaining)}</span>
              </div>
            )}

            {plan.igAccountLimit != null && (
              <div className={styles.metaItem}>
                <span className={styles.label}>{billing.plan.instagramLabel}</span>
                <span className={styles.metaValue}>
                  {billing.plan.igAccountsIncluded(plan.igAccountLimit + extraIgAccounts)}
                </span>
              </div>
            )}

            {/* Shown only once the region lock has actually been set from a
                real payment — before that there is no billing currency of
                record to state, and guessing one would misrepresent it. */}
            {currency && (
              <div className={styles.metaItem}>
                <span className={styles.label}>{billing.plan.currencyLabel}</span>
                <span className={styles.metaValue}>{billing.plan.regionLocked(currency)}</span>
              </div>
            )}
          </div>

          {extraIgAccounts > 0 && <p className={styles.help}>{billing.plan.extraAccounts(extraIgAccounts)}</p>}
        </>
      ) : (
        <>
          <div className={styles.planTop}>
            <span className={styles.planName}>{billing.plan.noPlanTitle}</span>
          </div>
          <p className={styles.help}>{billing.plan.noPlanBody}</p>
        </>
      )}

      {previewDate && (
        <div className={styles.renewalNote}>
          <span className={styles.renewalNoteIcon}>
            <Icon name="info" size={16} />
          </span>
          <span>
            {renewal.extendsFromValidUntil
              ? billing.renewal.keepsYourDays(formatDate(renewal.anchor), formatDate(previewDate))
              : billing.renewal.coldStart(formatDate(previewDate))}
          </span>
        </div>
      )}

      {onRenew && (
        <div className={styles.planActions}>
          <button type="button" className="btn btn-primary" onClick={() => onRenew(previewCode)}>
            {plan?.purchasable ? billing.renewal.renewButton : billing.renewal.buyButton}
          </button>
        </div>
      )}
    </section>
  );
}
