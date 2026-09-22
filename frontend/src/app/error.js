'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PublicNavbar from '@/app/components/public/PublicNavbar';
import PublicFooter from '@/app/components/public/PublicFooter';
import styles from './error-pages.module.css';

/**
 * Route-level error boundary. Shows aesthetic recovery screen instead of an unstyled
 * stack trace. Logs to console for debugging and prevents unhandled leaks.
 */
export default function GlobalError({ error, reset }) {
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.error('[Siffty] Unhandled application error caught by boundary:', error);
    }
  }, [error]);

  const handleRetry = () => {
    setIsRetrying(true);
    try {
      reset();
    } finally {
      setTimeout(() => setIsRetrying(false), 1200);
    }
  };

  return (
    <div className={styles.errorPageWrapper}>
      {/* Background Decorative Grid & Ambient Cones */}
      <div className={styles.bgGridOverlay} aria-hidden="true" />
      <div className={styles.ambientGlowWarning} aria-hidden="true" />

      {/* Brand Navigation Bar */}
      <PublicNavbar />

      {/* Main Error Hero Content */}
      <main className={styles.mainContainer}>
        {/* Status Eyebrow Badge */}
        <div className={[styles.statusBadge, styles.statusBadgeWarning].join(' ')}>
          <span className={[styles.pulseDot, styles.pulseDotWarning].join(' ')} />
          <span>500 • System Safety Intercept</span>
        </div>

        {/* Large Aesthetic Numeric Indicator */}
        <div className={[styles.errorCodeGraphic, styles.errorCodeGraphicWarning].join(' ')} aria-hidden="true">
          500
        </div>

        {/* Display Headline */}
        <h1 className={styles.errorHeadline}>
          Something unexpected <span className={styles.highlightAmber}>interrupted this request</span>
        </h1>

        {/* Subtitle Copy */}
        <p className={styles.errorSubtitle}>
          Our fail-closed safety systems caught an unhandled exception before it could affect your data.
          Your Instagram Graph API connection and active automation rules remain safe.
        </p>

        {/* Safety Intercept Banner */}
        <div className={styles.safetyCard} role="status">
          <div className={styles.safetyIconBox}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <h4 className={styles.safetyTextTitle}>Fail-Closed Protection Active</h4>
            <p className={styles.safetyTextBody}>
              No unintended auto-replies were sent, and your credentials and webhook queues are safely paused.
            </p>
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className={styles.ctaButtonGroup}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleRetry}
            disabled={isRetrying}
            id="btn-error-retry"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              style={{ transform: isRetrying ? 'rotate(360deg)' : 'none', transition: 'transform 0.6s ease' }}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>{isRetrying ? 'Attempting Recovery...' : 'Try Again'}</span>
          </button>

          <Link href="/dashboard" className={styles.btnSecondary} id="btn-error-dashboard">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
            <span>Go to Dashboard</span>
          </Link>

          <Link href="/support" className={styles.btnSecondary} id="btn-error-support">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Contact Support</span>
          </Link>
        </div>

        {/* Optional Expandable Technical Details */}
        {Boolean(error) && (
          <details className={styles.devDetails}>
            <summary className={styles.devSummary}>Technical Details (Error Reference)</summary>
            <pre className={styles.devCode}>
              {error?.message || 'Unknown runtime error'}
              {error?.digest ? '\nDigest ID: ' + error.digest : ''}
            </pre>
          </details>
        )}

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
              <p className={styles.cardDesc}>Return to your DM metrics, response counts, and active accounts.</p>
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

            <Link href="/support" className={styles.quickLinkCard}>
              <div className={styles.cardIconBox}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 className={styles.cardTitle}>Support Ticket</h3>
              <p className={styles.cardDesc}>If this issue persists, let our engineering team assist you.</p>
            </Link>
          </div>
        </section>
      </main>

      {/* Global Siffty Footer */}
      <PublicFooter />
    </div>
  );
}
