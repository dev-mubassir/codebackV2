import Link from 'next/link';
import { meta, legal } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '../legal/legal.module.css';

export const metadata = {
  title: meta.dataDeletion.title,
  description: meta.dataDeletion.description,
};

const LAST_UPDATED = '30 August 2026';

export default function DataDeletionPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>{legal.backToHome}</Link>

        <h1 className={styles.title}>{legal.dataDeletionTitle}</h1>
        <p className={styles.updated}>{legal.lastUpdated}: {LAST_UPDATED}</p>

        <section className={styles.section}>
          <p>
            You can permanently delete everything Codeback holds about you. Deletion is
            immediate and cannot be undone — there is no recovery window and no backup copy is
            retained for restoration.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Option 1 — Delete from inside Codeback</h2>
          <ol>
            <li>Sign in to Codeback.</li>
            <li>Open <strong>Profile</strong>.</li>
            <li>Choose <strong>Delete account</strong> and confirm.</li>
          </ol>
          <p>Your account and all data listed below are erased straight away.</p>
        </section>

        <section className={styles.section}>
          <h2>Option 2 — Remove Codeback from Instagram</h2>
          <p>
            You can revoke Codeback&apos;s access from Instagram at any time, under
            Settings → Website permissions → Apps and websites. When Meta notifies us that
            access has been revoked and deletion requested, the connected Instagram
            account&apos;s data is erased automatically.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Option 3 — Ask us</h2>
          <p>
            Email <strong>{SUPPORT_EMAIL}</strong> from the address on your Codeback account,
            or naming the Instagram account concerned. We action deletion requests within 30
            days and will confirm when it is done.
          </p>
        </section>

        <section className={styles.section}>
          <h2>What gets deleted</h2>
          <ul>
            <li>Your Codeback account, name, email address, and password hash.</li>
            <li>Your business profile and assistant settings.</li>
            <li>Every connected Instagram account, including the stored access token.</li>
            <li>All contacts, conversations, and messages held for those accounts.</li>
            <li>All analysis results, conversation summaries, and extracted brand deal records.</li>
            <li>All draft replies, notifications, usage records, and stored webhook delivery logs.</li>
          </ul>
          <div className={styles.callout}>
            <p>
              Deleting is not the same as disconnecting. <strong>Disconnecting</strong> an
              Instagram account stops Codeback processing new messages but keeps your history
              so it returns if you reconnect. <strong>Deleting</strong> erases it.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <h2>If you messaged a business that uses Codeback</h2>
          <p>
            If you sent a direct message to a business using Codeback and want that message
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
      </div>
    </main>
  );
}
