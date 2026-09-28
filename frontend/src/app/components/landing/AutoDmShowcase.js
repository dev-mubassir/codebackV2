'use client';

/**
 * Landing — the Auto DM section. Left: headline, subline, four benefits, CTA.
 * Right: a phone (the commenter's Instagram) that loops the real flow:
 *
 *   comment "LINK" under a reel → public reply → opening DM with a
 *   "Send me the link" button → tap → "Follow to unlock" → tap →
 *   image + link card arrives.
 *
 * Motion follows the landing's existing approach: CSS transitions on opacity
 * and transform with the page's easing (cubic-bezier(0.16, 1, 0.3, 1), 0.6 s),
 * no animation library. The loop runs only while the section is on screen
 * (IntersectionObserver) and the tab is visible; it pauses otherwise. Every
 * element of the mock is always in the layout — only opacity and transforms
 * change, inside a fixed-size frame — so nothing on the page ever shifts.
 * prefers-reduced-motion: a complete, static conversation instead.
 *
 * Illustrative handles only (@yourbrand); no real account, no stats.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useAutoDmAvailability, comingSoonProps } from '@/lib/autodmAvailability';

// Step -> how long it stays before the next one (ms). See the list above.
const STEPS = [
  900, // 0  the reel and two earlier comments
  1400, // 1  "LINK" comment arrives
  1700, // 2  public reply
  1500, // 3  DM: the opening message with its button
  550, // 4  tap
  900, // 5  "Send me the link" (the tap, as Instagram shows it)
  1600, // 6  "Follow to unlock"
  550, // 7  tap
  1000, // 8  "I've followed"
  800, // 9  image
  3400, // 10 text + link card; hold, then loop
];
const LAST = STEPS.length - 1;
const DM_FROM = 3;

const BENEFITS = [
  ['Comment → DM', 'with your link, an image and text.'],
  ['Only followers get the link', 'with the optional follow gate.'],
  ['Hindi and Hinglish keywords', 'match too, not just English.'],
  ['No AI credits', 'are used by Auto DM replies.'],
];

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function subscribeVisibility(onChange) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** Server render and first paint: motion allowed, page visible. */
function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);
}

