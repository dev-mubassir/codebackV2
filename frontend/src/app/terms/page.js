import Link from 'next/link';
import { meta, legal } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '../legal/legal.module.css';

export const metadata = {
  title: meta.terms.title,
  description: meta.terms.description,
};

const LAST_UPDATED = '11 September 2026';

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>{legal.backToHome}</Link>

        <h1 className={styles.title}>{legal.termsTitle}</h1>
        <p className={styles.updated}>{legal.lastUpdated}: {LAST_UPDATED}</p>

        <section className={styles.section}>
          <h2>1. Agreement</h2>
          <p>
            These terms govern your use of Siffty. By creating an account or connecting an
            Instagram account you agree to them. If you are using Siffty for an organisation,
            you confirm you are authorised to accept these terms on its behalf.
          </p>
          <p>
            You must be at least 18 years old to use Siffty. Siffty is operated by
            Siffty (proprietor: Mubassir Shah), India.
          </p>
        </section>

        <section className={styles.section}>
          <h2>2. What the service does</h2>
          <p>
            Siffty connects to an Instagram professional account you control, receives direct
            messages sent to it, organises them, and helps you reply — including by generating
            draft replies with automated assistance.
          </p>
        </section>

        <section className={styles.section}>
          <h2>3. Your Instagram account and Meta&apos;s terms</h2>
          <ul>
            <li>You must own, or be authorised to manage, any Instagram account you connect.</li>
            <li>
              Your use of Instagram through Siffty remains subject to Meta&apos;s own terms
              and policies. Nothing here overrides them.
            </li>
            <li>
              You may revoke Siffty&apos;s access at any time. Disconnecting the account in
              Siffty stops processing but keeps your history. To fully revoke
              Siffty&apos;s access, remove Siffty in Instagram&apos;s settings (Settings
              and activity → Website permissions → Apps and websites). This also deletes that
              Instagram account&apos;s data from Siffty, as described on the{' '}
              <Link href="/data-deletion">data deletion page</Link>.
            </li>
            <li>
              An Instagram account that already holds conversation history in another Siffty
              workspace cannot be connected to a second workspace. This protects the first
              workspace&apos;s data.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>4. Automated replies</h2>
          <div className={styles.callout}>
            <p>
              Automatic sending is <strong>off by default</strong>. Siffty will not send a
              message on your behalf unless you explicitly enable automatic replies in your
              settings.
            </p>
          </div>
          <ul>
            <li>
              With automatic replies enabled, messages are sent from your Instagram account as
              you, and you remain responsible for them.
            </li>
            <li>
              Safety limits apply: replies are withheld for messages assessed as high-risk,
              fraudulent, abusive, or spam; there are caps on consecutive and daily automated
              replies per conversation; and conversations are handed back to you when those
              caps are reached.
            </li>
            <li>
              You can turn automatic replies off entirely, or opt an individual conversation
              out, at any time.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>5. Automated output is not guaranteed</h2>
          <p>
            Classifications, summaries, priority scores, extracted deal details, and draft
            replies are produced by automated systems and can be wrong. They are suggestions,
            not advice or fact. Review anything before you rely on it or send it. You are
            responsible for every message sent from your Instagram account, whether you typed
            it or approved it.
          </p>
        </section>

        <section className={styles.section}>
          <h2>6. Acceptable use</h2>
          <p>You agree not to use Siffty to:</p>
          <ul>
            <li>Send spam, bulk unsolicited messages, or anything unlawful, deceptive, harassing, or abusive.</li>
            <li>Access, or attempt to access, data belonging to another customer.</li>
            <li>Interfere with, overload, probe, or reverse-engineer the service.</li>
            <li>Breach Meta&apos;s platform terms or any applicable law, including messaging and privacy law.</li>
          </ul>
          <p>Accounts that breach this section may be suspended or terminated.</p>
        </section>

        <section className={styles.section}>
          <h2>7. Your data</h2>
          <p>
            You retain ownership of your content and your customers&apos; messages. You grant
            Siffty the permission needed to process that content in order to provide the
            service, as described in the <Link href="/privacy">Privacy Policy</Link>.
          </p>
          <p>
            You are responsible for handling the personal data of people who message you
            lawfully, including telling them how their data is used where the law requires it.
          </p>
        </section>

        <section className={styles.section}>
          <h2>8. Availability</h2>
          <p>
            Siffty is provided on an &quot;as is&quot; and &quot;as available&quot; basis with
            no uptime guarantee. It depends on Meta&apos;s APIs and on third-party providers,
            and may be interrupted, changed, or discontinued.
          </p>
        </section>

        <section className={styles.section}>
          <h2>9. Liability</h2>
          <p>
            To the maximum extent permitted by law, Siffty is not liable for indirect,
            incidental, special, or consequential losses, or for lost profits, revenue, data,
            or business opportunities — including messages that are misclassified, delayed, not
            delivered, or automatically sent while automatic replies are enabled.
          </p>
        </section>

        <section className={styles.section}>
          <h2>10. Termination</h2>
          <p>
            You may stop using Siffty and delete your account at any time; see the{' '}
            <Link href="/data-deletion">data deletion page</Link>. Deletion is immediate and
            irreversible, apart from the limited trial-abuse record described in the{' '}
            <Link href="/privacy">Privacy Policy</Link>. We may suspend or terminate accounts
            that breach these terms.
          </p>
        </section>

        <section className={styles.section}>
          <h2>11. Governing law</h2>
          <p>
            These terms are governed by the laws of India. Disputes are subject to the exclusive
            jurisdiction of the courts at Seoni, Madhya Pradesh 480886, India.
          </p>
        </section>

        <section className={styles.section}>
          <h2>12. Changes</h2>
          <p>
            These terms may change. Material changes will be reflected in the date above and
            notified in the app or by email. Continuing to use Siffty after a change means
            you accept it.
          </p>
        </section>

        <p className={styles.contact}>
          Questions about these terms: <strong>{SUPPORT_EMAIL}</strong>
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
