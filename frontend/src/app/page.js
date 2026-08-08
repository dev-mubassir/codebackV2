'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getInstagramAuthUrl } from '@/lib/api';
import styles from './page.module.css';

/**
 * Landing page — the first thing users see.
 * Shows a hero with the "Connect with Instagram" CTA.
 * If user is already logged in, redirects to dashboard.
 */
export default function LandingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState(null);

  // Check if user is already logged in
  useEffect(() => {
    getMe()
      .then(() => {
        // Already logged in → go to dashboard
        router.push('/dashboard');
      })
      .catch(() => {
        // Not logged in → show landing page
        setChecking(false);
      });

    // Check for OAuth error in URL params
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
      setError('Instagram connection failed. Please try again.');
    }
  }, [router]);

  if (checking) {
    return (
      <div className={styles.loadingScreen}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className={styles.landing}>
      {/* Background gradient orbs */}
      <div className={styles.bgOrb1} />
      <div className={styles.bgOrb2} />
      <div className={styles.bgOrb3} />

      <main className={styles.hero}>
        {/* Logo */}
        <div className={styles.logoContainer}>
          <div className={styles.logoIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h1 className={styles.logoText}>Codeback</h1>
        </div>

        <p className={styles.tagline}>
          Your Instagram DM inbox,<br />
          <span className={styles.taglineAccent}>beautifully managed.</span>
        </p>

        <p className={styles.description}>
          Connect your Instagram Professional account and manage all your
          Direct Messages from one unified inbox. Real-time updates, instant replies.
        </p>

        {error && (
          <div className={styles.errorBanner}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
          </div>
        )}

        <a href={getInstagramAuthUrl()} className={`btn btn-primary btn-lg ${styles.ctaButton}`} id="connect-instagram-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
          </svg>
          Connect with Instagram
        </a>

        <p className={styles.note}>
          Works with Professional accounts (Business or Creator)
        </p>

        {/* Feature cards */}
        <div className={styles.features}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📩</div>
            <h3>Real-time DMs</h3>
            <p>Messages appear instantly via webhooks — no refreshing needed.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>💬</div>
            <h3>Quick Replies</h3>
            <p>Reply directly from the inbox. Clean chat interface.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🔒</div>
            <h3>Secure & Private</h3>
            <p>Uses official Instagram API. Your data stays on your server.</p>
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <span>Codeback — Testing Version</span>
      </footer>
    </div>
  );
}
