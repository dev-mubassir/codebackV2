'use client';

/**
 * The marketing pricing section.
 *
 * Renders from GET /api/billing/plans through the shared usePricing() hook,
 * using the shared <PlanCard> — the same component the in-app billing page
 * uses. That sharing is the point: the two surfaces a customer compares
 * before paying cannot show different numbers for the same plan, because
 * there is only one card and one source of prices.
 *
 * NOTHING HERE IS A NUMBER. Every amount is a plan_prices row, so changing a
 * price is an UPDATE and a refresh, never a redeploy.
 *
 * Renders nothing at all while BILLING_ENABLED is off: /api/billing/plans
 * 404s, the hook surfaces an error, and the homepage is unchanged. That is
 * the intended pre-launch state — the section appears when the flag flips,
 * with no code change.
 */

import { usePricing, priceFor, formatPrice, REGION_IN, REGION_INTL } from '@/lib/pricing';
import PlanCard from './PlanCard';
import { marketing } from '@/content/copy';
import styles from './PricingSection.module.css';

/**
 * The trust badge.
 *
 * Text only, by deliberate decision — see the note on marketing.pricing in
 * content/copy.js. No Meta or Instagram imagery, and never the phrase "Meta
 * Verified", which names a paid Meta product this company does not have.
 *
 * The Graph API half is gated on META_APPROVED and appears only once App
 * Review approval has landed. The flag reaches the browser the same way the
 * billing flag does — reported by the server, never mirrored into a
 * NEXT_PUBLIC_ variable that could disagree with it.
 */
function TrustBadge({ metaApproved }) {
  return (
    <p className={styles.badge}>
      <span>{marketing.pricing.badgeVerified}</span>
      {metaApproved && (
        <>
          <span aria-hidden="true" className={styles.badgeDot}>·</span>
          <span>{marketing.pricing.badgeGraphApi}</span>
        </>
      )}
    </p>
  );
}

export default function PricingSection() {
  const { loading, error, plans, region, setRegion, availableRegions, showCurrencyToggle, metaApproved } =
    usePricing();

  // Billing is dark, or pricing could not load. Say nothing rather than
  // render an empty shell on the landing page.
  if (loading || error || plans.length === 0) return null;

  return (
    <section className={styles.section} id="pricing">
      <h2 className={styles.title}>{marketing.pricing.title}</h2>
      <p className={styles.subtitle}>{marketing.pricing.subtitle}</p>

      {/* Only shown when the API actually offers more than one currency —
          a toggle with one option is furniture. */}
      {showCurrencyToggle && (
        <div className={styles.toggle} role="group" aria-label="Currency">
          {availableRegions.map((r) => (
            <button
              key={r}
              type="button"
              className={`${styles.toggleButton} ${region === r ? styles.toggleActive : ''}`}
              aria-pressed={region === r}
              onClick={() => setRegion(r)}
            >
              {r === REGION_IN ? 'INR ₹' : 'USD $'}
            </button>
          ))}
        </div>
      )}

      <div className={styles.grid}>
        {plans.map((plan) => {
          const price = priceFor(plan.prices, region);
          const isQuoteOnly = plan.isQuoteOnly;

          return (
            <PlanCard
              key={plan.code}
              plan={plan}
              region={region}
              recommended={plan.code === 'PRO'}
              // A quote-only tier still shows a real "from" figure, because
              // the catalogue has one — but it is prefixed, so it reads as a
              // starting point rather than a checkout price.
              priceOverride={
                isQuoteOnly && price
                  ? `${marketing.pricing.fromPrefix} ${formatPrice(price.amount, price.currency)}`
                  : null
              }
              action={
                isQuoteOnly ? (
                  <a className="btn btn-secondary" href="/support">
                    {marketing.pricing.contactCta}
                  </a>
                ) : (
                  <a className="btn btn-primary" href="/register">
                    {marketing.pricing.startCta}
                  </a>
                )
              }
            />
          );
        })}
      </div>

      {/* Given real visual weight, not treated as fine print: with no autopay
          doing the work, "we will never charge you without you asking" is the
          strongest thing this page says. */}
      <div className={styles.noMandate}>
        <p className={styles.noMandateTitle}>{marketing.pricing.noMandateTitle}</p>
        <p className={styles.noMandateBody}>{marketing.pricing.noMandateBody}</p>
      </div>

      <TrustBadge metaApproved={metaApproved} />
    </section>
  );
}
