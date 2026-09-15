'use client';

/**
 * The upgrade conversion point.
 *
 * WHEN IT FIRES: for any Starter tenant, whenever the arithmetic supports
 * something worth saying.
 *
 * It used to fire on the tenant's FIRST add-on payment, on the theory that
 * buying a top-up is the strongest available signal that the plan underneath
 * is too small. The signal reading was right; the claim attached to it was
 * not. At the prices then seeded, Starter plus one pack cost LESS than Pro,
 * so "you would save X" was arithmetically false exactly when it fired.
 *
 * The trigger is now the truth test itself — proUpgradeVerdict() in
 * lib/pricing.js prices both sides from plan_prices at render time and
 * returns which of two things may be said:
 *
 *   'saving'     Pro is strictly cheaper AND no worse on replies or
 *                accounts. Savings language permitted, with their number.
 *   'comparison' It is not cheaper for this tenant. Show the factual Pro
 *                line — what it includes, what it costs — and NO savings
 *                language of any kind.
 *
 * That distinction is the whole point of this component. A comparison is an
 * honest pitch; a saving that is not real is a false claim about money, on
 * the page where the customer is deciding whether to trust us with a card.
 *
 * Nothing here knows a price or does currency arithmetic. Every amount comes
 * from the shared module, which the marketing page also uses, so the two
 * surfaces cannot quote different figures for the same plans.
 */

import Icon from '@/app/components/Icon';
import { proUpgradeVerdict } from '@/lib/pricing';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';

export default function ProUpgradeCallout({ summary, plans, region, onUpgrade, onDismiss }) {
  // Starter only. Pro tenants have nothing to be upsold to, and a trial has
  // not chosen a plan yet.
  if (summary.plan?.code !== 'STARTER') return null;

  const verdict = proUpgradeVerdict({
    plans,
    region,
    // Server-computed and cycle-scoped: a lifetime count would flatter the
    // comparison for someone who bought packs months ago and none since.
    replyCreditPacksThisCycle: summary.replyCreditPacksThisCycle ?? 0,
    extraIgAccounts: summary.extraIgAccounts ?? 0,
  });

  // Catalogue is missing a price — say nothing rather than guess.
  if (!verdict) return null;

  const isSaving = verdict.kind === 'saving';

  // The comparison variant is only worth the space once a tenant is actually
  // buying add-ons. Showing "here is what Pro costs" to a bare-Starter tenant
  // who has bought nothing is just an ad.
  if (!isSaving && !summary.replyCreditPacksThisCycle && !summary.extraIgAccounts) return null;

  const title = isSaving
    ? billing.upsell.title(verdict.formatted)
    : billing.upsell.comparisonTitle(verdict.pro.replies, verdict.pro.accounts, verdict.pro.formattedPrice);

  return (
    <section className={styles.upsell} aria-label={title}>
      <span className={styles.upsellIcon}>
        <Icon name="zap" size={22} />
      </span>
      <div className={styles.upsellBody}>
        <div className={styles.upsellTitle}>{title}</div>
        <p className={styles.upsellText}>
          {isSaving ? billing.upsell.body : billing.upsell.comparisonBody}
        </p>
        <div className={styles.upsellActions}>
          <button type="button" className="btn btn-primary" onClick={() => onUpgrade('PRO')}>
            {billing.upsell.button}
          </button>
          {onDismiss && (
            <button type="button" className="btn btn-ghost" onClick={onDismiss}>
              {billing.upsell.dismiss}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
