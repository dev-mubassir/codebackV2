'use client';

/**
 * Every way a tenant can be without a trial or a plan — each one explained.
 *
 * The trial is granted on Instagram CONNECT, not at signup, and only once per
 * Instagram account: trialConsumedAt on the identity ledger survives account
 * deletion, which is the only thing that stops "delete and sign up again" from
 * being an unlimited trial. That rule is correct, and it used to be invisible.
 * A connect that granted nothing left the page at "No plan yet", with no way
 * to tell a spent trial from an unconfirmed email from a bug.
 *
 * So each state gets its own card, chosen by lib/trialState from the reason
 * the server derives (summary.trialStatus):
 *
 *   TRIAL_NOT_STARTED       what connecting gets you, with the condition stated
 *   TRIAL_GRANTED           confirmation, straight after the connect that granted it
 *   TRIAL_ALREADY_CONSUMED  this account has had its trial — here are the plans
 *   EMAIL_UNVERIFIED        confirm your email first, with a resend button
 *   TRIAL_CLAIMABLE         connected and eligible, never started — "Start my trial"
 *                           (POST /api/billing/trial/claim; no disconnect needed)
 *   ACCOUNT_BLOCKED         this Instagram account cannot have a trial — contact support, or see plans
 *
 * lib/trialState chooses on TWO axes — entitlement and Instagram connected — so a
 * connected user is never shown the connect card.
 *
 * Every number comes from summary.trial (the TRIAL catalogue row).
 */

import { useState } from 'react';
import Link from 'next/link';
import Icon from '@/app/components/Icon';
import { formatCount, formatDate } from '@/content/format';
import { billing } from '@/content/billingCopy';
import { claimTrial, resendVerification } from '@/lib/api';
import { SUPPORT_EMAIL } from '@/content/contact';
import { TRIAL_CARD } from '@/lib/trialState';
import styles from './billing.module.css';

function Shell({ icon, title, children }) {
  return (
    <section className={styles.panel} aria-label={title}>
      <div className={styles.trialIntro}>
        <span className={styles.trialIcon}>
          <Icon name={icon} size={22} />
        </span>
        <div>
          <h2 className={styles.trialTitle}>{title}</h2>
          {children}
        </div>
      </div>
    </section>
  );
}

/** What the trial includes. Omitted rather than guessed if the catalogue has no TRIAL row. */
function Includes({ trial }) {
  const t = billing.trial;
  if (!trial) return null;
  return (
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
  );
}

function NotStarted({ trial, connectHref, onConnect }) {
  const t = billing.trial;
  return (
    <Shell icon="instagram" title={t.noneTitle(trial?.days)}>
      <p className={styles.help}>{t.noneBody}</p>
      <div style={{ marginTop: 16 }}>
        <Includes trial={trial} />
      </div>
      <div className={styles.planActions}>
        <a href={connectHref} onClick={onConnect} className="btn btn-primary">
          <Icon name="instagram" size={16} /> {t.connectButton}
        </a>
      </div>
    </Shell>
  );
}

function Granted({ summary, usageHref }) {
  const t = billing.trial;
  const { trial, validUntil } = summary;
  return (
    <Shell icon="check" title={t.grantedTitle(trial?.days)}>
      <p className={styles.help}>{t.grantedBody(formatDate(validUntil))}</p>
      <div style={{ marginTop: 16 }}>
        <Includes trial={trial} />
      </div>
      {usageHref && (
        <div className={styles.planActions}>
          <Link href={usageHref} className="btn btn-secondary">
            {t.grantedAction}
          </Link>
        </div>
      )}
    </Shell>
  );
}

function AlreadyConsumed({ plansHref }) {
  const t = billing.trial;
  return (
    <Shell icon="info" title={t.consumedTitle}>
      <p className={styles.help}>{t.consumedBody}</p>
      <div className={styles.planActions}>
        <Link href={plansHref} className="btn btn-primary">
          {t.plansButton}
        </Link>
      </div>
    </Shell>
  );
}

