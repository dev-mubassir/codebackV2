import Link from 'next/link';
import { meta, legal } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '../legal/legal.module.css';

export const metadata = {
  title: meta.privacy.title,
  description: meta.privacy.description,
};

const LAST_UPDATED = '11 September 2026';

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
            Codeback is operated by Mubassir Shah, based in India. Contact: {SUPPORT_EMAIL}.
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
            <li>
              If you sign up with email: your name, email address, and a password. The password
              is stored only as a salted one-way hash (Argon2id); the plain password is never
              stored.
            </li>
            <li>
              If you sign in with Google: your name, email address, and an internal Google
              account identifier. Codeback never receives your Google password.
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
              reset or email verification link, or when Codeback blocks a suspicious attempt to
              connect an Instagram account that is already in use elsewhere.
            </li>
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
              about that data are described in section 9.
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
          <h2>5. Automated processing and Google Gemini</h2>
          <div className={styles.callout}>
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
            Codeback sends content to Gemini only to receive a classification or draft reply.
            Codeback does not use message content to train or fine-tune any AI model.
          </p>
          <p>
            Codeback uses Google&apos;s paid Gemini API service, under which Google does not use
            the content sent to it to improve its products.
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
            <li><strong>Google (Gemini)</strong> — as described in section 5.</li>
            <li><strong>Hosting and infrastructure providers</strong> — who store the data on Codeback&apos;s behalf.</li>
            <li><strong>Authorities</strong> — where required by law.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>7. Where data is stored</h2>
          <p>
            Codeback&apos;s service and database are hosted in the United States. Gemini,
            described in section 5, may process content in other countries. If you use
            Codeback from outside the United States, your data is transferred to, and stored in,
            the United States.
          </p>
        </section>

        <section className={styles.section}>
          <h2>8. Retention</h2>
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
            <li>
              <strong>Trial-abuse record.</strong> To stop the same Instagram account from
              claiming repeated free trials, Codeback stores a one-way cryptographic hash of the
              Instagram account ID and the dates of trial use for up to 24 months after your
              last connection, including after you delete your Codeback account. This record
              contains no username, name, email address, or message content, and is not linked
              to your Codeback account.
            </li>
            <li>
              <strong>IP addresses.</strong> Those collected when you request a password reset
              or email verification link are removed no later than 7 days after that request
              expires. IP addresses recorded when an Instagram account connection is refused are
              erased after 90 days.
            </li>
          </ul>
          <p>
            Disconnecting an Instagram account does not delete history — it stops Codeback
            processing new messages while keeping past conversations so they reappear if the
            account is reconnected. Deleting is a separate, explicit action.
          </p>
          <p>
            Removing Codeback from Instagram&apos;s settings is different from disconnecting:
            Instagram also sends Codeback a data deletion request, and that Instagram
            account&apos;s data is erased automatically, as described on the{' '}
            <Link href="/data-deletion">data deletion page</Link>.
          </p>
        </section>

        <section className={styles.section}>
          <h2>9. Deletion and your rights</h2>
          <p>
            Customers can permanently delete their Codeback account and all associated data
            from the profile page in the app, or by following the instructions on the{' '}
            <Link href="/data-deletion">data deletion page</Link>. Deletion removes the account,
            every connected Instagram account, and all contacts, conversations, messages,
            analysis results, brand deal records, notifications, and webhook logs belonging to
            them. It is immediate and cannot be undone. The only data kept afterwards is the
            trial-abuse record described in section 8.
          </p>
          <p>
            If Meta sends Codeback a data deletion request for an Instagram account, that
            account&apos;s data is erased automatically. See the{' '}
            <Link href="/data-deletion">data deletion page</Link>.
          </p>
          <p>
            Database backups are kept for no more than 7 days, so deleted data is removed from
            backups within 7 days of deletion.
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
          <h2>10. Security</h2>
          <ul>
            <li>Instagram access tokens are encrypted at rest with AES-256-GCM.</li>
            <li>Passwords are stored only as salted one-way hashes (Argon2id).</li>
            <li>Session cookies are HTTP-only and, in production, restricted to HTTPS.</li>
            <li>Incoming webhook deliveries are rejected unless they carry a valid Meta signature.</li>
            <li>Each customer&apos;s data is scoped to their own account; requests for another account&apos;s data are refused.</li>
          </ul>
          <p>No service can promise perfect security, but these are the specific measures in place.</p>
        </section>

        <section className={styles.section}>
          <h2>11. Children</h2>
          <p>
            Codeback is intended for businesses and creators aged 18 or over. It is not directed
            at children, and we do not knowingly collect their data.
          </p>
        </section>

        <section className={styles.section}>
          <h2>12. Changes</h2>
          <p>
            If this policy changes materially, the date at the top will be updated and
            customers will be notified in the app or by email.
          </p>
        </section>

        <p className={styles.contact}>
          Questions about this policy or your data: <strong>{SUPPORT_EMAIL}</strong>
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
