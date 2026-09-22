'use client';

/**
 * The two things a customer can buy on top of a plan, priced for the plan
 * they are actually on.
 *
 * ADD-ON PRICES ARE PER-TIER, and that is load-bearing rather than a
 * detail: a reply pack is cheaper on Pro than on Starter (see
 * AddonPackPrice's schema note), and that gap is the entire mechanical
 * argument for upgrading. So this shelf reads its prices out of the
 * catalogue entry for the tenant's OWN plan — showing Starter's pack price
 * to a Pro customer would overstate what they pay.
 *
 * Every amount comes from GET /api/billing/plans via lib/pricing. There is
 * no fallback price anywhere in this file: if the catalogue has no row for a
 * plan/region pair, the row simply does not render, because a made-up
 * number on a page someone is about to pay from is worse than a missing one.
 */

import Icon from '@/app/components/Icon';
import { formatPrice, priceFor } from '@/lib/pricing';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';

/** The recurring add-on's code, matching routes/billing.js RECURRING_ADDON_CODE. */
const EXTRA_IG_ACCOUNT = 'extra_ig_account';

export default function AddonShelf({ summary, catalogPlan, region, onBuyAddon }) {
  // The checkout endpoint refuses an add-on without an active Starter/Pro
  // plan and a locked region, so the shelf says that up front rather than
  // letting someone fill in a phone number and collect a 400.
  const canBuy = Boolean(summary.plan?.purchasable && ['ACTIVE', 'GRACE'].includes(summary.status));

  const pack = catalogPlan?.addons?.replyCredits?.[0];
  const packPrice = priceFor(pack?.prices, region);
  const igPrice = priceFor(catalogPlan?.addons?.extraIgAccount?.prices, region);

  if (!packPrice && !igPrice) return null;

  return (
    <section className={styles.panel} aria-label={billing.addons.heading}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitleGroup}>
          <span className={styles.panelIcon}>
            <Icon name="plus" size={18} />
          </span>
          <h2 className={styles.panelTitle}>{billing.addons.heading}</h2>
        </div>
      </div>
      <p className={styles.help} style={{ marginBottom: 8 }}>
        {billing.addons.subheading}
      </p>

      {packPrice && pack && (
        <div className={styles.addonRow}>
          <div className={styles.addonInfo}>
            <div className={styles.addonName}>{billing.addons.replyPack(pack.creditAmount)}</div>
            <p className={styles.help}>{billing.addons.replyPackHelp}</p>
          </div>
          <div className={styles.addonRight}>
            <span className={styles.addonPrice}>{formatPrice(packPrice.amount, packPrice.currency)}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onBuyAddon(pack.code)}
              disabled={!canBuy}
            >
              {billing.addons.buyReplies}
            </button>
          </div>
        </div>
      )}

      {igPrice && (
        <div className={styles.addonRow}>
          <div className={styles.addonInfo}>
            <div className={styles.addonName}>{billing.addons.extraIgAccount}</div>
            <p className={styles.help}>{billing.addons.extraIgAccountHelp}</p>
          </div>
          <div className={styles.addonRight}>
            <span className={styles.addonPrice}>{formatPrice(igPrice.amount, igPrice.currency)}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onBuyAddon(EXTRA_IG_ACCOUNT)}
              disabled={!canBuy}
            >
              {billing.addons.addAccount}
            </button>
          </div>
        </div>
      )}

      {!canBuy && (
        <p className={styles.help} style={{ marginTop: 12 }}>
          {billing.addons.needsPlan}
        </p>
      )}
    </section>
  );
}
