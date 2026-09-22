import Link from 'next/link';
import PublicNavbar from '@/app/components/public/PublicNavbar';
import PublicFooter from '@/app/components/public/PublicFooter';
import PublicHero from '@/app/components/public/PublicHero';
import { meta, legal, support } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '@/app/components/public/public.module.css';

export const metadata = {
  title: meta.support.title,
  description: meta.support.description,
};

export default function SupportPage() {
  return (
    <div className={styles.publicPage}>
      {/* Decorative Grid Overlay */}
      <div className={styles.bgGridOverlay} aria-hidden="true" />

      {/* Navbar */}
      <PublicNavbar />

      {/* Hero */}
      <PublicHero
        eyebrow="SUPPORT HUB"
        title={legal.supportTitle}
        subtitle={support.intro}
        badgeText={support.replyTime}
        breadcrumbCategory="Resources"
        breadcrumbCurrent="Support"
      />

      <main className={styles.narrowContainer}>
        {/* Support Channel Cards */}
        <div className={styles.cardsGrid}>
          {/* Channel 1: Email */}
          <div className={styles.featureCard}>
            <div className={styles.cardIconBox}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <div>
              <h3 className={styles.cardSubTitle}>Direct Email</h3>
              <p className={styles.cardDesc} style={{ marginTop: '6px' }}>
                Reach our support team directly. A person reads every email.
              </p>
            </div>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className={styles.btnPillPrimary}
              style={{ marginTop: 'auto', textAlign: 'center', justifyContent: 'center' }}
            >
              <span>Email {SUPPORT_EMAIL}</span>
            </a>
          </div>

          {/* Channel 2: Contact Form */}
          <div className={styles.featureCard}>
            <div className={styles.cardIconBox}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <h3 className={styles.cardSubTitle}>Web Enquiry Form</h3>
              <p className={styles.cardDesc} style={{ marginTop: '6px' }}>
                Submit a structured inquiry for general help or enterprise setups.
              </p>
            </div>
            <Link
              href="/contact"
              className={styles.btnPillSecondary}
              style={{ marginTop: 'auto', textAlign: 'center', justifyContent: 'center' }}
            >
              <span>{support.formLink}</span>
            </Link>
          </div>

          {/* Channel 3: How to Use */}
          <div className={styles.featureCard}>
            <div className={styles.cardIconBox}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                <path d="M6 6h10" />
                <path d="M6 10h10" />
              </svg>
            </div>
            <div>
              <h3 className={styles.cardSubTitle}>How to Use Siffty</h3>
              <p className={styles.cardDesc} style={{ marginTop: '6px' }}>
                Follow our step-by-step guide to connect Instagram, set up your knowledge base, and manage replies.
              </p>
            </div>
            <Link
              href="/how-to-use"
              className={styles.btnPillSecondary}
              style={{ marginTop: 'auto', textAlign: 'center', justifyContent: 'center' }}
            >
              <span>Step-by-Step Guide</span>
            </Link>
          </div>
        </div>

        {/* What to Include Callout Card */}
        <div className={styles.contentCard} style={{ marginTop: '24px' }}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4169e1" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {support.whatToInclude.title}
            </h2>
          </div>
          <div className={styles.cardBody}>
            <p>
              To help us resolve your issue as quickly as possible, please include the following in your message:
            </p>
            <ul>
              {support.whatToInclude.items.map((item) => (
                <li key={item}><strong>{item}</strong></li>
              ))}
            </ul>
            <div className={styles.calloutBox}>
              <p>
                <strong>Response Promise:</strong> {support.replyTime}
              </p>
            </div>
          </div>
        </div>

        {/* Common Help Topics */}
        <div className={styles.contentCard} style={{ marginTop: '24px' }}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4169e1" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <path d="9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              {support.helpTitle}
            </h2>
          </div>
          <div className={styles.cardBody}>
            {support.entries.map((entry) => (
              <div key={entry.title} style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid #f0f0f2' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '1.05rem', color: '#0c0c0e' }}>{entry.title}</h3>
                <p style={{ margin: 0, color: '#4b5563', lineHeight: '1.6' }}>
                  {entry.body}
                  {entry.href && (
                    <>
                      {' '}
                      <Link href={entry.href} style={{ color: '#4169e1', textDecoration: 'underline' }}>
                        {entry.linkText}
                      </Link>
                      .
                    </>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Quick Links */}
        <nav className={styles.legalFooterNav} aria-label="Support and Legal Navigation">
          <Link href="/privacy" className={styles.legalFooterLink}>{legal.footerLinks.privacy}</Link>
          <Link href="/terms" className={styles.legalFooterLink}>{legal.footerLinks.terms}</Link>
          <Link href="/data-deletion" className={styles.legalFooterLink}>{legal.footerLinks.dataDeletion}</Link>
          <Link href="/support" className={styles.legalFooterLink}>{legal.footerLinks.support}</Link>
          <Link href="/contact" className={styles.legalFooterLink}>{legal.footerLinks.contact}</Link>
          <Link href="/refund-policy" className={styles.legalFooterLink}>{legal.footerLinks.refundPolicy}</Link>
        </nav>
      </main>

      {/* Footer */}
      <PublicFooter />
    </div>
  );
}
