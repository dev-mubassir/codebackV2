'use client';

/**
 * The plan at a glance, for /settings.
 *
 * READS GET /api/billing/summary THROUGH useBillingSummary — the same hook the
 * billing page uses, and nothing else. Settings deliberately owns no
 * entitlement logic: the status is the server's effectiveStatus, the days are
 * the server's daysRemaining, the credits are the server's split. Deriving any
 * of that here would be a second source of truth for "is this account paid
 * up", and the first time the two disagreed a customer would read one answer
 * on /settings and another on /billing.
 *
 * A tenant with no trial and no plan gets the same explaining card as the
 * billing page and dashboard (lib/trialState decides), never "No plan yet".
 *
 * The caller mounts this only when features.billing is on, so pre-launch
 * settings makes no billing request at all.
 */

import { useState } from 'react';
import Link from 'next/link';
import useBillingSummary from './useBillingSummary';
import TrialStateCard from './TrialStateCard';
import { STATUS_BADGE, NoSubscriptionNote } from './PlanStatusCard';
import { trialCardState, replacesPlanPanels } from '@/lib/trialState';
import { getInstagramAuthUrl, setRenewalNudgeEmails } from '@/lib/api';
import { formatCount } from '@/content/format';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';

/**
 * The one real control over renewals: the two early reminder emails. Optimistic,
 * and rolled back if the save fails, so the box never shows a state the server
 * does not hold.
 */
function RenewalReminderToggle({ initial }) {
  const t = billing.settingsPanel.reminders;
  const [on, setOn] = useState(initial !== false);
  const [state, setState] = useState('idle'); // idle | saving | failed

  async function onChange(event) {
    const next = event.target.checked;
    setOn(next);
    setState('saving');
    try {
      const saved = await setRenewalNudgeEmails(next);
      setOn(saved.nudgeEmails);
      setState('idle');
    } catch {
      setOn(!next);
      setState('failed');
    }
  }

  return (
    <div className={styles.gapTop}>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={on} onChange={onChange} disabled={state === 'saving'} />
        <span>{t.label}</span>
      </label>
      <p className={styles.help}>{t.help}</p>
      {state === 'failed' && (
        <p className={styles.help} role="alert">
          {t.failed}
        </p>
      )}
    </div>
  );
}

function Item({ label, children }) {
  return (
    <div className={styles.metaItem}>
      <span className={styles.label}>{label}</span>
      <span className={styles.metaValue}>{children}</span>
    </div>
  );
}

export default function PlanSummaryPanel() {
  const { summary, error, reload } = useBillingSummary();

  // Nothing while loading or on failure. This panel is a convenience on a page
  // that has its own job; a spinner or an error box here would compete with
  // the settings form. /billing carries the full state and the retry.
  if (error || !summary) return null;

  return <PlanSummaryPanelView summary={summary} onClaimed={reload} />;
}

/** The panel itself, for a given summary — split from the fetch so it renders identically for any summary handed to it. */
export function PlanSummaryPanelView({ summary, onClaimed }) {
  const state = trialCardState(summary);
  if (replacesPlanPanels(state)) {
    return (
      <TrialStateCard
        summary={summary}
        state={state}
        connectHref={getInstagramAuthUrl()}
        plansHref="/billing#plans"
        onClaimed={onClaimed}
      />
    );
  }

  const t = billing.settingsPanel;
  const { plan, status, daysRemaining, credits, usage, trial } = summary;
  const sorted = formatCount(usage.classificationsThisCycle);
  // A limit is only ever shown for a trial — see UsageStrip.
  const sortLimit = plan?.code === 'TRIAL' ? trial?.classificationLimit : null;

  return (
    <section className={styles.panel} aria-label={t.heading}>
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.panelTitle}>{t.heading}</h2>
          <p className={styles.help}>{t.description}</p>
        </div>
        <Link href="/billing" className={styles.btnSecondarySm}>
          {t.manageLink}
        </Link>
      </div>

      <div className={styles.planMetaRow}>
        <Item label={t.planLabel}>{plan?.name || t.noValue}</Item>
        <Item label={t.statusLabel}>
          <span className={`badge ${STATUS_BADGE[status] || 'badge-default'}`}>{billing.status[status] || status}</span>
        </Item>
        <Item label={t.timeLeftLabel}>{daysRemaining > 0 ? billing.plan.daysLeft(daysRemaining) : t.noValue}</Item>
        <Item label={t.currentLabel}>{formatCount(credits.current)}</Item>
        <Item label={t.bankedLabel}>{formatCount(credits.banked)}</Item>
        <Item label={t.classifiedLabel}>
          {sortLimit != null ? billing.usage.ofLimit(sorted, formatCount(sortLimit)) : sorted}
        </Item>
      </div>

      <NoSubscriptionNote summary={summary} className={styles.help} />
      {plan && plan.code !== 'TRIAL' && <RenewalReminderToggle initial={summary.reminders?.nudgeEmails} />}
    </section>
  );
}