function Claimable({ trial, onClaimed }) {
  const t = billing.trial;
  const [state, setState] = useState('idle'); // idle | claiming | failed
  const [failure, setFailure] = useState('');

  async function claim() {
    setState('claiming');
    setFailure('');
    try {
      // Granted — or ALREADY_ENTITLED from a double click. Either way the
      // summary now holds the trial, and reloading it swaps this card out.
      const result = await claimTrial();
      if (onClaimed) await onClaimed(result.trialOutcome);
    } catch (err) {
      const outcome = err.response?.data?.trialOutcome;
      setState('failed');
      setFailure(t.claimRefused[outcome] || err.response?.data?.error || t.claimFailed);
      // A refusal means the state changed under us; reload into the card that explains it.
      if (outcome && onClaimed) onClaimed(outcome);
    }
  }

  return (
    <Shell icon="zap" title={t.claimableTitle(trial?.days)}>
      <p className={styles.help}>{t.claimableBody}</p>
      <div style={{ marginTop: 16 }}>
        <Includes trial={trial} />
      </div>
      <div className={styles.planActions}>
        <button type="button" className="btn btn-primary" onClick={claim} disabled={state === 'claiming'}>
          {state === 'claiming' ? t.claiming : t.claimButton}
        </button>
      </div>
      {state === 'failed' && (
        <p className={styles.help} role="alert">
          {failure}
        </p>
      )}
    </Shell>
  );
}

function Blocked({ plansHref }) {
  const t = billing.trial;
  return (
    <Shell icon="alertTriangle" title={t.blockedTitle}>
      <p className={styles.help}>{t.blockedBody}</p>
      <div className={styles.planActions}>
        <Link href="/contact" className="btn btn-secondary">
          {t.blockedContact(SUPPORT_EMAIL)}
        </Link>
        <Link href={plansHref} className="btn btn-primary">
          {t.plansButton}
        </Link>
      </div>
    </Shell>
  );
}

function EmailUnverified({ connected }) {
  const t = billing.trial;
  const [state, setState] = useState('idle'); // idle | sending | sent | failed
  const [failure, setFailure] = useState('');

  async function resend() {
    setState('sending');
    setFailure('');
    try {
      await resendVerification();
      setState('sent');
    } catch (err) {
      // While the sending domain is unverified this is a 503. Say so honestly:
      // claiming success would leave someone waiting for mail that never left.
      setState('failed');
      setFailure(err.response?.data?.error || t.resendFailed);
    }
  }

  return (
    <Shell icon="alertTriangle" title={t.unverifiedTitle}>
      <p className={styles.help}>{connected ? t.unverifiedBodyConnected : t.unverifiedBody}</p>
      <div className={styles.planActions}>
        {state === 'sent' ? (
          <p className={styles.help} role="status">
            {t.resent}
          </p>
        ) : (
          <button type="button" className="btn btn-primary" onClick={resend} disabled={state === 'sending'}>
            {state === 'sending' ? t.resending : t.resendButton}
          </button>
        )}
      </div>
      {state === 'failed' && (
        <p className={styles.help} role="alert">
          {failure}
        </p>
      )}
    </Shell>
  );
}

export default function TrialStateCard({
  summary,
  state,
  connectHref,
  onConnect,
  plansHref = '/billing#plans',
  usageHref = null,
  onClaimed = null,
}) {
  if (!summary) return null;
  switch (state) {
    case TRIAL_CARD.CLAIMABLE:
      return <Claimable trial={summary.trial} onClaimed={onClaimed} />;
    case TRIAL_CARD.NOT_STARTED:
      return <NotStarted trial={summary.trial} connectHref={connectHref} onConnect={onConnect} />;
    case TRIAL_CARD.GRANTED:
      return <Granted summary={summary} usageHref={usageHref} />;
    case TRIAL_CARD.ALREADY_CONSUMED:
      return <AlreadyConsumed plansHref={plansHref} />;
    case TRIAL_CARD.BLOCKED:
      return <Blocked plansHref={plansHref} />;
    case TRIAL_CARD.EMAIL_UNVERIFIED:
      return <EmailUnverified connected={summary.instagramConnected === true} />;
    default:
      return null;
  }
}
