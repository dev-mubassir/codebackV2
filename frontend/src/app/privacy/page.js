import Link from 'next/link';
import LegalLayout from '@/app/components/public/LegalLayout';
import { meta, legal } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '@/app/components/public/public.module.css';

export const metadata = {
  title: meta.privacy.title,
  description: meta.privacy.description,
};

const LAST_UPDATED = '28 September 2026';

const TOC_ITEMS = [
  { id: 'what-siffty-is', title: '1. What Siffty is' },
  { id: 'data-customers', title: '2. Data collected about customers' },
  { id: 'data-senders', title: '3. Data collected about message senders' },
  { id: 'data-use', title: '4. How the data is used' },
  { id: 'automated-gemini', title: '5. Automated processing & Gemini' },
  { id: 'sharing', title: '6. Sharing' },
  { id: 'storage', title: '7. Where data is stored' },
  { id: 'retention', title: '8. Retention' },
  { id: 'deletion-rights', title: '9. Deletion and your rights' },
  { id: 'security', title: '10. Security' },
  { id: 'children', title: '11. Children' },
  { id: 'changes', title: '12. Changes' },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout
      eyebrow="LEGAL & PRIVACY"
      title={legal.privacyTitle}
      subtitle="How Siffty collects, processes, protects, and permanently deletes customer and message data."
      badgeText={`${legal.lastUpdated}: ${LAST_UPDATED}`}
      breadcrumbCategory="Legal"
      breadcrumbCurrent="Privacy Policy"
      tocItems={TOC_ITEMS}
    >
      {/* 1. What Siffty is */}
      <section id="what-siffty-is" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>1</span>
            What Siffty is
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Siffty is a tool for businesses and creators who receive direct messages on
            Instagram. With the account owner&apos;s authorisation, it reads incoming Instagram
            direct messages, sorts them, and helps the owner reply. If the owner turns on
            <strong> Auto DM</strong>, it also sends a direct message to people who comment on
            the owner&apos;s posts. This policy describes what data the service holds, why, who
            it is shared with, and how it is deleted.
          </p>
          <p>
            Siffty is operated by Siffty (proprietor: Mubassir Shah), based in India. Contact:{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
          <p>
            Two different groups of people appear in this policy. A <strong>customer</strong> is
            a business or creator who signs up for Siffty and connects an Instagram account.
            A <strong>message sender</strong> is anyone who sends a direct message to that
            Instagram account, or who comments on its posts when Auto DM is on (a{' '}
            <strong>commenter</strong>). Message senders and commenters do not have Siffty
            accounts.
          </p>
        </div>
      </section>

      {/* 2. Data collected about customers */}
      <section id="data-customers" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>2</span>
            Data collected about customers
          </h2>
        </div>
        <div className={styles.cardBody}>
          <ul>
            <li>
              If you sign up with email: your name, email address, and a password. The password
              is stored only as a salted one-way hash (Argon2id); the plain password is never
              stored.
            </li>
            <li>
              If you sign in with Google: your name, email address, and an internal Google
              account identifier. Siffty never receives your Google password.
            </li>
            <li>
              Business profile details the customer chooses to enter — business type,
              description, products and services, pricing, delivery areas, payment methods,
              FAQs, policies, tone preferences, and any custom instructions for the assistant.
            </li>
            <li>
              For each connected Instagram account: the Instagram user ID, username, display
              name, profile picture URL, and an access token issued by Meta. Access tokens are
              encrypted at rest using AES-256-GCM.
            </li>
            <li>Usage records — counts of messages received, messages analysed, and replies generated.</li>
            <li>
              Technical data such as your IP address, collected when you request a password
              reset or email verification link, or when Siffty blocks a suspicious attempt to
              connect an Instagram account that is already in use elsewhere.
            </li>
          </ul>
        </div>
      </section>

      {/* 3. Data collected about message senders */}
      <section id="data-senders" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>3</span>
            Data collected about message senders
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            When someone sends a direct message to a connected Instagram account, Meta delivers
            that message to Siffty and the following is stored on the account owner&apos;s
            behalf:
          </p>
          <ul>
            <li>The sender&apos;s Instagram-scoped ID, username, display name, and profile picture URL.</li>
            <li>The message text, attachment type and URL, and the time it was sent.</li>
            <li>
              Information derived from the message by automated analysis: a category, an
              inferred intent, priority and lead-quality scores, a risk assessment, and a short
              summary of the conversation.
            </li>
            <li>Where a message appears to describe a commercial collaboration, the structured details of that proposal.</li>
          </ul>
          <p>
            <strong>Auto DM (comment replies).</strong> When a connected account has Auto DM
            switched on and someone comments on one of its posts, Siffty processes:
          </p>
          <ul>
            <li>the comment text;</li>
            <li>the commenter&apos;s Instagram username and Instagram-scoped ID;</li>
            <li>the ID of the post or reel that was commented on;</li>
            <li>
              if the owner requires followers only, whether the commenter follows the account
              at the moment Siffty checks.
            </li>
          </ul>
          <p>
            This is used only to deliver the automated reply the account owner set up — the
            private reply to the comment, and the message with the owner&apos;s link. Auto DM
            matches keywords itself; comments are never sent to Gemini or any other AI
            service.
          </p>
          <div className={styles.calloutBox}>
            <p>
              <strong>Message senders did not sign up for Siffty.</strong> Their data is
              processed on behalf of the business they messaged, which controls it. Requests
              about that data are described in section 9.
            </p>
          </div>
        </div>
      </section>

      {/* 4. How the data is used */}
      <section id="data-use" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>4</span>
            How the data is used
          </h2>
        </div>
        <div className={styles.cardBody}>
          <ul>
            <li>To show the account owner their Instagram messages in one inbox.</li>
            <li>To sort and prioritise those messages, and to flag ones that appear to be spam, fraudulent, or to need urgent attention.</li>
            <li>To draft suggested replies that the account owner can review, edit, and send.</li>
            <li>
              To send an automated reply <em>only</em> where the account owner has explicitly
              switched automatic sending on. New accounts default to manual replies only, and
              nothing is ever sent on a customer&apos;s behalf until they change that setting.
            </li>
            <li>
              To deliver the automated comment replies an account owner sets up with Auto DM
              (see section 3), and to show the owner a log of what was sent.
            </li>
            <li>To operate, secure, and debug the service.</li>
          </ul>
          <div className={styles.calloutBox}>
            <p>
              <strong>No Data Selling:</strong> Siffty does not sell personal data — including comment data — and does not use message or comment content for advertising.
            </p>
          </div>
        </div>
      </section>

      {/* 5. Automated processing and Google Gemini */}
      <section id="automated-gemini" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>5</span>
            Automated processing and Google Gemini
          </h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.calloutBox}>
            <p>
              To categorise a message and to draft replies, the text of that message, recent
              messages in the same conversation, and the business profile of the account owner
              are sent to Google&apos;s Gemini API.
            </p>
          </div>
          <p>
            Gemini processes the content in order to return a classification or a draft reply.
            Google&apos;s own terms and privacy policies govern that processing.
          </p>
          <p>
            Some messages are classified by simple keyword matching alone and are never sent to
            Gemini.
          </p>
          <p>
            Siffty sends content to Gemini only to receive a classification or draft reply.
            Siffty does not use message content to train or fine-tune any AI model.
          </p>
          <p>
            Siffty uses Google&apos;s paid Gemini API service, under which Google does not use
            the content sent to it to improve its products.
          </p>
        </div>
      </section>

      {/* 6. Sharing */}
      <section id="sharing" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>6</span>
            Sharing
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>Data is shared only with these processors, each for the purpose named:</p>
          <ul>
            <li>
              <strong>Meta (Instagram)</strong> — to receive messages and comments, and to send
              replies through the Instagram Graph API, under the permissions the account owner
              granted.
            </li>
            <li><strong>Google (Gemini)</strong> — as described in section 5.</li>
            <li>
              <strong>Resend (email)</strong> — to deliver Siffty&apos;s emails to you, such as
              sign-in, verification, billing and usage notices.
            </li>
            <li>
              <strong>Cashfree Payments (payments)</strong> — to process payments. Card and bank
              details are entered on Cashfree&apos;s checkout and never reach Siffty.
            </li>
            <li>
              <strong>Northflank (hosting)</strong> — which runs Siffty&apos;s service and database
              on Siffty&apos;s behalf.
            </li>
          </ul>
          <p>Data is also disclosed to authorities where the law requires it.</p>
        </div>
      </section>

      {/* 7. Where data is stored */}
      <section id="storage" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>7</span>
            Where data is stored
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Siffty&apos;s service and database are hosted in India. The third-party
            processors Siffty uses — Meta (Instagram), Google (Gemini, described in section 5)
            and Resend (email delivery) — may process data outside India. If you use Siffty
            from outside India, your data is transferred to, and stored in, India.
          </p>
        </div>
      </section>

      {/* 8. Retention */}
      <section id="retention" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>8</span>
            Retention
          </h2>
        </div>
        <div className={styles.cardBody}>
          <ul>
            <li>
              <strong>Raw webhook delivery logs</strong>, which include the text of incoming
              messages, are kept for <strong>30 days</strong>. After that the message content
              is erased automatically and only non-content metadata — the account, the event
              type, the outcome, and the timestamp — is kept.
            </li>
            <li>
              <strong>Messages, conversations, contacts, and analysis results</strong> are kept
              for as long as the account owner keeps them, and are erased when the owner
              deletes the conversation, purges the connected account, or closes their Siffty
              account, or when Instagram sends Siffty a data deletion request for that Instagram
              account (the Siffty account itself is kept).
            </li>
            <li>
              <strong>Account and business profile data</strong> is kept until the customer
              deletes their account.
            </li>
            <li>
              <strong>Auto DM run logs</strong> — the comment text, commenter username and ID,
              post ID and follow-check result recorded for each automated reply — are deleted
              after <strong>90 days</strong>. All Auto DM data for an Instagram account
              (automations, their images, and run logs) is deleted{' '}
              <strong>within 24 hours of disconnecting</strong> that account, and immediately
              when the account is purged, when Instagram sends a data deletion request for it,
              or when the Siffty account is deleted.
            </li>
            <li>
              <strong>Trial-abuse record.</strong> To stop the same Instagram account from
              claiming repeated free trials, Siffty stores a one-way cryptographic hash of the
              Instagram account ID and the dates of trial use for up to 24 months after your
              last connection, including after you delete your Siffty account. This record
              contains no username, name, email address, or message content, and is not linked
              to your Siffty account.
            </li>
            <li>
              <strong>IP addresses.</strong> Those collected when you request a password reset
              or email verification link are removed no later than 7 days after that request
              expires. IP addresses recorded when an Instagram account connection is refused are
              erased after 90 days.
            </li>
          </ul>
          <p>
            Disconnecting an Instagram account does not delete message history — it stops Siffty
            processing new messages while keeping past conversations so they reappear if the
            account is reconnected. Deleting is a separate, explicit action. Auto DM data is the
            exception: it stops at once and is deleted within 24 hours of disconnecting, as
            described above.
          </p>
          <p>
            Removing Siffty from Instagram&apos;s settings is different from disconnecting:
            Instagram also sends Siffty a data deletion request, and that Instagram
            account&apos;s data is erased automatically, as described on the{' '}
            <Link href="/data-deletion">data deletion page</Link>.
          </p>
        </div>
      </section>

      {/* 9. Deletion and your rights */}
      <section id="deletion-rights" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>9</span>
            Deletion and your rights
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Customers can permanently delete their Siffty account and all associated data
            from the profile page in the app, or by following the instructions on the{' '}
            <Link href="/data-deletion">data deletion page</Link>. Deletion removes the account,
            every connected Instagram account, and all contacts, conversations, messages,
            analysis results, brand deal records, notifications, webhook logs, and Auto DM
            automations, images and run logs belonging to them. It is immediate and cannot be undone. The only data kept afterwards is the
            trial-abuse record described in section 8.
          </p>
          <p>
            If Meta sends Siffty a data deletion request for an Instagram account, that
            account&apos;s data is erased automatically. See the{' '}
            <Link href="/data-deletion">data deletion page</Link>.
          </p>
          <p>
            Database backups are kept for no more than 7 days, so deleted data is removed from
            backups within 7 days of deletion.
          </p>
          <p>
            Message senders who want their data removed from a business&apos;s Siffty inbox
            (or commenters, for Auto DM) should contact that business, which controls the
            data. They may also contact
            Siffty at the address below and the request will be passed on.
          </p>
          <p>
            Depending on where you live you may have rights to access, correct, export, or
            restrict the processing of your personal data. Contact us to exercise them.
          </p>
        </div>
      </section>

      {/* 10. Security */}
      <section id="security" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>10</span>
            Security
          </h2>
        </div>
        <div className={styles.cardBody}>
          <ul>
            <li>Instagram access tokens are encrypted at rest with AES-256-GCM.</li>
            <li>Passwords are stored only as salted one-way hashes (Argon2id).</li>
            <li>Session cookies are HTTP-only and, in production, restricted to HTTPS.</li>
            <li>Incoming webhook deliveries are rejected unless they carry a valid Meta signature.</li>
            <li>Each customer&apos;s data is scoped to their own account; requests for another account&apos;s data are refused.</li>
          </ul>
          <p>No service can promise perfect security, but these are the specific measures in place.</p>
        </div>
      </section>

      {/* 11. Children */}
      <section id="children" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>11</span>
            Children
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Siffty is intended for businesses and creators aged 18 or over. It is not directed
            at children, and we do not knowingly collect their data.
          </p>
        </div>
      </section>

      {/* 12. Changes */}
      <section id="changes" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>12</span>
            Changes
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            If this policy changes materially, the date at the top will be updated and
            customers will be notified in the app or by email.
          </p>
          <div className={styles.calloutBox} style={{ marginTop: '16px' }}>
            <p>
              Questions about this policy or your data:{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}><strong>{SUPPORT_EMAIL}</strong></a>
            </p>
          </div>
        </div>
      </section>
    </LegalLayout>
  );
}
