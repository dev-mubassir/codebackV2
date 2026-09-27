'use client';

/**
 * What every Auto DM screen needs before it can render: the signed-in user
 * (else /login; unfinished onboarding → /onboarding, like every internal
 * page), whether Auto DM is available to them, and their accounts with the
 * comments-scope state.
 *
 * state: 'loading' | 'unavailable' | 'ready' | 'error'
 * Without access ('unavailable') the page redirects to /dashboard.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe } from '@/lib/api';
import { getAutoDmStatus, getAutoDmAccounts } from '@/lib/autodmApi';
import { rememberDestination } from '@/lib/pendingDestination';

export default function useAutoDmPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [state, setState] = useState('loading');
  const [accounts, setAccounts] = useState([]);

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await getAutoDmAccounts());
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

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
      setUser(me);

      let status;
      try {
        status = await getAutoDmStatus();
      } catch {
        if (!cancelled) setState('error');
        return;
      }
      if (cancelled) return;
      if (!status?.enabled || !status?.available) {
        // No access = the feature is invisible: go to the dashboard.
        setState('unavailable');
        router.replace('/dashboard');
        return;
      }
      await loadAccounts();
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router, loadAccounts]);

  return { user, state, accounts, reloadAccounts: loadAccounts };
}
