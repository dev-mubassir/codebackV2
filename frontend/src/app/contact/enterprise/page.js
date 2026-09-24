import Link from 'next/link';
import PublicNavbar from '@/app/components/public/PublicNavbar';
import PublicFooter from '@/app/components/public/PublicFooter';
import PublicHero from '@/app/components/public/PublicHero';
import { meta, legal, support, contactPage } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '@/app/components/public/public.module.css';
import ContactForm from '../ContactForm';

export const metadata = {
  title: meta.contactEnterprise.title,
  description: meta.contactEnterprise.description,
};

export default function EnterpriseContactPage() {
  const t = contactPage.enterprise;

  return (
    <div className={styles.publicPage}>
      {/* Decorative Grid Overlay */}
      <div className={styles.bgGridOverlay} aria-hidden="true" />

      {/* Navbar */}
      <PublicNavbar />

      {/* Hero */}
      <PublicHero
        eyebrow="ENTERPRISE & CUSTOM PLANS"
        title={t.title}
        subtitle={t.intro}
        badgeText={support.replyTime}
        breadcrumbCategory="Resources"
        breadcrumbCurrent="Enterprise"
      />

      <main className={styles.container}>
        <div className={styles.contactGrid}>
          {/* Left Column: Enterprise Benefits & General Support Link */}
          <div className={styles.contactInfoCard}>
            <div className={styles.contactInfoItem}>
              <div className={styles.cardIconBox}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <div className={styles.contactInfoText}>
                <h4>Custom Volumes & Dedicated SLA</h4>
                <p>
                  Tailored plans for agencies, multi-brand managers, and high-volume creators.
                  Includes custom Instagram accounts, rollover auto-replies, and dedicated support.
                </p>
              </div>
            </div>

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

            <div className={styles.contactInfoItem}>
              <div className={styles.cardIconBox}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className={styles.contactInfoText}>
                <h4>General Support Inquiries</h4>
                <p>{t.supportBody}</p>
                <p style={{ marginTop: '6px' }}>
                  <Link href="/contact" className={styles.btnPillSecondary} style={{ fontSize: '0.84rem', padding: '6px 14px' }}>
                    <span>{t.supportLink}</span>
                  </Link>
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Enterprise Enquiry Form */}
          <div className={styles.formCard}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <span className={styles.sectionNumber}>★</span>
                {contactPage.formTitle}
              </h2>
            </div>
            <ContactForm kind="enterprise" supportEmail={SUPPORT_EMAIL} />
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
