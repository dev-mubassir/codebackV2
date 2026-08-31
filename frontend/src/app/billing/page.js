'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { getSubscription, getPlans, subscribeToPlan, purchaseAddon } from '@/lib/api';
import AppShell from '@/app/components/AppShell';
import Icon from '@/app/components/Icon';
import { billing as t, common } from '@/content/copy';
import { planLabel } from '@/content/labels';
import { formatCurrency } from '@/content/format';
import styles from './billing.module.css';

// Fixed, publicly-known packs (matches backend/src/lib/addonPacks.js — no
// endpoint exists to fetch these dynamically, and the pricing itself is a
// fixed product decision, not configurable data).
const ADDON_PACKS = [
  { code: '1', dmCredits: 500, priceInPaise: 29900 },
  { code: '2', dmCredits: 1500, priceInPaise: 79900 },
  { code: '3', dmCredits: 3000, priceInPaise: 149900 },
];

const CASHFREE_MODE = process.env.NODE_ENV === 'production' ? 'production' : 'sandbox';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default function BillingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);
  const [customerPhone, setCustomerPhone] = useState('');
  // Which plan slug or `addon-<code>` is mid-checkout, for per-button loading state.
  const [checkoutKey, setCheckoutKey] = useState('');
  const [enterpriseMessage, setEnterpriseMessage] = useState('');
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [sub, planList] = await Promise.all([getSubscription(), getPlans()]);
        setSubscription(sub);
        setPlans(planList);
      } catch (err) {
        setError(err.response?.data?.error || t.errors.loadFailed);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function getCashfree() {
    if (typeof window === 'undefined' || typeof window.Cashfree !== 'function') return null;
    return window.Cashfree({ mode: CASHFREE_MODE });
  }

  async function handleSubscribe(planSlug) {
    if (planSlug === 'enterprise') {
      setError('');
      try {
        const result = await subscribeToPlan('enterprise', '');
        setEnterpriseMessage(result.message);
      } catch (err) {
        setError(err.response?.data?.error || t.errors.checkoutFailed);
      }
      return;
    }

    if (!customerPhone.trim()) {
      setError(t.errors.phoneRequired);
      return;
    }
    const cashfree = getCashfree();
    if (!cashfree) {
      setError(t.errors.sdkUnavailable);
      return;
    }

    setCheckoutKey(planSlug);
    setError('');
    try {
      const result = await subscribeToPlan(planSlug, customerPhone.trim());
      if (result.selfServe === false) {
        setEnterpriseMessage(result.message);
        return;
      }
      // Manual-renewal mode (CASHFREE_SUBSCRIPTIONS_ENABLED=false on the
      // backend) returns a one-time PG order instead of a Subscriptions
      // mandate — different response shape, different Cashfree SDK method.
      if (result.manualRenewal) {
        cashfree.checkout({ paymentSessionId: result.paymentSessionId, redirectTarget: '_self' });
      } else {
        cashfree.subscriptionsCheckout({ subsSessionId: result.subscriptionSessionId, redirectTarget: '_self' });
      }
    } catch (err) {
      setError(err.response?.data?.error || t.errors.checkoutFailed);
    } finally {
      setCheckoutKey('');
    }
  }

  async function handleAddonPurchase(packCode) {
    if (!customerPhone.trim()) {
      setError(t.errors.phoneRequired);
      return;
    }
    const cashfree = getCashfree();
    if (!cashfree) {
      setError(t.errors.sdkUnavailable);
      return;
    }

    const key = `addon-${packCode}`;
    setCheckoutKey(key);
    setError('');
    try {
      const result = await purchaseAddon(packCode, customerPhone.trim());
      cashfree.checkout({ paymentSessionId: result.paymentSessionId, redirectTarget: '_self' });
    } catch (err) {
      setError(err.response?.data?.error || t.errors.checkoutFailed);
    } finally {
      setCheckoutKey('');
    }
  }

  if (loading) {
    return (
      <AppShell activeRoute="/billing">
        <div className={styles.loadingSkeleton} aria-busy="true" aria-label={common.loading}>
          <div className="spinner spinner-lg" />
        </div>
      </AppShell>
    );
  }

  const trialDaysLeft = subscription?.trialEndsAt
    ? Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / MS_PER_DAY)
    : null;
  const isTrialing = subscription?.status === 'trial';
  const trialActive = isTrialing && trialDaysLeft !== null && trialDaysLeft >= 0;
  const trialExpired = isTrialing && trialDaysLeft !== null && trialDaysLeft < 0;

  const limits = subscription?.effectiveLimits || {};
  const quotaUsed = subscription?.dmQuotaUsedThisCycle || 0;
  const addonCredits = subscription?.addonDmCredits || 0;
  const hasFixedQuota = limits.dmQuota !== null && limits.dmQuota !== undefined;
  const quotaTotal = hasFixedQuota ? limits.dmQuota + addonCredits : null;
  const quotaPercent = quotaTotal ? Math.min(100, (quotaUsed / quotaTotal) * 100) : 0;

  return (
    <AppShell activeRoute="/billing">
      <Script src="https://sdk.cashfree.com/js/v3/cashfree.js" strategy="lazyOnload" onLoad={() => setSdkReady(true)} />

      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t.title}</h1>
        <p className={styles.pageSubtitle}>{t.subtitle}</p>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <Icon name="alertTriangle" size={14} />
          <span>{error}</span>
        </div>
      )}

      {trialActive && (
        <div className={styles.trialBanner}>
          <Icon name="clock" size={14} />
          <span>{t.trialBanner.active(trialDaysLeft)}</span>
        </div>
      )}
      {trialExpired && (
        <div className={styles.trialBannerExpired}>
          <Icon name="alertTriangle" size={14} />
          <span>{t.trialBanner.expired}</span>
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{t.currentPlanLabel}</h2>
        </div>
        <div className={styles.currentPlanRow}>
          <span className={styles.currentPlanName}>{planLabel(subscription?.plan?.slug).label}</span>
          <span className={styles.usageLabel}>
            {hasFixedQuota ? t.usage.label(quotaUsed, quotaTotal) : t.usage.unlimited}
          </span>
        </div>
        {hasFixedQuota && (
          <div className={styles.usageBarTrack}>
            <div className={styles.usageBarFill} style={{ width: `${quotaPercent}%` }} />
          </div>
        )}
        {addonCredits > 0 && <p className={styles.usageHint}>{t.usage.addonNote(addonCredits)}</p>}
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor="billing-phone">{t.phoneLabel}</label>
        <input
          id="billing-phone"
          type="tel"
          className="input"
          placeholder={t.phonePlaceholder}
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
        />
        <span className={styles.formHint}>{t.phoneHint}</span>
      </div>

      <div className={styles.plansGrid}>
        {plans.map((plan) => {
          const isCurrent = subscription?.planId === plan.id;
          const isEnterprise = plan.priceInPaise === null;
          const isCheckingOut = checkoutKey === plan.slug;

          return (
            <div key={plan.id} className={`${styles.planCard} ${isCurrent ? styles.planCardActive : ''}`}>
              <h3 className={styles.planName}>{plan.name}</h3>

              {isEnterprise ? (
                <>
                  <p className={styles.planPrice}>{t.plans.contactUs}</p>
                  <p className={styles.planNote}>{t.plans.enterpriseNote}</p>
                  <button className="btn btn-secondary btn-md" onClick={() => handleSubscribe('enterprise')}>
                    {t.plans.contactUs}
                  </button>
                  {enterpriseMessage && <p className={styles.planNote}>{enterpriseMessage}</p>}
                </>
              ) : (
                <>
                  <p className={styles.planPrice}>
                    {formatCurrency(plan.priceInPaise / 100)}
                    <span className={styles.planInterval}>{t.plans.perMonth}</span>
                  </p>
                  <ul className={styles.planFeatures}>
                    <li>{t.plans.dmQuota(plan.dmQuota)}</li>
                    <li>{t.plans.accountLimit(plan.accountLimit)}</li>
                  </ul>
                  <button
                    className="btn btn-primary btn-md"
                    disabled={isCurrent || isCheckingOut}
                    onClick={() => handleSubscribe(plan.slug)}
                  >
                    {isCurrent ? t.plans.currentPlanAction : isCheckingOut ? t.plans.subscribing : t.plans.subscribeAction}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{t.addons.title}</h2>
          <p className={styles.cardDesc}>{t.addons.subtitle}</p>
        </div>
        <div className={styles.addonGrid}>
          {ADDON_PACKS.map((pack) => {
            const key = `addon-${pack.code}`;
            const isCheckingOut = checkoutKey === key;
            return (
              <div key={pack.code} className={styles.addonCard}>
                <span className={styles.addonCredits}>{pack.dmCredits.toLocaleString('en-GB')} DMs</span>
                <span className={styles.addonPrice}>{formatCurrency(pack.priceInPaise / 100)}</span>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={isCheckingOut}
                  onClick={() => handleAddonPurchase(pack.code)}
                >
                  {isCheckingOut ? t.plans.subscribing : t.addons.buyAction}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
