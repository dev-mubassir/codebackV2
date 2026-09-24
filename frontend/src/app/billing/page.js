'use client';

/**
 * The in-app billing page.
 *
 * TWO SOURCES, KEPT SEPARATE ON PURPOSE:
 *   - usePricing()        the public CATALOGUE — what everything costs.
 *                         Shared contract with the marketing page, so both
 *                         quote identical numbers by construction.
 *   - useBillingSummary() this tenant's own ENTITLEMENT — plan, dates,
 *                         credits, usage, orders. Session-scoped, private.
 *
 * NOT ONE HARDCODED PRICE ANYWHERE. Every amount on this page (plan prices,
 * add-on prices, the Pro saving, the amount in the checkout dialog, the
 * amounts in payment history) traces back to a plan_prices row via those two
 * hooks. Changing a price is an UPDATE and a refresh, with no redeploy — and
 * that only stays true if nobody ever types a number into this file.
 *
 * DEEP LINK FROM RENEWAL EMAIL. Gate 7's reminders link to
 * /billing?renew=<PLAN_CODE>&src=email_<TYPE>. This page opens checkout for
 * that plan directly, because the alternative — land, read, find the button,
 * click it — is exactly the friction that loses a renewal for a product with
 * no auto-debit. The only step that cannot be skipped is the mobile number
 * Cashfree requires, which the dialog asks for with the field focused.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import AppShell from '@/app/components/ui/AppShell';
import Icon from '@/app/components/Icon';
import { Skeleton } from '@/app/components/ui';
import PlanCard from '@/app/components/pricing/PlanCard';
import { usePricing, formatPrice, priceFor, REGION_IN, REGION_INTL } from '@/lib/pricing';
import { common } from '@/content/copy';
import { billing } from '@/content/billingCopy';
import { getInstagramAuthUrl, getMe } from '@/lib/api';
import { rememberDestination } from '@/lib/pendingDestination';
import { formatDate } from '@/content/format';
import { planBlock } from '@/lib/planChange';

import useBillingSummary from '@/app/components/billing/useBillingSummary';
import useCheckout from '@/app/components/billing/useCheckout';
import CheckoutDialog from '@/app/components/billing/CheckoutDialog';
import BillingBanners from '@/app/components/billing/BillingBanners';
import PlanStatusCard from '@/app/components/billing/PlanStatusCard';
import TrialStateCard from '@/app/components/billing/TrialStateCard';
import { trialCardState, replacesPlanPanels, TRIAL_CARD } from '@/lib/trialState';
import CreditsCard from '@/app/components/billing/CreditsCard';
import UsageStrip from '@/app/components/billing/UsageStrip';
import AddonShelf from '@/app/components/billing/AddonShelf';
import ProUpgradeCallout from '@/app/components/billing/ProUpgradeCallout';
import OrderHistory from '@/app/components/billing/OrderHistory';
import styles from '@/app/components/billing/billing.module.css';

/** The add-on the "top up" buttons buy. Matches AddonPack.code in the catalogue. */
const REPLY_PACK_FALLBACK_CODE = 'reply_credits_500';

/**
 * Returning from Cashfree, the webhook that marks the order PAID may land
 * either just before or just after the browser does. Rather than showing a
 * stale "not completed" and leaving the customer to refresh, the page
 * re-reads its own summary a few times — bounded, because a payment that has
 * not confirmed in half a minute is not going to confirm by polling, and the
 * nightly reconciliation job is the real backstop for that case.
 */
const ORDER_POLL_INTERVAL_MS = 3000;
const ORDER_POLL_ATTEMPTS = 10;