function usePageVisible() {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible', () => true);
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function AutoDmShowcase() {
  const available = useAutoDmAvailability();
  const reduced = usePrefersReducedMotion();
  const phoneRef = useRef(null);
  const viewportRef = useRef(null);
  const threadRef = useRef(null);
  const pageVisible = usePageVisible();
  const [inView, setInView] = useState(false);
  const [step, setStep] = useState(0);

  const shown = reduced ? LAST : step;
  const on = (n) => (shown >= n ? ' is-shown' : '');

  // Play only while the phone is on screen (the phone, not the section: on a
  // phone the stacked section is taller than the screen).
  useEffect(() => {
    const el = phoneRef.current;
    if (!el || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The loop: one timer per step, paused (not reset) while off screen.
  useEffect(() => {
    if (reduced || !inView || !pageVisible) return undefined;
    const t = setTimeout(() => setStep((s) => (s >= LAST ? 0 : s + 1)), STEPS[step]);
    return () => clearTimeout(t);
  }, [step, inView, pageVisible, reduced]);

  // Keep the newest DM in view, like a chat scrolling (a transform: no layout shift).
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const thread = threadRef.current;
    if (!viewport || !thread) return;
    const items = thread.querySelectorAll('[data-at]');
    let bottom = 0;
    items.forEach((node) => {
      if (Number(node.getAttribute('data-at')) <= shown) bottom = Math.max(bottom, node.offsetTop + node.offsetHeight);
    });
    thread.style.transform = `translateY(${-Math.max(0, bottom + 16 - viewport.clientHeight)}px)`;
  }, [shown]);

  const soon = comingSoonProps(available);
  const tapping = !reduced && (step === 4 || step === 7);

  return (
    <section className="autodm-section section-padding" id="auto-dm" aria-labelledby="autodm-title">
      <div className="section-container autodm-layout">
        <div className="autodm-copy autodm-reveal">
          <div className="autodm-eyebrow-row">
            <div className="section-eyebrow">
              <span className="eyebrow-dot" />
              <span>Auto DM</span>
            </div>
            <span {...soon}>Coming soon</span>
          </div>
          <h2 className="autodm-title" id="autodm-title">Turn every comment into a DM.</h2>
          <p className="autodm-sub">
            Ask people to comment a keyword on your post or reel. Siffty replies in their DMs with your link —
            once per person, through Instagram&apos;s official API — while your inbox keeps sorting itself.
          </p>
          <ul className="autodm-benefits">
            {BENEFITS.map(([strong, rest]) => (
              <li key={strong}>
                <span className="autodm-benefit-icon"><Check /></span>
                <span><strong>{strong}</strong> {rest}</span>
              </li>
            ))}
          </ul>
          <Link href="/register" className="btn-cta-primary autodm-cta">
            <span className="btn-text-roll">
              <span className="btn-text-track">
                <span className="btn-text-line">Start free trial</span>
                <span className="btn-text-line" aria-hidden="true">Start free trial</span>
              </span>
            </span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>

        <div className="autodm-demo autodm-reveal">
          <div
            ref={phoneRef}
            className={`autodm-phone${reduced ? ' is-static' : ''}`}
            role="img"
            aria-label="Example: someone comments LINK under a reel, gets a public reply, then a DM with a Send me the link button; after following, they receive an image and the link."
          >
            <div className="autodm-phone-bar" aria-hidden="true">
              <span className="autodm-phone-time">9:41</span>
              <span className="autodm-phone-notch" />
            </div>

            {/* Screen 1 — the reel and its comments */}
            <div className={`autodm-screen autodm-screen-post${shown >= DM_FROM ? ' is-away' : ''}`} aria-hidden="true">
              <div className="autodm-reel">
                <span className="autodm-reel-play" />
                <span className="autodm-reel-caption">@yourbrand · Comment LINK for the free guide</span>
              </div>
              <div className="autodm-comments">
                <div className="autodm-comments-title">Comments</div>
                <div className="autodm-comment">
                  <span className="autodm-avatar autodm-avatar-a" />
                  <p><b>@ria.creates</b> Saved this!</p>
                </div>
                <div className="autodm-comment">
                  <span className="autodm-avatar autodm-avatar-b" />
                  <p><b>@karan.fit</b> So useful</p>
                </div>
                <div className={`autodm-comment autodm-anim${on(1)}`}>
                  <span className="autodm-avatar autodm-avatar-you" />
                  <p><b>@you</b> LINK</p>
                </div>
                <div className={`autodm-comment autodm-comment-reply autodm-anim${on(2)}`}>
                  <span className="autodm-avatar autodm-avatar-brand" />
                  <p><b>@yourbrand</b> Sent you a DM!</p>
                </div>
              </div>
            </div>

            {/* Screen 2 — the DM thread */}
            <div className={`autodm-screen autodm-screen-dm${shown >= DM_FROM ? ' is-here' : ''}`} aria-hidden="true">
              <div className="autodm-dm-head">
                <span className="autodm-avatar autodm-avatar-brand" />
                <span className="autodm-dm-name">yourbrand</span>
              </div>
              <div className="autodm-dm-viewport" ref={viewportRef}>
                <div className="autodm-thread" ref={threadRef}>
                  <div className={`autodm-context autodm-anim${on(3)}`} data-at="3">Replied to your comment: LINK</div>
                  <div className={`autodm-bubble autodm-in autodm-anim${on(3)}`} data-at="3">
                    <p>Thanks for commenting! Tap below for the guide.</p>
                    <span className={`autodm-btn${step === 4 && !reduced ? ' is-pressed' : ''}`}>
                      Send me the link
                      {tapping && step === 4 && <span className="autodm-tap" />}
                    </span>
                  </div>
                  <div className={`autodm-bubble autodm-out autodm-anim${on(5)}`} data-at="5">Send me the link</div>
                  <div className={`autodm-bubble autodm-in autodm-anim${on(6)}`} data-at="6">
                    <p><b>Follow to unlock</b> the link, then tap below.</p>
                    <span className={`autodm-btn${step === 7 && !reduced ? ' is-pressed' : ''}`}>
                      I&apos;ve followed
                      {tapping && step === 7 && <span className="autodm-tap" />}
                    </span>
                  </div>
                  <div className={`autodm-bubble autodm-out autodm-anim${on(8)}`} data-at="8">I&apos;ve followed</div>
                  <div className={`autodm-image autodm-in autodm-anim${on(9)}`} data-at="9">
                    <span className="autodm-image-page" />
                    <span className="autodm-image-page autodm-image-page-back" />
                  </div>
                  <div className={`autodm-bubble autodm-in autodm-link-card autodm-anim${on(10)}`} data-at="10">
                    <p>Here&apos;s your free guide.</p>
                    <span className="autodm-link">
                      <span className="autodm-link-title">Open guide</span>
                      <span className="autodm-link-url">yourbrand.com/guide</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
