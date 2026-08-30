import Link from 'next/link';
import { meta, legal } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '../legal/legal.module.css';

export const metadata = {
  title: meta.privacy.title,
  description: meta.privacy.description,
};

const LAST_UPDATED = '30 August 2026';

export default function PrivacyPolicyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>{legal.backToHome}</Link>

        <h1 className={styles.title}>{legal.privacyTitle}</h1>
        <p className={styles.updated}>{legal.lastUpdated}: {LAST_UPDATED}</p>

        <section className={styles.section}>
          <h2>1. What Codeback is</h2>
          <p>
            Codeback is a tool for businesses and creators who receive direct messages on
            Instagram. With the account owner&apos;s authorisation, it reads incoming Instagram
            direct messages, sorts them, and helps the owner reply. This policy describes what
            data the service holds, why, who it is shared with, and how it is deleted.
          </p>
          <p>
            Two different groups of people appear in this policy. A <strong>customer</strong> is
            a business or creator who signs up for Codeback and connects an Instagram account.
            A <strong>message sender</strong> is anyone who sends a direct message to that
            Instagram account. Message senders do not have Codeback accounts.
          </p>
        </section>

        <section className={styles.section}>
          <h2>2. Data collected about customers</h2>
          <ul>
            <li>Name and email address, provided at sign-up.</li>
            <li>A password, stored only as a bcrypt hash. The plain password is never stored.</li>
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
          </ul>
        </section>

        <section className={styles.section}>
          <h2>3. Data collected about message senders</h2>
          <p>
            When someone sends a direct message to a connected Instagram account, Meta delivers
            that message to Codeback and the following is stored on the account owner&apos;s
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
          <div className={styles.callout}>
            <p>
              <strong>Message senders did not sign up for Codeback.</strong> Their data is
              processed on behalf of the business they messaged, which controls it. Requests
              about that data are described in section 8.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <h2>4. How the data is used</h2>
          <ul>
            <li>To show the account owner their Instagram messages in one inbox.</li>
            <li>To sort and prioritise those messages, and to flag ones that appear to be spam, fraudulent, or to need urgent attention.</li>
            <li>To draft suggested replies that the account owner can review, edit, and send.</li>
            <li>
              To send an automated reply <em>only</em> where the account owner has explicitly
              switched automatic sending on. New accounts default to manual replies only, and
              nothing is ever sent on a customer&apos;s behalf until they change that setting.
            </li>
            <li>To operate, secure, and debug the service.</li>
          </ul>
          <p>
            Codeback does not sell personal data and does not use message content for
            advertising.
          </p>
        </section>

        <section className={styles.section}>
          <h2>5. Automated processing and third-party AI providers</h2>
          <div className={styles.callout}>
            <p>
              To categorise a message and to draft replies, the text of that message, recent
              messages in the same conversation, and the business profile of the account owner
              are sent to a third-party AI provider.
            </p>
          </div>
          <p>
            The provider used depends on the service&apos;s configuration and may be Google
            (Gemini), xAI (Grok), or OpenAI. These providers process the content in order to
            return a classification or a draft reply. Their own terms and privacy policies
            govern that processing.
          </p>
          <p>
            Some messages are classified by simple keyword matching alone and are never sent to
            an AI provider.
          </p>
        </section>

        <section className={styles.section}>
          <h2>6. Sharing</h2>
          <p>Data is shared only with:</p>
          <ul>
            <li>
              <strong>Meta Platforms</strong> — to receive messages and to send replies through
              the Instagram Graph API, under the permissions the account owner granted.
            </li>
            <li><strong>AI providers</strong> — as described in section 5.</li>
            <li><strong>Hosting and infrastructure providers</strong> — who store the data on Codeback&apos;s behalf.</li>
            <li><strong>Authorities</strong> — where required by law.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>7. Retention</h2>
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
              deletes the conversation, purges the connected account, or closes their Codeback
              account.
            </li>
            <li>
              <strong>Account and business profile data</strong> is kept until the customer
              deletes their account.
            </li>
          </ul>
          <p>
            Disconnecting an Instagram account does not delete history — it stops Codeback
            processing new messages while keeping past conversations so they reappear if the
            account is reconnected. Deleting is a separate, explicit action.
          </p>
        </section>

        <section className={styles.section}>
          <h2>8. Deletion and your rights</h2>
          <p>
            Customers can permanently delete their Codeback account and all associated data
            from the profile page in the app, or by following the instructions on the{' '}
            <Link href="/data-deletion">data deletion page</Link>. Deletion removes the account,
            every connected Instagram account, and all contacts, conversations, messages,
            analysis results, brand deal records, notifications, and webhook logs belonging to
            them. It is immediate and cannot be undone.
          </p>
          <p>
            Message senders who want their data removed from a business&apos;s Codeback inbox
            should contact that business, which controls the data. They may also contact
            Codeback at the address below and the request will be passed on.
          </p>
          <p>
            Depending on where you live you may have rights to access, correct, export, or
            restrict the processing of your personal data. Contact us to exercise them.
          </p>
        </section>

        <section className={styles.section}>
          <h2>9. Security</h2>
          <ul>
            <li>Instagram access tokens are encrypted at rest with AES-256-GCM.</li>
            <li>Passwords are stored only as bcrypt hashes.</li>
            <li>Session cookies are HTTP-only and, in production, restricted to HTTPS.</li>
            <li>Incoming webhook deliveries are rejected unless they carry a valid Meta signature.</li>
            <li>Each customer&apos;s data is scoped to their own account; requests for another account&apos;s data are refused.</li>
          </ul>
          <p>No service can promise perfect security, but these are the specific measures in place.</p>
        </section>

        <section className={styles.section}>
          <h2>10. Changes</h2>
          <p>
            If this policy changes materially, the date at the top will be updated and
            customers will be notified in the app or by email.
          </p>
        </section>

        <p className={styles.contact}>
          Questions about this policy or your data: <strong>{SUPPORT_EMAIL}</strong>
        </p>
      </div>
    </main>
  );
}
