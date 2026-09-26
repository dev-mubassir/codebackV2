'use client';

/**
 * Starting a payment, end to end.
 *
 * THERE IS NO CARD FORM HERE, AND THERE MUST NEVER BE ONE. Checkout is
 * Cashfree's own HOSTED flow: our server creates an order and hands back a
 * `payment_session_id`, and Cashfree's script takes the browser to a page
 * Cashfree owns. Card numbers, CVVs and OTPs are entered there, on their
 * origin, and never touch Siffty's frontend, backend, or logs. Building a
 * card form here would drag the whole product into PCI scope for no product
 * benefit whatsoever.
 *
 * The SDK is loaded from Cashfree's CDN at click time rather than bundled:
 * the vast majority of sessions never open checkout, and a payment SDK is
 * not worth putting in the bundle every one of them downloads. The promise
 * is memoised at module scope so a customer who opens the dialog twice does
 * not fetch it twice.
 */

import { useCallback, useState } from 'react';
import api from '@/lib/api';
import { billing } from '@/content/billingCopy';
import { PLAN_DOWNGRADE_BLOCKED } from '@/lib/planChange';

const CASHFREE_SDK_SRC = 'https://sdk.cashfree.com/js/v3/cashfree.js';

/**
 * Sandbox or production, decided the SAME way the backend decides it
 * (lib/cashfree.js getBaseUrl: NODE_ENV). The two MUST agree — a session id
 * minted against sandbox cannot be opened against production, and the
 * failure mode is an opaque error on the payment page rather than anything
 * that names the mismatch. NEXT_PUBLIC_CASHFREE_MODE exists only as an
 * explicit override for the case where someone runs a production build
 * against the sandbox account on purpose. It is normalised exactly like the
 * backend's CASHFREE_ENV (trim + lowercase), so " Sandbox" in a deploy panel
 * cannot silently fall through to production on one side only.
 */
function cashfreeMode() {
  const override = (process.env.NEXT_PUBLIC_CASHFREE_MODE || '').trim().toLowerCase();
  if (override === 'sandbox' || override === 'production') return override;
  return process.env.NODE_ENV === 'production' ? 'production' : 'sandbox';
}

let sdkPromise = null;

function loadCashfreeSdk() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Cashfree checkout can only be opened in the browser.'));
  }
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CASHFREE_SDK_SRC;
    script.async = true;
    script.onload = () => {
      if (window.Cashfree) resolve(window.Cashfree);
      else reject(new Error('The Cashfree script loaded but exposed no checkout entry point.'));
    };
    script.onerror = () => {
      // Clear the memo so a retry actually retries — a cached rejected
      // promise would make every later attempt fail instantly with a stale
      // error, which looks like a permanent outage to the customer.
      sdkPromise = null;
      reject(new Error('The Cashfree script could not be fetched.'));
    };
    document.head.appendChild(script);
  });

  return sdkPromise;
}

/**
 * Hand the browser to Cashfree's hosted page.
 *
 * `redirectTarget: '_self'` rather than a popup or an iframe: UPI and
 * netbanking both bounce through a bank/app and come back, and a popup that
 * a mobile browser has closed in the meantime loses the payment. Leaving and
 * returning to our own `return_url` (which the backend already set to
 * /billing?order=<id>) is the flow that survives that round trip.
 */
async function openHostedCheckout(paymentSessionId) {
  const Cashfree = await loadCashfreeSdk();
  // Different builds of the v3 script return the instance directly or as a
  // promise. Awaiting covers both; awaiting a plain object is a no-op.
  const cashfree = await Cashfree({ mode: cashfreeMode() });
  return cashfree.checkout({ paymentSessionId, redirectTarget: '_self' });
}

export function useCheckout() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  // A refused downgrade is not a failure to retry — it is a rule with a date.
  // Held apart from `error` so the dialog can explain it instead of showing red.
  const [blocked, setBlocked] = useState(null);

  /**
   * @param {'plan'|'addon'} kind
   * @param {object} body  planCode/billingRegionHint or addonCode, plus customerPhone
   */
  const start = useCallback(async (kind, body) => {
    setPending(true);
    setError(null);
    setBlocked(null);
    try {
      const path = kind === 'plan' ? '/api/billing/checkout/plan' : '/api/billing/checkout/addon';
      const { data } = await api.post(path, body);
      await openHostedCheckout(data.paymentSessionId);
      // Deliberately NOT clearing `pending` on success: the browser is on its
      // way to Cashfree, and re-enabling the button during that navigation
      // invites a second click that creates a second order.
      return data;
    } catch (err) {
      // The backend's own message is the useful one where it has a specific
      // complaint (a bad phone number, a plan that needs an active
      // subscription); anything else is a generic failure the customer can
      // only retry.
      const serverMessage = err?.response?.data?.error;
      if (err?.response?.data?.code === PLAN_DOWNGRADE_BLOCKED) {
        setBlocked({ title: billing.planChange.blockedTitleGeneric, body: serverMessage });
        setPending(false);
        return null;
      }
      const isCheckoutStart = Boolean(err?.response);
      setError(serverMessage || (isCheckoutStart ? billing.errors.startCheckout : billing.errors.openPaymentPage));
      setPending(false);
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setPending(false);
    setError(null);
    setBlocked(null);
  }, []);

  return { start, pending, error, blocked, reset };
}

export default useCheckout;
