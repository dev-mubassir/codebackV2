'use client';

/**
 * Is Auto DM available to this user? Read from GET /api/autodm/status — the
 * backend's own flag, not a NEXT_PUBLIC_ mirror — so switching AUTODM_ENABLED
 * off and restarting the backend hides the sidebar item with no frontend
 * deploy.
 *
 * Cached for a minute across page navigations (the shell re-mounts per page);
 * any error means "not available", so a failure can only ever hide the item.
 */

import { useEffect, useState } from 'react';
import { getAutoDmStatus } from '@/lib/autodmApi';

const TTL_MS = 60 * 1000;
let cache = { value: false, at: 0 };
let inflight = null;

function fetchStatus() {
  if (!inflight) {
    inflight = getAutoDmStatus()
      .then((d) => Boolean(d && d.enabled && d.available))
      .catch(() => false)
      .then((value) => {
        cache = { value, at: Date.now() };
        inflight = null;
        return value;
      });
  }
  return inflight;
}

export default function useAutoDmStatus(signedIn) {
  const [available, setAvailable] = useState(() => (Date.now() - cache.at < TTL_MS ? cache.value : false));

  useEffect(() => {
    if (!signedIn) return undefined;
    if (Date.now() - cache.at < TTL_MS) return undefined; // the initial state already holds it
    let cancelled = false;
    fetchStatus().then((value) => {
      if (!cancelled) setAvailable(value);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  return available;
}
