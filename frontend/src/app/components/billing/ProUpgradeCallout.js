'use client';

/**
 * The upgrade conversion point.
 *
 * WHEN IT FIRES: the moment a Starter tenant's FIRST add-on payment lands.
 * Buying a top-up is the strongest signal available that the plan underneath
 * it is too small, and it is the one moment where the comparison is about
 * something the customer just did rather than something they might do.
 *
 * WHERE THE NUMBER COMES FROM: proUpgradeSaving() in lib/pricing.js, which
 * is shared contract with the marketing page precisely so the two cannot
 * quote different savings for the same plans. Every amount in it is a
 * plan_prices row. Nothing here knows a price, and nothing here does
 * currency arithmetic.
 *
 * ---------------------------------------------------------------------
 * FLAGGED — READ BEFORE CHANGING THE TRIGGER
 * ---------------------------------------------------------------------
 * proUpgradeSaving() returns null when Pro is not actually cheaper, and at
 * the catalogue's current seeded prices that is the case for a tenant buying
 * ONE pack a cycle: Starter plus one pack costs less than Pro. The saving
 * only becomes real once a Starter tenant is buying several packs a cycle.
 *
 * So the trigger the brief specifies ("the moment they buy their first
 * add-on") and the arithmetic the prices produce do not agree, and this
 * component does NOT paper over that: it renders nothing rather than
 * printing a saving that is not true. `addonPacksPerCycle` below is the
 * tenant's REAL pack count for the current cycle, so when the number does
 * become real it is their number and not a hypothetical.
 *
 * Resolving the disagreement is a pricing decision, not a frontend one —
 * either the Pro price moves, or the pitch at the first add-on changes from
 * "you would save" to a value comparison that is true at one pack. Flagged
 * and queued for the owner rather than decided here.
 * ---------------------------------------------------------------------
 */

import Icon from '@/app/components/Icon';
import { proUpgradeSaving } from '@/lib/pricing';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';

/**
 * How many reply-credit packs this tenant has actually paid for in the
 * CURRENT cycle. Lifetime count would flatter the number for a long-standing
 * customer who bought one pack a year ago; the pitch is about what this
 * month costs them.
 */
function packsThisCycle(orders, cycleStartedAt) {
  if (!Array.isArray(orders) || !cycleStartedAt) return 1;
  const since = new Date(cycleStartedAt).getTime();
  const count = orders.filter(
    (order) =>
      order.status === 'PAID' &&
      order.addonCode &&
      order.addonCode !== 'extra_ig_account' &&
      new Date(order.paidAt || order.createdAt).getTime() >= since
  ).length;
  // At least one: this only renders after a paid add-on exists, and a zero
  // denominator would compare Pro against bare Starter, which is a different
  // (and weaker) argument.
  return Math.max(1, count);
}

export default function ProUpgradeCallout({ summary, plans, region, onUpgrade, onDismiss }) {
  // Starter only, and only after a top-up has actually been paid for. An
  // abandoned checkout is not a signal, which is why the server counts PAID
  // add-on orders rather than orders.
  if (summary.plan?.code !== 'STARTER') return null;
  if (!summary.paidAddonOrders) return null;

  const saving = proUpgradeSaving({
    plans,
    region,
    addonPacksPerCycle: packsThisCycle(summary.orders, summary.cycleStartedAt),
  });

  // See the flagged note above: no honest number, no claim.
  if (!saving) return null;

  return (
    <section className={styles.upsell} aria-label={billing.upsell.title(saving.formatted)}>
      <span className={styles.upsellIcon}>
        <Icon name="zap" size={22} />
      </span>
      <div className={styles.upsellBody}>
        <div className={styles.upsellTitle}>{billing.upsell.title(saving.formatted)}</div>
        <p className={styles.upsellText}>{billing.upsell.body}</p>
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
