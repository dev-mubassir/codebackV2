import Link from 'next/link';
import PublicNavbar from '@/app/components/public/PublicNavbar';
import PublicFooter from '@/app/components/public/PublicFooter';
import PublicHero from '@/app/components/public/PublicHero';
import { meta, legal, support, contactPage } from '@/content/copy';
import { SUPPORT_EMAIL, BUSINESS_NAME, BUSINESS_CITY, BUSINESS_COUNTRY } from '@/content/contact';
import styles from '@/app/components/public/public.module.css';
import ContactForm from './ContactForm';

export const metadata = {
  title: meta.contact.title,
  description: meta.contact.description,
};

export default function ContactPage() {
  const place = BUSINESS_CITY ? `${BUSINESS_CITY}, ${BUSINESS_COUNTRY}` : BUSINESS_COUNTRY;

  return (
    <div className={styles.publicPage}>
      {/* Decorative Grid Overlay */}
      <div className={styles.bgGridOverlay} aria-hidden="true" />

      {/* Navbar */}
      <PublicNavbar />

      {/* Hero */}
      <PublicHero
        eyebrow="RESOURCES"
        title={contactPage.title}
        subtitle={contactPage.intro}
        badgeText={support.replyTime}
        breadcrumbCategory="Resources"
        breadcrumbCurrent="Contact"
      />

      <main className={styles.container}>
        <div className={styles.contactGrid}>
          {/* Left Column: Contact details & Enterprise banner */}
          <div className={styles.contactInfoCard}>
            {/* Email info */}
            <div className={styles.contactInfoItem}>
              <div className={styles.cardIconBox}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </div>
              <div className={styles.contactInfoText}>
                <h4>{contactPage.emailTitle}</h4>
                <p>
                  {contactPage.emailLead}{' '}
                  <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#4169e1', fontWeight: 600 }}>
                    {SUPPORT_EMAIL}
                  </a>
                </p>
                <p style={{ marginTop: '4px', fontSize: '0.84rem', color: '#71717a' }}>
                  {support.replyTime}
                </p>
              </div>
            </div>

            {/* Enterprise inquiry info */}
            <div className={styles.contactInfoItem}>
              <div className={styles.cardIconBox}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
                  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
                  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
                  <path d="M10 6h4" />
                  <path d="M10 10h4" />
                  <path d="M10 14h4" />
                  <path d="M10 18h4" />
                </svg>
              </div>
              <div className={styles.contactInfoText}>
                <h4>{contactPage.enterpriseTitle}</h4>
                <p>{contactPage.enterpriseBody}</p>
                <p style={{ marginTop: '6px' }}>
                  <Link href="/contact/enterprise" className={styles.btnPillSecondary} style={{ fontSize: '0.84rem', padding: '6px 14px' }}>
                    <span>{contactPage.enterpriseLink}</span>
                  </Link>
                </p>
              </div>
            </div>

            {/* Who we are */}
            <div className={styles.contactInfoItem}>
              <div className={styles.cardIconBox}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <div className={styles.contactInfoText}>
                <h4>{contactPage.whoTitle}</h4>
                <p>{BUSINESS_NAME}, {place}.</p>
              </div>
            </div>
          </div>

          {/* Right Column: Contact Form */}
          <div className={styles.formCard}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <span className={styles.sectionNumber}>✉</span>
                {contactPage.formTitle}
              </h2>
            </div>
            <ContactForm kind="support" supportEmail={SUPPORT_EMAIL} />
          </div>
        </div>

        {/* Quick Legal Footer Nav */}
        <nav className={styles.legalFooterNav} aria-label="Legal">
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
