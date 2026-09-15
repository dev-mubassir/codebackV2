import Link from 'next/link';
import { meta, legal, support } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '../legal/legal.module.css';

export const metadata = {
  title: meta.support.title,
  description: meta.support.description,
};

export default function SupportPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>{legal.backToHome}</Link>

        <h1 className={styles.title}>{legal.supportTitle}</h1>
        <p className={styles.updated}>{support.intro}</p>

        <section className={styles.section}>
          <h2>{support.contactTitle}</h2>
          <p>
            Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. {support.replyTime}
          </p>
          <p>
            {support.formPrompt} <Link href="/contact">{support.formLink}</Link>.
          </p>
          <div className={styles.callout}>
            <p>{support.whatToInclude.title}:</p>
            <ul>
              {support.whatToInclude.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className={styles.section}>
          <h2>{support.helpTitle}</h2>
          {support.entries.map((entry) => (
            <div key={entry.title} className={styles.section}>
              <h3>{entry.title}</h3>
              <p>
                {entry.body}
                {entry.href && (
                  <>
                    {' '}
                    <Link href={entry.href}>{entry.linkText}</Link>.
                  </>
                )}
              </p>
            </div>
          ))}
        </section>

        <p className={styles.contact}>
          Questions: <strong>{SUPPORT_EMAIL}</strong>
        </p>

        <nav className={styles.footerNav} aria-label="Legal">
          <Link href="/privacy" className={styles.footerNavLink}>{legal.footerLinks.privacy}</Link>
          <Link href="/terms" className={styles.footerNavLink}>{legal.footerLinks.terms}</Link>
          <Link href="/data-deletion" className={styles.footerNavLink}>{legal.footerLinks.dataDeletion}</Link>
          <Link href="/support" className={styles.footerNavLink}>{legal.footerLinks.support}</Link>
          <Link href="/contact" className={styles.footerNavLink}>{legal.footerLinks.contact}</Link>
          <Link href="/refund-policy" className={styles.footerNavLink}>{legal.footerLinks.refundPolicy}</Link>
        </nav>
      </div>
    </main>
  );
}
