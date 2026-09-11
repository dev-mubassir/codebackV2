import Link from 'next/link';
import { meta, legal } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '../legal/legal.module.css';

export const metadata = {
  title: meta.dataDeletion.title,
  description: meta.dataDeletion.description,
};

const LAST_UPDATED = '11 September 2026';

export default function DataDeletionPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>{legal.backToHome}</Link>

        <h1 className={styles.title}>{legal.dataDeletionTitle}</h1>
        <p className={styles.updated}>{legal.lastUpdated}: {LAST_UPDATED}</p>

        <section className={styles.section}>
          <p>
            You can permanently delete the data Siffty holds about you. Deletion is
            immediate and cannot be undone — there is no recovery window. Database backups are
            kept for no more than 7 days, so deleted data is removed from backups within 7 days
            of deletion.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Option 1 — Delete from inside Siffty</h2>
          <ol>
            <li>Sign in to Siffty.</li>
            <li>Open <strong>Profile</strong>.</li>
            <li>Choose <strong>Delete account</strong> and confirm.</li>
          </ol>
          <p>Your account and all data listed below are erased straight away.</p>
        </section>

        <section className={styles.section}>
          <h2>Option 2 — Remove Siffty from Instagram</h2>
          <p>
            In the Instagram app, go to <strong>Settings and activity → Website permissions →
            Apps and websites</strong>, and remove Siffty. This revokes Siffty&apos;s access,
            and Instagram also sends Siffty a request to delete your data. Siffty then
            automatically erases all data for that Instagram account. If it was the only
            Instagram account on your Siffty account, your Siffty account is deleted too. We
            email a confirmation to the address on your Siffty account.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Option 3 — Ask us</h2>
          <p>
            Email <strong>{SUPPORT_EMAIL}</strong> from the address on your Siffty account,
            or naming the Instagram account concerned. We action deletion requests within 30
            days and will confirm when it is done.
          </p>
        </section>

        <section className={styles.section}>
          <h2>What gets deleted</h2>
          <ul>
            <li>Your Siffty account, name, email address, and password hash.</li>
            <li>Your business profile and assistant settings.</li>
            <li>Every connected Instagram account, including the stored access token.</li>
            <li>All contacts, conversations, and messages held for those accounts.</li>
            <li>All analysis results, conversation summaries, and extracted brand deal records.</li>
            <li>All draft replies, notifications, usage records, and stored webhook delivery logs.</li>
            <li>Sign-in tokens issued for password resets and email verification, your notification and automation preferences, and your trial/subscription record.</li>
          </ul>
          <div className={styles.callout}>
            <p>
              Deleting is not the same as disconnecting. <strong>Disconnecting</strong> an
              Instagram account stops Siffty processing new messages but keeps your history
              so it returns if you reconnect. <strong>Deleting</strong> erases it.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <h2>What we keep</h2>
          <p>
            To stop the same Instagram account from claiming repeated free trials, Siffty
            stores a one-way cryptographic hash of the Instagram account ID and the dates of
            trial use for up to 24 months after your last connection, including after you
            delete your Siffty account. This record contains no username, name, email
            address, or message content, and is not linked to your Siffty account.
          </p>
        </section>

        <section className={styles.section} id="if-you-messaged-a-business">
          <h2>If you messaged a business that uses Siffty</h2>
          <p>
            If you sent a direct message to a business using Siffty and want that message
            removed, contact the business directly — they control their own inbox and can
            delete the conversation. You can also email us at the address above and we will
            pass the request on.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Retention of webhook logs</h2>
          <p>
            Separately from any deletion request, the raw delivery logs that contain incoming
            message text are automatically erased 30 days after receipt. Only non-content
            metadata is kept beyond that.
          </p>
        </section>

        <p className={styles.contact}>
          Deletion requests and questions: <strong>{SUPPORT_EMAIL}</strong> ·{' '}
          <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link>
        </p>

        <nav className={styles.footerNav} aria-label="Legal">
          <Link href="/privacy" className={styles.footerNavLink}>{legal.footerLinks.privacy}</Link>
          <Link href="/terms" className={styles.footerNavLink}>{legal.footerLinks.terms}</Link>
          <Link href="/data-deletion" className={styles.footerNavLink}>{legal.footerLinks.dataDeletion}</Link>
          <Link href="/support" className={styles.footerNavLink}>{legal.footerLinks.support}</Link>
        </nav>
      </div>
    </main>
  );
}
