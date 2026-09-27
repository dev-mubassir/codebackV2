import Link from 'next/link';
import LegalLayout from '@/app/components/public/LegalLayout';
import { meta, legal } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '@/app/components/public/public.module.css';

export const metadata = {
  title: meta.dataDeletion.title,
  description: meta.dataDeletion.description,
};

const LAST_UPDATED = '27 September 2026';

const TOC_ITEMS = [
  { id: 'deletion-options', title: '1. Deletion Options' },
  { id: 'what-gets-deleted', title: '2. What Gets Deleted' },
  { id: 'what-we-keep', title: '3. What We Keep' },
  { id: 'if-you-messaged-a-business', title: '4. If You Messaged a Business' },
  { id: 'webhook-logs', title: '5. Retention of Webhook Logs' },
];

export default function DataDeletionPage() {
  return (
    <LegalLayout
      eyebrow="PRIVACY & COMPLIANCE"
      title={legal.dataDeletionTitle}
      subtitle="How to permanently and immediately erase your Siffty account, connected Instagram profiles, and conversation data."
      badgeText={`${legal.lastUpdated}: ${LAST_UPDATED}`}
      breadcrumbCategory="Legal"
      breadcrumbCurrent="Data Deletion"
      tocItems={TOC_ITEMS}
    >
      {/* 1. Deletion Options */}
      <section id="deletion-options" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>1</span>
            How to Delete Your Data
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            You can permanently delete the data Siffty holds about you. Deletion is
            immediate and cannot be undone — there is no recovery window. Database backups are
            kept for no more than 7 days, so deleted data is removed from backups within 7 days
            of deletion.
          </p>

          {/* 3 Prominent Option Cards */}
          <div className={styles.cardsGrid} style={{ marginTop: '24px' }}>
            {/* Option 1 */}
            <div className={styles.featureCard}>
              <div className={styles.cardIconBox}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <h3 className={styles.cardSubTitle}>Option 1 — In-App Deletion</h3>
              <p className={styles.cardDesc}>
                Instant self-service deletion directly from your account:
              </p>
              <ol style={{ paddingLeft: '20px', margin: '0 0 12px 0', fontSize: '0.88rem', color: '#4b5563' }}>
                <li>Sign in to Siffty.</li>
                <li>Open <strong>Profile</strong>.</li>
                <li>Choose <strong>Delete account</strong> and confirm.</li>
              </ol>
              <Link href="/profile" className={styles.btnPillPrimary} style={{ marginTop: 'auto', textAlign: 'center', justifyContent: 'center' }}>
                <span>Open Profile Settings</span>
              </Link>
            </div>

            {/* Option 2 */}
            <div className={styles.featureCard}>
              <div className={styles.cardIconBox}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
                </svg>
              </div>
              <h3 className={styles.cardSubTitle}>Option 2 — Via Instagram</h3>
              <p className={styles.cardDesc}>
                In the Instagram app, go to <strong>Settings and activity → Website permissions → Apps and websites</strong>,
                and remove Siffty.
              </p>
              <p className={styles.cardDesc}>
                Instagram dispatches a server-to-server deletion callback, and Siffty automatically erases all data
                for that Instagram account.
              </p>
            </div>

            {/* Option 3 */}
            <div className={styles.featureCard}>
              <div className={styles.cardIconBox}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </div>
              <h3 className={styles.cardSubTitle}>Option 3 — Ask Us Directly</h3>
              <p className={styles.cardDesc}>
                Email <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#4169e1', fontWeight: 600 }}>{SUPPORT_EMAIL}</a> from
                the address on your Siffty account, or naming the Instagram account concerned.
              </p>
              <p className={styles.cardDesc}>
                We action manual deletion requests within 30 days and will send email confirmation when complete.
              </p>
              <a href={`mailto:${SUPPORT_EMAIL}`} className={styles.btnPillSecondary} style={{ marginTop: 'auto', textAlign: 'center', justifyContent: 'center' }}>
                <span>Send Deletion Email</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 2. What Gets Deleted */}
      <section id="what-gets-deleted" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>2</span>
            What Gets Deleted
          </h2>
        </div>
        <div className={styles.cardBody}>
          <ul>
            <li>Your Siffty account, name, email address, and password hash.</li>
            <li>Your business profile and assistant settings.</li>
            <li>Every connected Instagram account, including the stored access token.</li>
            <li>All contacts, conversations, and messages held for those accounts.</li>
            <li>All analysis results, conversation summaries, and extracted brand deal records.</li>
            <li>All draft replies, notifications, usage records, and stored webhook delivery logs.</li>
            <li>All Auto DM automations, their uploaded images, and their run logs (the comments answered, commenter usernames and IDs, and what was sent).</li>
            <li>Sign-in tokens issued for password resets and email verification, your notification and automation preferences, and your trial/subscription record.</li>
          </ul>

          <div className={styles.calloutBox}>
            <p>
              <strong>Important Difference:</strong> Deleting is not the same as disconnecting.
              <strong> Disconnecting</strong> an Instagram account stops Siffty processing new messages
              but keeps your history so it returns if you reconnect. <strong>Deleting</strong> erases it completely.
              Auto DM data is the exception: its automations stop at once and all of its Auto DM data is
              deleted within 24 hours of disconnecting.
            </p>
          </div>
        </div>
      </section>

      {/* 3. What We Keep */}
      <section id="what-we-keep" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>3</span>
            What We Keep
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            To stop the same Instagram account from claiming repeated free trials, Siffty
            stores a one-way cryptographic hash of the Instagram account ID and the dates of
            trial use for up to 24 months after your last connection, including after you
            delete your Siffty account. This record contains no username, name, email
            address, or message content, and is not linked to your Siffty account.
          </p>
        </div>
      </section>

      {/* 4. If You Messaged a Business */}
      <section id="if-you-messaged-a-business" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>4</span>
            If You Messaged a Business That Uses Siffty
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            If you sent a direct message to a business using Siffty and want that message
            removed, contact the business directly — they control their own inbox and can
            delete the conversation. You can also email us at{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}><strong>{SUPPORT_EMAIL}</strong></a> and we will
            pass the request on.
          </p>
        </div>
      </section>

      {/* 5. Retention of Webhook Logs */}
      <section id="webhook-logs" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>5</span>
            Retention of Webhook Logs
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Separately from any deletion request, the raw delivery logs that contain incoming
            message text are automatically erased 30 days after receipt. Only non-content
            metadata is kept beyond that.
          </p>
          <div className={styles.calloutBox} style={{ marginTop: '16px' }}>
            <p>
              Deletion requests and questions:{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}><strong>{SUPPORT_EMAIL}</strong></a> ·{' '}
              <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link>
            </p>
          </div>
        </div>
      </section>
    </LegalLayout>
  );
}
