'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getMe } from '@/lib/api';
import styles from './page.module.css';

export default function LandingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getMe()
      .then((user) => {
        if (!user.onboardingCompleted) {
          router.push('/onboarding');
        } else {
          router.push('/dashboard');
        }
      })
      .catch(() => {
        setChecking(false);
      });
  }, [router]);

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
            <span style={{ fontSize: '20px' }}>⚡</span>
          </div>
          <span className={styles.topNavName}>Codeback</span>
        </div>
        <div className={styles.topNavLinks}>
          <a href="#features" className={styles.topNavLink}>Features</a>
          <a href="#how-it-works" className={styles.topNavLink}>How it Works</a>
          <Link href="/login" className="btn btn-secondary btn-sm" id="landing-login-btn">
            Sign In
          </Link>
          <Link href="/register" className={`btn btn-primary ${styles.topNavCta}`} id="landing-register-btn">
            Start Free Trial →
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            AI Customer Intelligence & Lead Qualification
          </div>
          <h1 className={styles.heroTitle}>
            Turn Instagram DMs into<br />
            <span className={styles.heroAccent}>Revenue & Happy Clients.</span>
          </h1>
          <p className={styles.heroDescription}>
            For Video Editors, Product Sellers, Agencies, Freelancers & Creators. Codeback grounds AI in your real business facts to qualify hot leads, block scams, and safely auto-reply 24/7.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '20px' }}>
            <Link href="/register" className="btn btn-primary btn-lg" id="hero-get-started-btn">
              Get Started for Free →
            </Link>
            <Link href="/login" className="btn btn-secondary btn-lg" id="hero-signin-btn">
              Sign In
            </Link>
          </div>

          <div className={styles.heroStats}>
            <div className={styles.heroStat}>
              <span className={styles.statValue}>100%</span>
              <span className={styles.statLabel}>Anti-Hallucination Grounding</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.heroStat}>
              <span className={styles.statValue}>&lt; 2s</span>
              <span className={styles.statLabel}>Lead Intent Classification</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.heroStat}>
              <span className={styles.statValue}>24/7</span>
              <span className={styles.statLabel}>Intelligent Safe Auto-Reply</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className={styles.features} id="features">
        <h2 className={styles.sectionTitle}>Engineered for Real Businesses</h2>
        <p className={styles.sectionSubtitle}>
          Everything you need to convert Instagram conversations into loyal paying customers.
        </p>

        <div className={styles.featureGrid}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🏢</div>
            <h3 className={styles.featureTitle}>Business Knowledge Base</h3>
            <p className={styles.featureDesc}>
              Train your AI on your exact pricing, packages, turnaround times, and FAQs. AI never invents facts or makes unauthorized promises.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🎯</div>
            <h3 className={styles.featureTitle}>Lead Qualification & Scoring</h3>
            <p className={styles.featureDesc}>
              Instantly identify Hot Leads, Potential Buyers, and Returning Customers. Automatically prioritizes revenue-generating messages at the top of your inbox.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🛡️</div>
            <h3 className={styles.featureTitle}>Scam & Risk Gatekeeper</h3>
            <p className={styles.featureDesc}>
              Detect phishing links, password/OTP requests, fake payment proof, and spam. High-risk conversations are flagged and prevented from receiving automated replies.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>⚡</div>
            <h3 className={styles.featureTitle}>Per-Chat Intelligent Auto-Reply</h3>
            <p className={styles.featureDesc}>
              Enable safe 24/7 auto-reply for specific customers or conversations. AI answers questions using your verified pricing and business rules.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>👤</div>
            <h3 className={styles.featureTitle}>Human Escalation Engine</h3>
            <p className={styles.featureDesc}>
              Frustrated customers, custom requests, and complex negotiations are automatically escalated to you with a summary of what the customer needs.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🔒</div>
            <h3 className={styles.featureTitle}>Enterprise-Grade Privacy</h3>
            <p className={styles.featureDesc}>
              Strict tenant isolation, AES-256-GCM encrypted tokens, and HMAC-SHA256 validated webhooks keep your Instagram data protected.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <div className={styles.footerBrand}>
            <div className={styles.footerLogo}>⚡</div>
            <span className={styles.footerName}>Codeback</span>
          </div>
          <p className={styles.footerCopy}>
            &copy; {new Date().getFullYear()} Codeback. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
