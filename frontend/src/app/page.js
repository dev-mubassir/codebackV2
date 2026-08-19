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

  function handleConnect(e) {
    e.preventDefault();
    // Programmatic navigation prevents mobile OS from intercepting universal links into the native app
    window.location.href = getInstagramAuthUrl();
  }

  if (checking) {
    return (
      <div className={styles.loadingScreen}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <div className={styles.landing}>
      {/* Navigation */}
      <nav className={styles.topNav}>
        <div className={styles.topNavBrand}>
          <div className={styles.topNavLogo}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <span className={styles.topNavName}>Codeback</span>
        </div>
        <div className={styles.topNavLinks}>
          <a href="#features" className={styles.topNavLink}>Features</a>
          <a href="#how-it-works" className={styles.topNavLink}>How it Works</a>
          <a href="#security" className={styles.topNavLink}>Security</a>
          <a
            href={getInstagramAuthUrl()}
            onClick={handleConnect}
            className={`btn btn-primary ${styles.topNavCta}`}
            id="connect-instagram-nav-btn"
          >
            Get Started
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            AI-Powered Instagram DM Management
          </div>
          <h1 className={styles.heroTitle}>
            Your Instagram DMs,<br />
            <span className={styles.heroAccent}>intelligently managed.</span>
          </h1>
          <p className={styles.heroDescription}>
            Connect your Instagram Professional account and let AI classify, prioritize,
            and draft replies for your Direct Messages. Focus on what matters — let Codeback handle the rest.
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

          <div className={styles.heroCtas}>
            <a
              href={getInstagramAuthUrl()}
              onClick={handleConnect}
              className={`btn btn-primary btn-lg ${styles.heroBtn}`}
              id="connect-instagram-btn"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
              </svg>
              Connect with Instagram
            </a>
            <a href="#features" className={`btn btn-secondary btn-lg ${styles.heroBtn}`}>
              Learn More
            </a>
          </div>

          <p className={styles.heroNote}>
            Works with Professional accounts (Business or Creator). Free to get started.
          </p>
          <p className={styles.mobileHint}>
            📱 <strong>Mobile Note:</strong> If your phone asks to open the Instagram app, choose <em>&quot;Open in Browser&quot;</em> (Chrome / Safari) to complete authorization in your browser.
          </p>
        </div>

        <div className={styles.heroVisual}>
          <div className={styles.mockupWindow}>
            <div className={styles.mockupDots}>
              <span /><span /><span />
            </div>
            <div className={styles.mockupContent}>
              <div className={styles.mockupSidebar}>
                <div className={`${styles.mockupItem} ${styles.mockupItemActive}`}>
                  <div className={styles.mockupAvatar} />
                  <div className={styles.mockupLines}><span style={{ width: '70%' }} /><span style={{ width: '90%' }} /></div>
                </div>
                <div className={styles.mockupItem}>
                  <div className={styles.mockupAvatar} />
                  <div className={styles.mockupLines}><span style={{ width: '60%' }} /><span style={{ width: '80%' }} /></div>
                </div>
                <div className={styles.mockupItem}>
                  <div className={styles.mockupAvatar} />
                  <div className={styles.mockupLines}><span style={{ width: '75%' }} /><span style={{ width: '50%' }} /></div>
                </div>
              </div>
              <div className={styles.mockupChat}>
                <div className={styles.mockupBubbleIn}>Hey! Love your content 🔥</div>
                <div className={styles.mockupBubbleIn}>Would you be interested in a collab?</div>
                <div className={styles.mockupBubbleOut}>Thanks! Tell me more about the project</div>
                <div className={styles.mockupAiBadge}>✨ AI classified: Brand Deal</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={styles.features} id="features">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Everything you need to manage DMs at scale</h2>
          <p className={styles.sectionSubtitle}>AI-powered tools that help creators and businesses respond faster and never miss an opportunity.</p>
        </div>

        <div className={styles.featureGrid}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📥</div>
            <h3 className={styles.featureTitle}>Real-time Inbox</h3>
            <p className={styles.featureDesc}>Messages appear instantly via webhooks. No refreshing needed — your inbox stays current automatically.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🤖</div>
            <h3 className={styles.featureTitle}>AI Classification</h3>
            <p className={styles.featureDesc}>Every message is automatically categorized — brand deals, collaborations, customers, fans, questions, or spam.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🔥</div>
            <h3 className={styles.featureTitle}>Brand Deal Detection</h3>
            <p className={styles.featureDesc}>AI extracts brand names, budgets, deliverables, and deadlines from sponsorship inquiries automatically.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>✨</div>
            <h3 className={styles.featureTitle}>AI-Drafted Replies</h3>
            <p className={styles.featureDesc}>Generate professional replies that match your voice. Review and edit before sending — nothing is ever sent automatically.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📊</div>
            <h3 className={styles.featureTitle}>Priority Dashboard</h3>
            <p className={styles.featureDesc}>See what needs your attention first. AI scores conversations by importance so you never miss a high-value opportunity.</p>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🔒</div>
            <h3 className={styles.featureTitle}>Enterprise Security</h3>
            <p className={styles.featureDesc}>AES-256-GCM encrypted tokens, official Instagram API only, no data sharing. Your messages stay private.</p>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className={styles.howItWorks} id="how-it-works">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>How it works</h2>
          <p className={styles.sectionSubtitle}>Three simple steps to transform your Instagram DM workflow.</p>
        </div>

        <div className={styles.stepsGrid}>
          <div className={styles.step}>
            <div className={styles.stepNumber}>1</div>
            <h3 className={styles.stepTitle}>Connect Instagram</h3>
            <p className={styles.stepDesc}>Link your Professional account via official Instagram OAuth. Takes 30 seconds.</p>
          </div>
          <div className={styles.stepArrow}>→</div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>2</div>
            <h3 className={styles.stepTitle}>AI Processes DMs</h3>
            <p className={styles.stepDesc}>Incoming messages are classified, prioritized, and summarized automatically in the background.</p>
          </div>
          <div className={styles.stepArrow}>→</div>
          <div className={styles.step}>
            <div className={styles.stepNumber}>3</div>
            <h3 className={styles.stepTitle}>You Respond</h3>
            <p className={styles.stepDesc}>Review AI insights, generate draft replies, and send when ready. You stay in control.</p>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section className={styles.security} id="security">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Built with security first</h2>
          <p className={styles.sectionSubtitle}>Your data is protected with industry-standard encryption and best practices.</p>
        </div>

        <div className={styles.securityGrid}>
          <div className={styles.securityItem}>
            <span className={styles.securityIcon}>🔐</span>
            <div>
              <strong>AES-256-GCM Encryption</strong>
              <p>All Instagram tokens are encrypted at rest with military-grade encryption.</p>
            </div>
          </div>
          <div className={styles.securityItem}>
            <span className={styles.securityIcon}>✅</span>
            <div>
              <strong>Official Instagram API</strong>
              <p>We only use Meta&apos;s official Graph API — no scraping, no unauthorized access.</p>
            </div>
          </div>
          <div className={styles.securityItem}>
            <span className={styles.securityIcon}>🛡️</span>
            <div>
              <strong>Webhook Signature Verification</strong>
              <p>Every incoming webhook is cryptographically verified to prevent tampering.</p>
            </div>
          </div>
          <div className={styles.securityItem}>
            <span className={styles.securityIcon}>🚫</span>
            <div>
              <strong>No Data Sharing</strong>
              <p>Your messages are never sold, shared, or used for training. Your data stays yours.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className={styles.ctaSection}>
        <h2 className={styles.ctaTitle}>Ready to transform your Instagram DMs?</h2>
        <p className={styles.ctaSubtitle}>Connect your account and start managing messages intelligently in minutes.</p>
        <a
          href={getInstagramAuthUrl()}
          onClick={handleConnect}
          className={`btn btn-primary btn-lg ${styles.heroBtn}`}
          id="connect-instagram-bottom-btn"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
          </svg>
          Get Started Free
        </a>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <div className={styles.footerBrand}>
            <div className={styles.topNavLogo}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <span>Codeback</span>
          </div>
          <span className={styles.footerCopy}>© {new Date().getFullYear()} Codeback. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
