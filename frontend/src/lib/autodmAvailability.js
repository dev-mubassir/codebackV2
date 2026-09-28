/**
 * Is Auto DM open to everyone yet? GET /api/public/autodm-availability
 * (public, no user data, cached 60 s by the server). The landing section and
 * the pricing rows show "Coming soon" until it answers { available: true } —
 * i.e. until the admin sets the rollout mode to EVERYONE, with no redeploy.
 *
 * One request per page load, shared by every caller. null = not known yet.
 */

import { useEffect, useState } from 'react';
import api from './api';

let pending = null;

function fetchAvailability() {
  if (!pending) {
    pending = api
      .get('/api/public/autodm-availability')
      .then(({ data }) => Boolean(data && data.available === true))
      .catch(() => false); // unknown = not available: the badge stays
  }
  return pending;
}

export function useAutoDmAvailability() {
  const [available, setAvailable] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchAvailability().then((v) => {
      if (!cancelled) setAvailable(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

/**
 * The "Coming soon" badge. Always in the layout — only its visibility changes —
 * so nothing moves when the answer arrives or when it disappears.
 */
export function comingSoonProps(available) {
  const show = available === false;
  return {
    className: `autodm-soon${show ? '' : ' autodm-soon-hidden'}`,
    'aria-hidden': show ? undefined : true,
  };
}