function BillingPageContent({ user }) {
  const searchParams = useSearchParams();

  const { summary, loading: summaryLoading, error: summaryError, reload } = useBillingSummary();
  // Set when "Start my trial" is pressed here, so a claim confirms with the
  // granted card exactly as a connect does.
  const [claimedOutcome, setClaimedOutcome] = useState(null);
  const pricing = usePricing();
  const checkout = useCheckout();

  const [dialog, setDialog] = useState(null);
  const [upsellDismissed, setUpsellDismissed] = useState(false);

  /**
   * Which currency this page renders in.
   *
   * A LOCKED REGION WINS OUTRIGHT over the timezone hint. Once a tenant has
   * paid, Entitlement.billingRegion is the region of record — it was
   * established from the payment itself, not from anything the browser said
   * — and showing a returning customer a different currency than the one
   * they will actually be charged in is a broken promise on a page they are
   * about to pay from. The hint only decides the display for someone who has
   * never paid.
   */
  const region = useMemo(() => {
    const locked = summary?.billingRegion;
    if (locked && pricing.availableRegions.includes(locked)) return locked;
    return pricing.region;
  }, [summary?.billingRegion, pricing.availableRegions, pricing.region]);

  const regionIsLocked = Boolean(summary?.billingRegion && pricing.availableRegions.includes(summary.billingRegion));

  /** The catalogue entry for the plan this tenant is actually on — add-on prices are per-tier. */
  const catalogPlan = useMemo(
    () => pricing.plans.find((plan) => plan.code === summary?.plan?.code) || null,
    [pricing.plans, summary?.plan?.code]
  );

  const replyPackCode = catalogPlan?.addons?.replyCredits?.[0]?.code || REPLY_PACK_FALLBACK_CODE;

  // ---------------------------------------------------------------- dialogs

  /**
   * Describe the checkout dialog for a plan, or null when the catalogue has
   * no price for it in this region. PURE — it reads the catalogue and
   * returns a descriptor, so both the button handler below and the derived
   * ?renew= deep link can use it without duplicating the lookup.
   */
  const planDialogFor = useCallback(
    (planCode) => {
      const plan = pricing.plans.find((p) => p.code === planCode);
      const price = priceFor(plan?.prices, region);
      if (!plan || !price) return null; // no price row, no dialog — never invent one
      // A blocked downgrade opens the dialog in its explaining state — the
      // same answer the checkout API would give, without the round trip.
      const block = planBlock(summary, planCode);
      return {
        kind: 'plan',
        code: planCode,
        title: billing.checkout.title(plan.name),
        formattedAmount: formatPrice(price.amount, price.currency),
        blocked: block
          ? {
              title: billing.planChange.blockedTitle(plan.name, formatDate(block.availableFrom)),
              body: billing.planChange.blockedBody(
                summary?.plan?.name,
                plan.name,
                formatDate(block.availableFrom)
              ),
            }
          : null,
      };
    },
    [pricing.plans, region, summary]
  );

  const openPlanCheckout = useCallback(
    (planCode) => {
      const next = planDialogFor(planCode);
      if (!next) return;
      checkout.reset();
      setDialog(next);
    },
    [planDialogFor, checkout]
  );

  const openAddonCheckout = useCallback(
    (addonCode) => {
      const prices =
        addonCode === 'extra_ig_account'
          ? catalogPlan?.addons?.extraIgAccount?.prices
          : catalogPlan?.addons?.replyCredits?.find((pack) => pack.code === addonCode)?.prices;
      const price = priceFor(prices, region);
      if (!price) return;
      checkout.reset();
      setDialog({
        kind: 'addon',
        code: addonCode,
        title: billing.checkout.addonTitle,
        formattedAmount: formatPrice(price.amount, price.currency),
      });
    },
    [catalogPlan, region, checkout]
  );

  // ------------------------------------------------- deep link from email

  /**
   * ?renew=<PLAN_CODE> — the renewal emails link straight here, and the page
   * opens checkout for that plan rather than making the customer find the
   * button. (&src=email_<TYPE> rides along as click attribution and is
   * deliberately ignored by the UI.)
   *
   * DERIVED, NOT STORED. The URL already holds this intent, so the dialog it
   * implies is computed on render instead of pushed into state from an
   * effect — which would cascade an extra render and, worse, would need a
   * ref to stop it firing again every time the catalogue or summary settles.
   * Closing it is the only piece of real state, and that is what
   * `renewDismissed` is.
   */
  const renewParam = searchParams.get('renew');
  const [renewDismissed, setRenewDismissed] = useState(false);

  const renewDialog = useMemo(() => {
    if (!renewParam || renewDismissed) return null;
    // Both loads must have finished: the dialog needs a price (catalogue)
    // and the region needs the lock (summary) before it can show an amount.
    if (pricing.loading || summaryLoading) return null;
    return planDialogFor(renewParam);
  }, [renewParam, renewDismissed, pricing.loading, summaryLoading, planDialogFor]);

  // An explicitly opened dialog wins — a customer who closed the emailed one
  // and then clicked "Buy replies" means the second thing.
  const activeDialog = dialog || renewDialog;

  const closeDialog = useCallback(() => {
    setDialog(null);
    // Also retires the deep link, which is otherwise still in the URL and
    // would re-derive the same dialog on the very next render.
    setRenewDismissed(true);
    checkout.reset();
  }, [checkout]);

  const submitCheckout = useCallback(
    async (customerPhone) => {
      if (!activeDialog) return;
      const body =
        activeDialog.kind === 'plan'
          ? {
              planCode: activeDialog.code,
              // A DISPLAY HINT ONLY, and the server treats it as one: it is
              // consulted for a first purchase and ignored outright once a
              // region lock exists. See lib/pricing.detectRegionHint.
              billingRegionHint: region,
              customerPhone,
            }
          : { addonCode: activeDialog.code, customerPhone };
      await checkout.start(activeDialog.kind, body);
      // No success branch: a successful start navigates this tab to
      // Cashfree's hosted page, so there is nothing left here to update.
    },
    [activeDialog, region, checkout]
  );

  // -------------------------------------------- returning from checkout

  const orderParam = searchParams.get('order');
  const returningOrder = orderParam ? summary?.orders?.find((o) => o.cashfreeOrderId === orderParam) : null;

  useEffect(() => {
    if (!orderParam || !returningOrder || returningOrder.status !== 'CREATED') return undefined;

    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      const next = await reload({ quiet: true });
      const order = next?.orders?.find((o) => o.cashfreeOrderId === orderParam);
      if (attempts >= ORDER_POLL_ATTEMPTS || (order && order.status !== 'CREATED')) {
        window.clearInterval(timer);
      }
    }, ORDER_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [orderParam, returningOrder, reload]);

  // --------------------------------------------------------------- render

  if (summaryLoading || pricing.loading) {
    return (
      <AppShell user={user} title={billing.page.title} activeRoute="/billing">
        <div className={styles.loadingContainer} aria-busy="true" aria-label={common.loading}>
          <Skeleton lines={4} height={56} />
        </div>
      </AppShell>
    );
  }

  if (summaryError || !summary) {
    return (
      <AppShell user={user} title={billing.page.title} activeRoute="/billing">
        <div className={styles.errorState}>
          <p className={styles.errorText}>{billing.errors.loadSummary}</p>
          <button type="button" className={styles.btnSecondary} onClick={() => reload()}>
            {billing.common.retry}
          </button>
        </div>
      </AppShell>
    );
  }

  const purchasablePlans = pricing.plans.filter((plan) => plan.purchasable);
  const trialState = trialCardState(summary, {
    justConnectedOutcome: claimedOutcome || searchParams.get('trial'),
  });

  return (
    <AppShell user={user} title={billing.page.title} activeRoute="/billing">
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.pageSubtitle}>{billing.page.subtitle}</p>
        </div>

        {/* Only offered when there is a real choice AND the tenant has not
            already been locked to a region by a payment. */}
        {pricing.showCurrencyToggle && !regionIsLocked && (
          <div className={styles.currencyToggle} role="group" aria-label={billing.plan.currencyLabel}>
            {[REGION_IN, REGION_INTL]
              .filter((r) => pricing.availableRegions.includes(r))
              .map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`${styles.currencyOption} ${region === r ? styles.currencyOptionActive : ''}`}
                  onClick={() => pricing.setRegion(r)}
                  aria-pressed={region === r}
                >
                  {r === REGION_IN ? 'INR' : 'USD'}
                </button>
              ))}
          </div>
        )}
      </div>

      {returningOrder && returningOrder.status === 'CREATED' && (
        <div className={styles.banners}>
          <div className={`${styles.banner} ${styles.bannerInfo}`} role="status">
            <span className={styles.bannerIcon}>
              <Icon name="clock" size={18} />
            </span>
            <div className={styles.bannerBody}>
              <div className={styles.bannerTitle}>{billing.checkout.returningTitle}</div>
              <div className={styles.bannerText}>{billing.checkout.returningBody}</div>
            </div>
          </div>
        </div>
      )}

      <BillingBanners
        summary={summary}
        onRenew={() => openPlanCheckout(summary.plan?.purchasable ? summary.plan.code : 'STARTER')}
        onTopUp={() => openAddonCheckout(replyPackCode)}
      />

      <div className={styles.stack}>
        {/* A tenant with no trial and no plan gets the card that says WHY and
            what to do next — never the paid panels, whose "not on a plan" and
            three zeros are what read as an empty page. A live trial renders in
            the SAME panels as Starter and Pro, not a separate lesser layout. */}
        {trialState === TRIAL_CARD.GRANTED && <TrialStateCard summary={summary} state={trialState} />}
        {replacesPlanPanels(trialState) ? (
          <TrialStateCard
            summary={summary}
            state={trialState}
            connectHref={getInstagramAuthUrl()}
            plansHref="#plans"
            onClaimed={async (outcome) => {
              await reload();
              setClaimedOutcome(outcome);
            }}
          />
        ) : (
          <>
            <div className={styles.topGrid}>
              <PlanStatusCard summary={summary} onRenew={openPlanCheckout} />
              <CreditsCard summary={summary} />
            </div>

            <UsageStrip summary={summary} />
          </>
        )}

        {!upsellDismissed && (
          <ProUpgradeCallout
            summary={summary}
            plans={pricing.plans}
            region={region}
            onUpgrade={openPlanCheckout}
            onDismiss={() => setUpsellDismissed(true)}
          />
        )}

        <AddonShelf summary={summary} catalogPlan={catalogPlan} region={region} onBuyAddon={openAddonCheckout} />

        <section id="plans" aria-label={billing.plans.heading}>
          <h2 className={styles.sectionTitle}>{billing.plans.heading}</h2>
          <p className={styles.sectionSubtitle}>{billing.plans.subheading}</p>
          <div className={styles.planGrid}>
            {purchasablePlans.map((plan) => {
              const isCurrent = summary.plan?.code === plan.code;
              // A lower tier while a paid plan is active. Still clickable, so
              // the explanation is one tap away rather than a dead button.
              const block = planBlock(summary, plan.code);
              return (
                <PlanCard
                  key={plan.code}
                  plan={plan}
                  region={region}
                  recommended={plan.code === 'PRO'}
                  action={
                    <button
                      type="button"
                      className={`${isCurrent || block ? styles.btnSecondary : styles.btnPrimary} ${styles.btnBlock}`}
                      onClick={() => openPlanCheckout(plan.code)}
                    >
                      {block
                        ? billing.planChange.blockedButton(formatDate(block.availableFrom))
                        : isCurrent
                          ? billing.renewal.renewButton
                          : billing.renewal.buyButton}
                    </button>
                  }
                />
              );
            })}
          </div>
        </section>

        <div className={styles.reassure}>
          <span className={styles.reassureIcon}>
            <Icon name="shield" size={18} />
          </span>
          <div>
            <div className={styles.reassureTitle}>{billing.noAutoDebit.title}</div>
            <p className={styles.help}>{billing.noAutoDebit.body}</p>
          </div>
        </div>

        <OrderHistory orders={summary.orders} plans={pricing.plans} />
      </div>

      {/* Keyed on the item being bought so switching from a plan to an
          add-on resets the phone field rather than reusing stale local
          state from the previous dialog. */}
      <CheckoutDialog
        key={activeDialog ? `${activeDialog.kind}:${activeDialog.code}` : 'closed'}
        open={Boolean(activeDialog)}
        title={activeDialog?.title || ''}
        formattedAmount={activeDialog?.formattedAmount || ''}
        pending={checkout.pending}
        error={checkout.error}
        blocked={activeDialog?.blocked || checkout.blocked}
        onSubmit={submitCheckout}
        onClose={closeDialog}
      />
    </AppShell>
  );
}

