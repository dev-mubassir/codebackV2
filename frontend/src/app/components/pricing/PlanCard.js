'use client';

/**
 * One plan, rendered identically wherever it appears.
 *
 * SHARED CONTRACT — used unchanged by both the marketing pricing section
 * and the in-app billing page. Neither Wave 1 gate may edit this file: if
 * the two pages each styled their own card, the same plan would eventually
 * show different numbers or different limits in the two places a customer
 * compares before paying.
 *
 * Purely presentational. It takes a plan object straight from
 * GET /api/billing/plans and renders it — no fetching, no pricing maths,
 * and no hardcoded amounts.
 */

import { formatPrice, priceFor } from '@/lib/pricing';
import styles from './PlanCard.module.css';

export default function PlanCard({
  plan,
  region,
  recommended = false,
  /** Footer action — a buy/renew button, a "Contact us" link, or nothing. */
  action = null,
  /** Shown instead of a price for contact-us tiers. */
  priceOverride = null,
  className = '',
}) {
  const price = priceFor(plan.prices, region);
  const packPrice = priceFor(plan.addons?.replyCredits?.[0]?.prices, region);
  const pack = plan.addons?.replyCredits?.[0];
  const igPrice = priceFor(plan.addons?.extraIgAccount?.prices, region);

  return (
    <div
      className={`${styles.card} ${recommended ? styles.recommended : ''} ${className}`.trim()}
      data-plan={plan.code}
    >
      {recommended && <div className={styles.badge}>Recommended</div>}

      <h3 className={styles.name}>{plan.name}</h3>

      <div className={styles.priceRow}>
        {priceOverride ? (
          <span className={styles.price}>{priceOverride}</span>
        ) : price ? (
          <>
            <span className={styles.price}>{formatPrice(price.amount, price.currency)}</span>
            <span className={styles.period}>/ {plan.cycleLengthDays} days</span>
          </>
        ) : (
          <span className={styles.price}>Contact us</span>
        )}
      </div>

      <ul className={styles.features}>
        <li>
          {plan.igAccountLimit == null
            ? 'Custom Instagram accounts'
            : `${plan.igAccountLimit} Instagram account${plan.igAccountLimit === 1 ? '' : 's'}`}
        </li>
        <li>
          {plan.autoReplyCreditsPerCycle == null
            ? 'Custom auto-replies'
            : `${plan.autoReplyCreditsPerCycle.toLocaleString('en-IN')} auto-replies`}
        </li>
        <li>Unused replies roll over</li>
      </ul>

      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
