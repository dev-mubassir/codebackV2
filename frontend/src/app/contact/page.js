import Link from 'next/link';
import { meta, legal, support, contactPage } from '@/content/copy';
import { SUPPORT_EMAIL, BUSINESS_NAME, BUSINESS_CITY, BUSINESS_COUNTRY } from '@/content/contact';
import styles from '../legal/legal.module.css';
import ContactForm from './ContactForm';

export const metadata = {
  title: meta.contact.title,
  description: meta.contact.description,
};

/**
 * /contact — server-rendered and static. Deliberately independent of the
 * billing flag and of any API call: the address, reply time and business
 * details are in the HTML, and only the form below them needs JavaScript.
 */
export default function ContactPage() {
  const place = BUSINESS_CITY ? `${BUSINESS_CITY}, ${BUSINESS_COUNTRY}` : BUSINESS_COUNTRY;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>{legal.backToHome}</Link>

        <h1 className={styles.title}>{contactPage.title}</h1>
        <p className={styles.updated}>{contactPage.intro}</p>

        <section className={styles.section}>
          <h2>{contactPage.emailTitle}</h2>
          <p>
            {contactPage.emailLead} <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. {support.replyTime}
          </p>
        </section>

        <section className={styles.section}>
          <h2>{contactPage.formTitle}</h2>
          <ContactForm kind="support" supportEmail={SUPPORT_EMAIL} />
        </section>

        <section className={styles.section}>
          <h2>{contactPage.enterpriseTitle}</h2>
          <p>
            {contactPage.enterpriseBody} <Link href="/contact/enterprise">{contactPage.enterpriseLink}</Link>.
          </p>
        </section>

        <section className={styles.section}>
          <h2>{contactPage.whoTitle}</h2>
          <p>
            {BUSINESS_NAME}, {place}.
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
