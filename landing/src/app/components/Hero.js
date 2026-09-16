import BrandLogo from './BrandLogo';
import { LABELS, MESSAGES, SECTIONS, TOAST, UNREAD_CALM } from './heroData';
import styles from './Hero.module.css';

/**
 * The landing hero.
 *
 * A HYBRID of two layers, and the split is the whole design:
 *
 *   Background — a looping cinematic video (supplied separately), which only
 *   ever has to set a mood. It is allowed to be soft, dark and out of focus.
 *
 *   Foreground — a product mockup drawn in DOM and CSS, which carries all the
 *   meaning. Real text nodes at real sizes, so the labels stay sharp at any
 *   resolution and legible at any width. This is why the mockup is not simply
 *   part of the video.
 *
 * Gate 1 renders the mockup's SETTLED state — sorted, labelled, spam already
 * gone, nothing unread. That is deliberate: Gate 2's animation resolves to
 * exactly this frame, so this markup doubles as the static state shown to
 * anyone with `prefers-reduced-motion: reduce`, rather than being a throwaway
 * placeholder that has to be rebuilt later.
 *
 * Server component on purpose — there is no state here yet, so nothing in
 * this file needs to reach the browser as JavaScript. Gate 2 adds 'use
 * client' when it adds the timeline.
 */

const SIGNUP_URL = 'https://app.siffty.com/register';

/** One conversation row. Two lines: who + label, then what + when. */
function InboxRow({ message }) {
  const label = LABELS[message.label];

  return (
    <li className={styles.row}>
      <span className={styles.avatar}>{message.initials}</span>

      <span className={styles.rowBody}>
        <span className={styles.rowLine}>
          <span className={styles.handle}>{message.handle}</span>
          <span className={`${styles.pill} ${styles[`pill_${label.tone}`]}`}>{label.label}</span>
        </span>

        <span className={styles.rowLine}>
          <span className={styles.preview}>{message.text}</span>
          <span className={styles.time}>{message.time}</span>
        </span>
      </span>
    </li>
  );
}

/**
 * The phone.
 *
 * `role="img"` with a single `aria-label` on the frame is deliberate. Without
 * it, a screen reader reads out seven invented handles and their messages as
 * though they were this visitor's actual inbox. The mockup is an illustration
 * of a product, so it is announced the way an illustration is: once, in a
 * sentence.
 *
 * The `aria-hidden` on the screen inside is NOT redundant with that, even
 * though the ARIA spec gives role="img" presentational children and a
 * conforming browser should prune the subtree on its own. Inspecting the
 * rendered tree showed the rows still present underneath, so the pruning is
 * not something to bet the whole mockup's accessibility on. The explicit
 * hide costs one attribute and makes the outcome the same everywhere; the
 * accessible name still comes from `aria-label`, which `aria-hidden` on a
 * descendant does not touch.
 */
function PhoneMockup() {
  return (
    <div
      className={styles.phone}
      role="img"
      aria-label="A phone showing an Instagram inbox after Siffty has sorted it: messages grouped under Leads, Questions and Brand deals, each tagged with a colour-coded label, spam removed, and nothing left unread."
    >
      <div className={styles.phoneScreen} aria-hidden="true">
        <div className={styles.appBar}>
          <span className={styles.appBarTitle}>Direct</span>
          <span className={styles.unread}>{UNREAD_CALM}</span>
        </div>

        <div className={styles.list}>
          {SECTIONS.map((section) => {
            const rows = MESSAGES.filter((m) => m.section === section);
            if (rows.length === 0) return null;

            return (
              <div className={styles.group} key={section}>
                {/*
                  A <p>, not an <h3>. These are labels drawn inside an
                  illustration, not structure in this document — and a real
                  heading here would jump the page from <h1> straight to <h3>
                  for anything auditing the raw DOM, for no benefit: the
                  role="img" frame keeps them out of the accessibility tree
                  either way.
                */}
                <p className={styles.groupHead}>{section}</p>
                <ul className={styles.rows}>
                  {rows.map((m) => (
                    <InboxRow message={m} key={m.id} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <p className={styles.toast}>
          <span className={styles.toastDot} />
          {TOAST}
        </p>
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-heading">
      {/*
        The video is decorative and carries no information the copy does not
        already state, so the whole layer is hidden from assistive tech.

        It degrades in three steps, and every step is a real state this will
        be in: video plays -> poster shows (files absent, or the browser
        refuses to autoplay) -> the section's own --hero-ink background shows
        (poster also absent). The poster is filled with that same colour, so
        the middle step is invisible.

        Gate 3 replaces the always-on <source> tags with the conditional load
        (mobile, save-data, reduced-motion get the poster only).
      */}
      <div className={styles.backdrop} aria-hidden="true">
        <video
          className={styles.video}
          poster="/hero/hero-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          tabIndex={-1}
        >
          <source src="/hero/hero-bg.webm" type="video/webm" />
          <source src="/hero/hero-bg.mp4" type="video/mp4" />
        </video>
        <div className={styles.scrim} />
      </div>

      <div className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.brand}>
            <BrandLogo size={32} />
            <span className={styles.wordmark}>Siffty</span>
          </p>

          <p className={styles.badge}>Instagram DMs, sorted and answered</p>

          <h1 className={styles.headline} id="hero-heading">
            Turn Instagram messages into paying customers.
          </h1>

          <p className={styles.sub}>
            Siffty reads every message, spots real leads, and replies to common questions — so you
            never miss a customer again.
          </p>

          <div className={styles.ctaRow}>
            {/*
              Absolute, not a next/link route: the marketing site lives on the
              apex (siffty.com) and the product lives on app.siffty.com, so
              "/register" would resolve to a page that does not exist here.
            */}
            <a className={`btn btn-primary btn-lg ${styles.primaryCta}`} href={SIGNUP_URL}>
              Start free trial
            </a>

            <a className={styles.secondaryCta} href="#how-it-works">
              See how it works
            </a>
          </div>

          <p className={styles.trust}>
            No card required · 3-day free trial starts when you connect Instagram
          </p>
        </div>

        <div className={styles.mockColumn}>
          <PhoneMockup />
        </div>
      </div>
    </section>
  );
}
