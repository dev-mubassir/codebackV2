'use client';

/**
 * The four states worth interrupting someone about, and nothing else.
 *
 * ALL OF THESE ARE IN-APP ONLY. The credit warnings in particular are never
 * emailed, and that is a deliberate product decision rather than an
 * oversight: email is a hard-capped channel (lib/email/quota.js reserves
 * capacity for account-critical mail), and the renewal sequence already owns
 * the mail a billing customer gets. "You have used 80% of your replies" is
 * useful the moment someone opens the app and worthless in an inbox three
 * days later, so it lives here.
 *
 * At most two banners ever render at once — one about TIME and one about
 * CREDITS. They are genuinely independent problems with different fixes
 * (renew vs top up), so collapsing them into one would give the wrong
 * button. Stacking all five would just be noise.
 *
 * Everything shown here is computed server-side (effectiveStatus,
 * daysRemaining, usedPercent) so a banner cannot disagree with the panel
 * below it.
 */

import Icon from '@/app/components/Icon';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';

/** The threshold the brief names. Crossing it is the last comfortable moment to top up. */
export const LOW_CREDIT_PERCENT = 80;
/** "3 days to expiry" — the first renewal nudge, matched to the Gate 7 DAY_27 email. */
export const EXPIRY_WARNING_DAYS = 3;

const LIVE_STATUSES = ['TRIALING', 'ACTIVE', 'GRACE'];

function Banner({ tone, icon, title, body, action }) {
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role="status">
      <span className={styles.bannerIcon}>
        <Icon name={icon} size={18} />
      </span>
      <div className={styles.bannerBody}>
        <div className={styles.bannerTitle}>{title}</div>
        <div className={styles.bannerText}>{body}</div>
      </div>
      {action && <div className={styles.bannerAction}>{action}</div>}
    </div>
  );
}

export default function BillingBanners({ summary, onRenew, onTopUp }) {
  if (!summary) return null;

  // No banners on a live trial. TrialStateCard already states the days and
  // replies left, and both banner actions assume a paid plan a trial does not
  // have: a trial is at most three days long, so the "expires in N days —
  // Renew now" banner would fire from the first minute, reading as a demand
  // for money on day one of something free.
  if (summary.status === 'TRIALING' && summary.plan?.code === 'TRIAL') return null;

  const { status, credits, daysRemaining, graceDaysRemaining } = summary;
  const banners = [];

  const renewAction = onRenew ? (
    <button type="button" className="btn btn-primary btn-sm" onClick={onRenew}>
      {billing.banners.renewButton}
    </button>
  ) : null;

  const topUpAction = onTopUp ? (
    <button type="button" className="btn btn-primary btn-sm" onClick={onTopUp}>
      {billing.banners.topUpButton}
    </button>
  ) : null;

  // ---- Time. Grace and expiry are the same conversation at different volumes.
  if (status === 'GRACE') {
    banners.push(
      <Banner
        key="grace"
        tone="bannerError"
        icon="alertTriangle"
        title={billing.banners.graceTitle}
        // The countdown replaces the generic sentence whenever the real
        // number of days is known — "you have 2 days" is the only part of
        // this banner that changes a decision.
        body={
          typeof graceDaysRemaining === 'number'
            ? billing.plan.graceDaysLeft(graceDaysRemaining)
            : billing.banners.graceBody
        }
        action={renewAction}
      />
    );
  } else if (status === 'EXPIRED') {
    banners.push(
      <Banner
        key="expired"
        tone="bannerError"
        icon="alertTriangle"
        title={billing.banners.expiredTitle}
        body={billing.banners.expiredBody}
        action={renewAction}
      />
    );
  } else if (
    ['ACTIVE', 'TRIALING'].includes(status) &&
    typeof daysRemaining === 'number' &&
    daysRemaining <= EXPIRY_WARNING_DAYS
  ) {
    banners.push(
      <Banner
        key="expiring"
        tone="bannerWarning"
        icon="clock"
        title={billing.banners.expiringTitle(daysRemaining)}
        body={billing.banners.expiringBody}
        action={renewAction}
      />
    );
  }

  // ---- Credits. Only meaningful while there is an entitlement to spend
  // against — an expired tenant's zero balance is already explained above,
  // and telling them twice helps nobody.
  if (LIVE_STATUSES.includes(status)) {
    if (credits.remaining === 0) {
      banners.push(
        <Banner
          key="credits-out"
          tone="bannerError"
          icon="zap"
          title={billing.banners.creditsOutTitle}
          body={billing.banners.creditsOutBody}
          action={topUpAction}
        />
      );
    } else if (credits.usedPercent >= LOW_CREDIT_PERCENT) {
      banners.push(
        <Banner
          key="credits-low"
          tone="bannerWarning"
          icon="zap"
          title={billing.banners.creditsLowTitle}
          body={billing.banners.creditsLowBody(credits.remaining)}
          action={topUpAction}
        />
      );
    }
  }

  if (banners.length === 0) return null;

  return <div className={styles.banners}>{banners}</div>;
}
