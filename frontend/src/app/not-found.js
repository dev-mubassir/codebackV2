import Link from 'next/link';
import PublicNavbar from '@/app/components/public/PublicNavbar';
import PublicFooter from '@/app/components/public/PublicFooter';
import styles from './error-pages.module.css';

export const metadata = {
  title: 'Page Not Found (404) — Siffty',
  description: 'The page or conversation thread you are looking for cannot be found. Return to your Siffty Instagram workspace.',
};

export default function NotFound() {
  return (
    <div className={styles.errorPageWrapper}>
      {/* Background Decorative Grid & Ambient Cones */}
      <div className={styles.bgGridOverlay} aria-hidden="true" />
      <div className={styles.ambientGlow} aria-hidden="true" />

      {/* Brand Navigation Bar */}
      <PublicNavbar />

      {/* Main 404 Hero Content */}
      <main className={styles.mainContainer}>
        {/* Status Eyebrow Badge */}
        <div className={styles.statusBadge}>
          <span className={styles.pulseDot} />
          <span>404 • Page Not Found</span>
        </div>

        {/* Large Aesthetic Numeric Indicator */}
        <div className={styles.errorCodeGraphic} aria-hidden="true">
          404
        </div>

        {/* Display Headline */}
        <h1 className={styles.errorHeadline}>
          Looking for a page that <span className={styles.highlightBlue}>doesn't exist?</span>
        </h1>

        {/* Subtitle Copy */}
        <p className={styles.errorSubtitle}>
          The link you followed might be broken, or this page may have been moved.
          Don't worry — your Instagram connections, smart DM classifications, and AI reply rules remain completely safe and active.
        </p>

        {/* Primary Action Buttons */}
        <div className={styles.ctaButtonGroup}>
          <Link href="/dashboard" className={styles.btnPrimary} id="btn-404-dashboard">
            <span>Go to Dashboard</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>

          <Link href="/" className={styles.btnSecondary} id="btn-404-home">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span>Back to Home</span>
          </Link>

          <Link href="/support" className={styles.btnSecondary} id="btn-404-support">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Get Help</span>
          </Link>
        </div>

        {/* Quick Navigation Bento Grid */}
        <section className={styles.quickLinksSection} aria-label="Helpful platform shortcuts">
          <h2 className={styles.quickLinksTitle}>Quick Platform Shortcuts</h2>
          <div className={styles.quickLinksGrid}>
            <Link href="/dashboard" className={styles.quickLinkCard}>
              <div className={styles.cardIconBox}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="9" />
                  <rect x="14" y="3" width="7" height="5" />
                  <rect x="14" y="12" width="7" height="9" />
                  <rect x="3" y="16" width="7" height="5" />
                </svg>
              </div>
              <h3 className={styles.cardTitle}>Dashboard</h3>
              <p className={styles.cardDesc}>View your live DM metrics, response counts, and active accounts.</p>
            </Link>

            <Link href="/inbox" className={styles.quickLinkCard}>
              <div className={styles.cardIconBox}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <h3 className={styles.cardTitle}>Smart Inbox</h3>
              <p className={styles.cardDesc}>Browse prioritized Instagram threads and high-intent buyer leads.</p>
            </Link>

            <Link href="/how-to-use" className={styles.quickLinkCard}>
              <div className={styles.cardIconBox}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="10 8 16 12 10 16 10 8" />
                </svg>
              </div>
              <h3 className={styles.cardTitle}>How Siffty Works</h3>
              <p className={styles.cardDesc}>Review our step-by-step account setup and knowledge base guide.</p>
            </Link>

            <Link href="/billing" className={styles.quickLinkCard}>
              <div className={styles.cardIconBox}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
              </div>
              <h3 className={styles.cardTitle}>Billing & Plans</h3>
              <p className={styles.cardDesc}>Manage subscription tiers, rollover replies, and quota usage.</p>
            </Link>
          </div>
        </section>
      </main>

      {/* Global Siffty Footer */}
      <PublicFooter />
    </div>
  );
}
