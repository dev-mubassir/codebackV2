'use client';

/**
 * The one avatar in the product.
 *
 * WHY THIS EXISTS. Instagram profile pictures are SIGNED CDN URLs
 * (scontent.cdninstagram.com/...?...&oe=<hex unix expiry>) with a lifetime of
 * roughly four days. We store the URL at first contact and only refresh it
 * when that person sends another DM, so a contact who goes quiet ends up with
 * a URL that returns HTTP 403. Every <img> that pointed straight at the stored
 * URL then rendered a broken image — and on the production inbox, where the
 * avatar wrapper needs `overflow: visible` for the messaging-window dot, the
 * alt text escaped the 36px circle and pushed the row apart.
 *
 * So this component does three things no bare <img> did:
 *   1. Hard size + overflow:hidden, so a failure can never resize a row.
 *   2. onError -> initial-letter circle, immediately. No broken-image icon.
 *   3. onError -> ONE background refresh of the stored URL, through a shared
 *      queue. If Instagram returns a fresh URL we swap the photo back in.
 *
 * NEVER LOOPS. `attempted` is checked before requesting and set before the
 * request resolves, and the refreshed URL is rendered with `retriedRef` already
 * true — so a second failure falls through to the initial and stops there.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshContactProfile } from '@/lib/api';

/* ============================================================
 * Shared refresh queue
 *
 * A 50-row inbox whose avatars all expired on the same day would otherwise
 * fire 50 simultaneous refreshes, each one a Graph API call. The queue runs
 * them one at a time with a gap, and remembers every contact it has already
 * tried for the life of the page — so scrolling a conversation back into view
 * costs nothing.
 * ============================================================ */

const GAP_MS = 400;
const attempted = new Set();
const queue = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try {
      const updated = await refreshContactProfile(job.contactId);
      job.resolve(updated?.profilePicUrl || null);
    } catch {
      // 404 (gone), 429 (too soon), 502 (Instagram said no) — all mean the
      // same thing here: keep the initial-letter fallback.
      job.resolve(null);
    }
    if (queue.length > 0) {
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }
  draining = false;
}

/** Resolves to a fresh URL, or null. Requests each contact at most once per page load. */
function requestRefresh(contactId) {
  if (!contactId || attempted.has(contactId)) return Promise.resolve(null);
  attempted.add(contactId);
  return new Promise((resolve) => {
    queue.push({ contactId, resolve });
    drain();
  });
}

/** Exported for tests and for a future "reload avatars" action. */
export function resetAvatarRefreshCache() {
  attempted.clear();
  queue.length = 0;
}

/* ============================================================ */

function initialOf(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '?';
  return trimmed[0].toUpperCase();
}

/**
 * @param {string}  [src]        Stored profile picture URL. May be expired.
 * @param {string}  [name]       Display name — drives the initial and the alt text.
 * @param {string}  [contactId]  Contact id. Without it, a failed image cannot be refreshed.
 * @param {number}  [size=36]    Rendered px. Width and height are both fixed to it.
 * @param {string}  [className]  Extra classes on the wrapper.
 * @param {boolean} [decorative] True when an adjacent label already names the person,
 *                               so the image is hidden from screen readers.
 */
export default function Avatar({
  src,
  name,
  contactId,
  size = 36,
  className = '',
  decorative = false,
  style,
}) {
  const normalisedSrc = src || null;

  const [url, setUrl] = useState(normalisedSrc);
  const [failed, setFailed] = useState(false);
  // Which `src` we have already spent a refresh on. Only ever read or written
  // inside the error handler, never during render.
  const retriedForRef = useRef(null);
  const aliveRef = useRef(true);

  // A new `src` — the same node reused for a different conversation — is a
  // fresh start. Derived during render rather than in an effect, so the
  // previous person's photo is never painted for a frame first.
  const [prevSrc, setPrevSrc] = useState(normalisedSrc);
  if (prevSrc !== normalisedSrc) {
    setPrevSrc(normalisedSrc);
    setUrl(normalisedSrc);
    setFailed(false);
  }

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const handleError = useCallback(() => {
    // Show the initial immediately — never leave a broken image on screen
    // while the refresh is in flight.
    setFailed(true);

    if (!contactId) return;

    // THIS IS THE LOOP GUARD. Keyed on the incoming `src`, not on a boolean:
    // if the refreshed URL also fails, `src` has not changed, so we land here
    // with the flag already set and stop. A genuinely new `src` (a different
    // person in a recycled row) gets its own single attempt.
    if (retriedForRef.current === normalisedSrc) return;
    retriedForRef.current = normalisedSrc;

    requestRefresh(contactId).then((fresh) => {
      if (!aliveRef.current) return;
      if (fresh && fresh !== normalisedSrc) {
        setUrl(fresh);
        setFailed(false);
      }
    });
  }, [contactId, normalisedSrc]);

  const initial = initialOf(name);
  const px = `${size}px`;
  const wrapperStyle = {
    width: px,
    height: px,
    minWidth: px,
    minHeight: px,
    borderRadius: '50%',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-primary-subtle, #eef2ff)',
    color: 'var(--color-primary, #4169e1)',
    fontWeight: 700,
    fontSize: `${Math.max(10, Math.round(size * 0.4))}px`,
    lineHeight: 1,
    userSelect: 'none',
    ...style,
  };

  const showImage = Boolean(url) && !failed;

  return (
    <span className={className} style={wrapperStyle} aria-hidden={decorative || undefined}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={decorative ? '' : name || ''}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          // Meta's CDN does not need our URL, and sending it leaks the app's
          // page addresses to a third party on every avatar.
          referrerPolicy="no-referrer"
          onError={handleError}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
