'use client';

/**
 * The two states a tenant is in before paying for anything — each of which
 * used to render as an empty page.
 *
 *   NONE      No entitlement yet. The trial is granted on Instagram CONNECT,
 *             not at signup, and that is deliberate: trialConsumedAt on the
 *             Instagram identity is the only thing stopping trial farming,
 *             and a 3-day trial should not tick away while someone is still
 *             filling in their profile. So this state's whole job is to make
 *             connecting the obvious next step, with the value visible before
 *             anyone commits to it.
 *
 *   TRIALING  Days left, sorting used against the trial's limit, auto-replies
 *             left, and what happens at the end.
 *
 * Every number comes from GET /api/billing/summary — `summary.trial` is read
 * server-side from the TRIAL catalogue row. Nothing is typed in here, so
 * changing the trial is a catalogue update rather than a copy edit.
 *
 * THE TRIAL IS THE ONLY PLACE A SORTING LIMIT IS SHOWN. Paid plans never show
 * theirs (see UsageStrip). A trial's limit is part of what the trial is, and
 * hiding it would leave someone at the limit wondering why sorting stopped.
 */

import Icon from '@/app/components/Icon';
import { formatCount, formatDate } from '@/content/format';
import { billing } from '@/content/billingCopy';
import { LOW_CREDIT_PERCENT } from './BillingBanners';
import styles from './billing.module.css';

/** True for the two states this card owns. Pages use it to swap their paid-plan panels out. */
export function isTrialState(summary) {
  if (!summary) return false;
  if (summary.status === 'NONE') return true;
  return summary.status === 'TRIALING' && summary.plan?.code === 'TRIAL';
}

/** Share of `limit` used, clamped to 0–100. */
function usedPercent(used, limit) {
  if (!limit) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

function Meter({ percent, label }) {
  const tone = percent >= 100 ? styles.meterFillDanger : percent >= LOW_CREDIT_PERCENT ? styles.meterFillWarning : '';
  return (
    <div
      className={styles.meter}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={`${styles.meterFill} ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function NoEntitlement({ trial, connectHref, onConnect }) {
  const t = billing.trial;
  const title = t.noneTitle(trial?.days);

  return (
    <section className={styles.panel} aria-label={title}>
      <div className={styles.trialIntro}>
        <span className={styles.trialIcon}>
          <Icon name="instagram" size={22} />
        </span>
        <div>
          <h2 className={styles.trialTitle}>{title}</h2>
          <p className={styles.help}>{t.noneBody}</p>
        </div>
      </div>

      {/* Omitted rather than guessed if the catalogue has no TRIAL row. */}
      {trial && (
        <>
          <span className={styles.label}>{t.includesHeading}</span>
          <ul className={styles.trialIncludes}>
            {trial.days != null && (
              <li>
                <Icon name="clock" size={15} /> {t.includesDays(trial.days)}
              </li>
            )}
            {trial.classificationLimit != null && (
              <li>
                <Icon name="messageSquare" size={15} /> {t.includesClassified(formatCount(trial.classificationLimit))}
              </li>
            )}
            {trial.autoReplyCredits != null && (
              <li>
                <Icon name="zap" size={15} /> {t.includesAutoReplies(trial.autoReplyCredits)}
              </li>
            )}
          </ul>
        </>
      )}

      <div className={styles.planActions}>
        <a href={connectHref} onClick={onConnect} className="btn btn-primary">
          <Icon name="instagram" size={16} /> {t.connectButton}
        </a>
      </div>
    </section>
  );
}

function Trialing({ summary }) {
  const t = billing.trial;
  const { trial, daysRemaining, validUntil, credits, usage } = summary;
  const endDate = formatDate(validUntil);

  const sorted = usage.classificationsThisCycle;
  const sortLimit = trial?.classificationLimit ?? null;
  const sortingCapped = sortLimit != null && sorted >= sortLimit;

  // The pool is what is left plus what has been spent this cycle, computed by
  // the server — so a support credit or a manual top-up can never render as
  // "500 of 25".
  const repliesLeft = credits.remaining;
  const replyPool = credits.cyclePool;

  return (
    <section className={styles.panel} aria-label={t.activeTitle}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{t.activeTitle}</h2>
        {typeof daysRemaining === 'number' && (
          <span className="badge badge-info">{billing.plan.daysLeft(daysRemaining)}</span>
        )}
      </div>

      <div className={styles.trialStats}>
        <div className={styles.metaItem}>
          <span className={styles.label}>{t.endsLabel}</span>
          <span className={styles.metaValue}>{endDate}</span>
        </div>

        <div className={styles.metaItem}>
          <span className={styles.label}>{t.classifiedLabel}</span>
          <span className={styles.metaValue}>
            {sortLimit != null ? t.ofLimit(formatCount(sorted), formatCount(sortLimit)) : formatCount(sorted)}
          </span>
          {sortLimit != null && (
            <Meter
              percent={usedPercent(sorted, sortLimit)}
              label={t.ofLimit(formatCount(sorted), formatCount(sortLimit))}
            />
          )}
        </div>

        <div className={styles.metaItem}>
          <span className={styles.label}>{t.autoRepliesLabel}</span>
          <span className={styles.metaValue}>
            {replyPool > 0 ? t.ofLimit(formatCount(repliesLeft), formatCount(replyPool)) : formatCount(repliesLeft)}
          </span>
          {replyPool > 0 && (
            <Meter
              percent={usedPercent(replyPool - repliesLeft, replyPool)}
              label={t.ofLimit(formatCount(repliesLeft), formatCount(replyPool))}
            />
          )}
        </div>
      </div>

      {/* Sorting running out stops replies too (a reply needs a sorted
          message), so it is the one to state when both apply. */}
      {sortingCapped ? (
        <p className={styles.help}>{t.sortingLimitReached(formatCount(sortLimit))}</p>
      ) : replyPool > 0 && repliesLeft === 0 ? (
        <p className={styles.help}>{t.autoRepliesUsedUp}</p>
      ) : null}

      <div className={styles.renewalNote}>
        <span className={styles.renewalNoteIcon}>
          <Icon name="info" size={16} />
        </span>
        <span>
          <strong>{t.whenItEndsHeading}</strong> {t.whenItEnds(endDate)}
        </span>
      </div>
    </section>
  );
}

export default function TrialStateCard({ summary, connectHref, onConnect }) {
  if (!isTrialState(summary)) return null;
  if (summary.status === 'NONE') {
    return <NoEntitlement trial={summary.trial} connectHref={connectHref} onConnect={onConnect} />;
  }
  return <Trialing summary={summary} />;
}
