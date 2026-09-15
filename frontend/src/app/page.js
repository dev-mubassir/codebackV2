'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMe } from '@/lib/api';
import Icon from '@/app/components/Icon';
import PricingSection from '@/app/components/pricing/PricingSection';
import { marketing, auth, common, errors } from '@/content/copy';
import styles from './page.module.css';

/** Paired by position with marketing.features.items in content/copy.js. */
const FEATURE_ICONS = ['briefcase', 'target', 'shield', 'sparkle', 'user', 'lock'];

function LandingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(true);
  const [oauthError, setOauthError] = useState('');

  useEffect(() => {
    const errorCode = searchParams.get('error');
    if (errorCode) {
      // Surface the failure instead of silently redirecting past it — even
      // a logged-in user gets swept to /dashboard by the getMe() check
      // below, so skip it here and strip the param so a refresh doesn't
      // re-show the message.
      setOauthError(errors.oauthCallback[errorCode] || errors.oauthCallback.generic);
      window.history.replaceState(null, '', window.location.pathname);
      setChecking(false);
      return;
    }

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
  }, [router, searchParams]);

  if (checking) {
    return (
      <div className={styles.loadingScreen} aria-busy="true" aria-label={common.loading}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <div className={styles.landing}>
      {oauthError && (
        <div className={styles.oauthErrorBanner} role="alert">
          <Icon name="alertTriangle" size={14} />
          <span>{oauthError}</span>
        </div>
      )}

      {/* Navigation */}
      <nav className={styles.topNav}>
        <div className={styles.topNavBrand}>
          <div className={styles.topNavLogo}>
            <img src="/logo.png" alt="" className={styles.brandLogoImg} />
          </div>
          <span className={styles.topNavName}>Siffty</span>
        </div>
        <div className={styles.topNavLinks}>
          <a href="#features" className={styles.topNavLink}>Features</a>
          <Link href="/login" className="btn btn-secondary btn-sm" id="landing-login-btn">
            {auth.login.submit}
          </Link>
          <Link href="/register" className={`btn btn-primary btn-sm ${styles.topNavCta}`} id="landing-register-btn">
            {auth.register.submit}
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            {marketing.hero.badge}
          </div>
          <h1 className={styles.heroTitle}>
            {marketing.hero.titleLine1}<br />
            <span className={styles.heroAccent}>{marketing.hero.titleAccent}</span>
          </h1>
          <p className={styles.heroDescription}>{marketing.hero.description}</p>

          <div className={styles.heroCtas}>
            <Link href="/register" className="btn btn-primary btn-lg" id="hero-get-started-btn">
              {marketing.hero.primaryCta}
            </Link>
            <Link href="/login" className="btn btn-secondary btn-lg" id="hero-signin-btn">
              {marketing.hero.secondaryCta}
            </Link>
          </div>

          {/* These were "100% Anti-Hallucination Grounding", "< 2s Lead Intent
              Classification", and "24/7 Intelligent Safe Auto-Reply" — three
              hardcoded figures presented as measurements, none of which the
              product measures or can support. They now state plainly what the
              product does, with no number implied to be data. */}
          <div className={styles.heroStats}>
            {marketing.stats.map((stat, idx) => (
              <div key={stat.value} style={{ display: 'contents' }}>
                {idx > 0 && <div className={styles.statDivider} />}
                <div className={styles.heroStat}>
                  <span className={styles.statValue}>{stat.value}</span>
                  <span className={styles.statLabel}>{stat.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Hero Interactive Mockup Preview */}
        <div className={styles.mockupWrapper}>
          <div className={styles.mockupHeader}>
            <span className={styles.mockupDot} style={{ background: 'var(--color-error)' }} />
            <span className={styles.mockupDot} style={{ background: 'var(--color-warning)' }} />
            <span className={styles.mockupDot} style={{ background: 'var(--color-success)' }} />
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginLeft: '8px', fontWeight: 600 }}>
              {common.productName}
            </span>
          </div>
          <div className={styles.mockupBody}>
            <div className={styles.mockupList}>
              <div className={`${styles.mockupListItem} ${styles.mockupListItemActive}`}>
                <div className={styles.mockupAvatar}>S</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>@sarah_creator</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>&ldquo;Need 10 reels edited...&rdquo;</span>
                </div>
              </div>
              <div className={styles.mockupListItem}>
                <div className={styles.mockupAvatar} style={{ background: 'var(--color-success)' }}>R</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>@rahul_agency</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>&ldquo;What is your pricing?&rdquo;</span>
                </div>
              </div>
            </div>
            <div className={styles.mockupChat}>
              <div className={styles.mockupAiSummary}>
                Summary: asking about the price of a ten-reel monthly pack.
              </div>
              <div className={styles.mockupMsgIn}>
                Hey! Love your edits. How much for a 10-Reel monthly package with 48h turnaround?
              </div>
              <div className={styles.mockupMsgOut}>
                Hi Sarah — the ten-reel monthly pack is INR 7,500, delivered in 48 hours with two rounds of revisions. Can you share the footage link?
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className={styles.features} id="features">
        <h2 className={styles.sectionTitle}>{marketing.features.title}</h2>
        <p className={styles.sectionSubtitle}>{marketing.features.subtitle}</p>

        <div className={styles.featureGrid}>
          {marketing.features.items.map((item, idx) => (
            <div key={item.title} className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <Icon name={FEATURE_ICONS[idx]} size={22} strokeWidth={1.75} />
              </div>
              <h3 className={styles.featureTitle}>{item.title}</h3>
              <p className={styles.featureDesc}>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing. Renders nothing at all while BILLING_ENABLED is off — the
          plans endpoint 404s and the section returns null — so the homepage
          is unchanged until the flag flips. See components/pricing. */}
      <PricingSection />

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <div className={styles.footerBrand}>
            <div className={styles.footerLogo}>
              <img src="/logo.png" alt="" className={styles.footerLogoImg} />
            </div>
            <span className={styles.footerName}>Siffty</span>
          </div>
          {/* Meta App Review requires the privacy policy and data deletion
              URLs to be publicly reachable without logging in. */}
          <nav className={styles.footerLinks} aria-label="Legal">
            <a href="/privacy" className={styles.footerLink}>{marketing.footer.privacy}</a>
            <a href="/terms" className={styles.footerLink}>{marketing.footer.terms}</a>
            <a href="/data-deletion" className={styles.footerLink}>{marketing.footer.dataDeletion}</a>
            <a href="/support" className={styles.footerLink}>{marketing.footer.support}</a>
            <a href="/contact" className={styles.footerLink}>{marketing.footer.contact}</a>
          </nav>
          <p className={styles.footerCopy}>
            &copy; {new Date().getFullYear()} {common.productName}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense fallback={
      <div className={styles.loadingScreen} aria-busy="true" aria-label={common.loading}>
        <div className="spinner spinner-lg" />
      </div>
    }>
      <LandingPageContent />
    </Suspense>
  );
}
