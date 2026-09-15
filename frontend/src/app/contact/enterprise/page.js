import Link from 'next/link';
import { meta, legal, support, contactPage } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '../../legal/legal.module.css';
import ContactForm from '../ContactForm';

export const metadata = {
  title: meta.contactEnterprise.title,
  description: meta.contactEnterprise.description,
};

/**
 * /contact/enterprise — its own route and its own endpoint, so an Enterprise
 * enquiry arrives labelled as one rather than mixed into general support.
 * Linked from the pricing section's Enterprise card.
 */
export default function EnterpriseContactPage() {
  const t = contactPage.enterprise;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>{legal.backToHome}</Link>

        <h1 className={styles.title}>{t.title}</h1>
        <p className={styles.updated}>{t.intro}</p>

        <section className={styles.section}>
          <h2>{contactPage.formTitle}</h2>
          <ContactForm kind="enterprise" supportEmail={SUPPORT_EMAIL} />
        </section>

        <section className={styles.section}>
          <h2>{contactPage.emailTitle}</h2>
          <p>
            {contactPage.emailLead} <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. {support.replyTime}
          </p>
          <p>
            {t.supportBody} <Link href="/contact">{t.supportLink}</Link>.
          </p>
        </section>

        <nav className={styles.footerNav} aria-label="Legal">
          <Link href="/privacy" className={styles.footerNavLink}>{legal.footerLinks.privacy}</Link>
          <Link href="/terms" className={styles.footerNavLink}>{legal.footerLinks.terms}</Link>
          <Link href="/data-deletion" className={styles.footerNavLink}>{legal.footerLinks.dataDeletion}</Link>
          <Link href="/support" className={styles.footerNavLink}>{legal.footerLinks.support}</Link>
          <Link href="/contact" className={styles.footerNavLink}>{legal.footerLinks.contact}</Link>
        </nav>
      </div>
    </main>
  );
}