/**
 * The flag gate, and the session.
 *
 * It sits OUTSIDE BillingPageContent on purpose. Hooks cannot be called
 * conditionally, and the content component's first hooks — the billing summary,
 * the catalogue, checkout — each start a request the moment they mount. With
 * billing switched off those requests 404, and master rendered the result as
 * "Couldn't load your billing details. Refresh the page to try again": an
 * instruction to retry something that can never work. Deciding here, before
 * the content mounts, means that with the flag off not one billing request is
 * made and not one billing word is drawn.
 *
 * Until the decision is made the page shows the shell and a skeleton, with no
 * title — the title "Billing" is itself billing content, and must not flash
 * for someone about to be sent away.
 */
function BillingGate() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let me;
      try {
        me = await getMe();
      } catch {
        if (!cancelled) router.push('/login');
        return;
      }
      if (cancelled) return;
      if (!me?.onboardingCompleted) {
        rememberDestination();
        router.replace('/onboarding');
        return;
      }
      // replace, not push: /billing must not stay in history as a page that
      // bounces, or Back returns the user to it and it bounces again.
      if (!me?.features?.billing) {
        router.replace('/dashboard');
        return;
      }
      setUser(me);
    }
    load();
    return () => { cancelled = true; };
  }, [router]);

  if (!user) return <GateShell />;

  // The Suspense boundary sits DIRECTLY around the component that calls
  // useSearchParams — the pattern the Next docs show, and the one master used.
  // The first version of this change put the boundary around BillingGate
  // instead, and /billing then hung on its loading state: two shells in the
  // DOM, the boundary's fallback visible and the gate's own shell hidden
  // inside the wrapper React uses for suspended content, with no error logged.
  // Keep the boundary here.
  return (
    <Suspense fallback={<GateShell />}>
      <BillingPageContent user={user} />
    </Suspense>
  );
}

/** Frame and skeleton, with no title: "Billing" is itself billing content. */
function GateShell() {
  return (
    <AppShell user={null} title="">
      <Skeleton lines={4} height={56} />
    </AppShell>
  );
}

export default function BillingPage() {
  return <BillingGate />;
}
