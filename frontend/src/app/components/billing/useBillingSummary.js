'use client';

/**
 * The billing page's own state, from GET /api/billing/summary.
 *
 * Separate from lib/pricing's usePricing() on purpose, and the split is not
 * cosmetic: usePricing loads the public CATALOGUE (what things cost — the
 * same rows the marketing page reads), while this loads the caller's own
 * ENTITLEMENT (what they have). One is shared contract, the other is
 * per-tenant and behind a session. Keeping them apart is what lets the
 * billing page and the marketing page quote the same prices without this
 * page's private state leaking into a shared hook.
 *
 * `reload()` is exposed because three things on the page change the answer:
 * returning from Cashfree's hosted page, an add-on landing, and the manual
 * retry after an error.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';

export function useBillingSummary() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Guards a state update after unmount — the page polls while a payment is
  // confirming, so a response can easily land after the user has navigated on.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await api.get('/api/billing/summary');
      if (!alive.current) return null;
      setSummary(data);
      setError(null);
      return data;
    } catch (err) {
      if (alive.current) setError(err);
      return null;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  /**
   * Manual refresh, for the retry button and the post-payment poll. `loading`
   * is deliberately NOT raised again here: the page already has data on
   * screen by the time anything calls this, and flipping back to a spinner
   * would blank out a page the customer is reading.
   */
  const reload = useCallback(() => fetchSummary(), [fetchSummary]);

  useEffect(() => {
    // Wrapped in an async IIFE rather than called bare, so every state
    // update provably happens in a callback after an await instead of
    // synchronously in the effect body — the latter cascades a second render
    // before the first has painted. Same shape usePricing() uses.
    (async () => {
      await fetchSummary();
    })();
  }, [fetchSummary]);

  return { summary, loading, error, reload };
}

export default useBillingSummary;
