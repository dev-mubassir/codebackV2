import Link from 'next/link';
import LegalLayout from '@/app/components/public/LegalLayout';
import { meta, legal } from '@/content/copy';
import { SUPPORT_EMAIL } from '@/content/contact';
import styles from '@/app/components/public/public.module.css';

export const metadata = {
  title: meta.terms.title,
  description: meta.terms.description,
};

const LAST_UPDATED = '25 September 2026';

const TOC_ITEMS = [
  { id: 'agreement', title: '1. Agreement' },
  { id: 'service-scope', title: '2. What the service does' },
  { id: 'instagram-meta', title: "3. Your Instagram account & Meta's terms" },
  { id: 'automated-replies', title: '4. Automated replies' },
  { id: 'output-guarantee', title: '5. Automated output is not guaranteed' },
  { id: 'plans-credits-payments', title: '6. Plans, credits and payments' },
  { id: 'acceptable-use', title: '7. Acceptable use' },
  { id: 'your-data', title: '8. Your data' },
  { id: 'availability', title: '9. Availability' },
  { id: 'liability', title: '10. Liability' },
  { id: 'termination', title: '11. Termination' },
  { id: 'governing-law', title: '12. Governing law' },
  { id: 'changes', title: '13. Changes' },
];

export default function TermsPage() {
  return (
    <LegalLayout
      eyebrow="LEGAL & TERMS"
      title={legal.termsTitle}
      subtitle="The terms governing your use of Siffty, Instagram connections, and automated replies."
      badgeText={`${legal.lastUpdated}: ${LAST_UPDATED}`}
      breadcrumbCategory="Legal"
      breadcrumbCurrent="Terms of Service"
      tocItems={TOC_ITEMS}
    >
      {/* 1. Agreement */}
      <section id="agreement" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>1</span>
            Agreement
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            These terms govern your use of Siffty. By creating an account or connecting an
            Instagram account you agree to them. If you are using Siffty for an organisation,
            you confirm you are authorised to accept these terms on its behalf.
          </p>
          <p>
            You must be at least 18 years old to use Siffty. Siffty is operated by
            Siffty (proprietor: Mubassir Shah), India.
          </p>
        </div>
      </section>

      {/* 2. What the service does */}
      <section id="service-scope" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>2</span>
            What the service does
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Siffty connects to an Instagram professional account you control, receives direct
            messages sent to it, organises them, and helps you reply — including by generating
            draft replies with automated assistance.
          </p>
        </div>
      </section>

      {/* 3. Your Instagram account and Meta's terms */}
      <section id="instagram-meta" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>3</span>
            Your Instagram account and Meta&apos;s terms
          </h2>
        </div>
        <div className={styles.cardBody}>
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
        </div>
      </section>

      {/* 4. Automated replies */}
      <section id="automated-replies" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>4</span>
            Automated replies
          </h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.calloutBox}>
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
        </div>
      </section>

      {/* 5. Automated output is not guaranteed */}
      <section id="output-guarantee" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>5</span>
            Automated output is not guaranteed
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Classifications, summaries, priority scores, extracted deal details, and draft
            replies are produced by automated systems and can be wrong. They are suggestions,
            not advice or fact. Review anything before you rely on it or send it. You are
            responsible for every message sent from your Instagram account, whether you typed
            it or approved it.
          </p>
        </div>
      </section>

      {/* 6. Plans, credits and payments */}
      <section id="plans-credits-payments" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>6</span>
            Plans, credits and payments
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Paid plans are one-time purchases of a 30-day period. Nothing renews automatically: a
            period ends unless you choose to buy another one. Prices are shown on the pricing section
            of our home page and on your billing page before you pay.
          </p>
          <p>A plan includes two separate kinds of credits:</p>
          <ul>
            <li>
              <strong>Auto-reply credits.</strong> One is used each time Siffty sends an automatic
              reply for you.
            </li>
            <li>
              <strong>AI draft credits.</strong> One is used each time you ask for an AI-drafted reply
              in the inbox and a draft is produced. A draft that fails costs nothing. Drafts are never
              sent unless you send them.
            </li>
          </ul>
          <p>
            One kind of credit is never used in place of the other. You can buy more of either as a
            one-time add-on for your current plan. Unused credits roll over to your next period, up to
            your plan&apos;s limit. If a plan lapses and is not renewed before its grace period ends,
            unused credits are cleared.
          </p>
          <p>
            Payments are processed by our payment partner, Cashfree Payments. Refunds follow our{' '}
            <Link href="/refund-policy">Refund Policy</Link>.
          </p>
        </div>
      </section>

      {/* 7. Acceptable use */}
      <section id="acceptable-use" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>7</span>
            Acceptable use
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>You agree not to use Siffty to:</p>
          <ul>
            <li>Send spam, bulk unsolicited messages, or anything unlawful, deceptive, harassing, or abusive.</li>
            <li>Access, or attempt to access, data belonging to another customer.</li>
            <li>Interfere with, overload, probe, or reverse-engineer the service.</li>
            <li>Breach Meta&apos;s platform terms or any applicable law, including messaging and privacy law.</li>
          </ul>
          <div className={styles.calloutBox}>
            <p>Accounts that breach this section may be suspended or terminated.</p>
          </div>
        </div>
      </section>

      {/* 8. Your data */}
      <section id="your-data" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>8</span>
            Your data
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            You retain ownership of your content and your customers&apos; messages. You grant
            Siffty the permission needed to process that content in order to provide the
            service, as described in the <Link href="/privacy">Privacy Policy</Link>.
          </p>
          <p>
            You are responsible for handling the personal data of people who message you
            lawfully, including telling them how their data is used where the law requires it.
          </p>
        </div>
      </section>

      {/* 9. Availability */}
      <section id="availability" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>9</span>
            Availability
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Siffty is provided on an &quot;as is&quot; and &quot;as available&quot; basis with
            no uptime guarantee. It depends on Meta&apos;s APIs and on third-party providers,
            and may be interrupted, changed, or discontinued.
          </p>
        </div>
      </section>

      {/* 10. Liability */}
      <section id="liability" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>10</span>
            Liability
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            To the maximum extent permitted by law, Siffty is not liable for indirect,
            incidental, special, or consequential losses, or for lost profits, revenue, data,
            or business opportunities — including messages that are misclassified, delayed, not
            delivered, or automatically sent while automatic replies are enabled.
          </p>
        </div>
      </section>

      {/* 11. Termination */}
      <section id="termination" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>11</span>
            Termination
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            You may stop using Siffty and delete your account at any time; see the{' '}
            <Link href="/data-deletion">data deletion page</Link>. Deletion is immediate and
            irreversible, apart from the limited trial-abuse record described in the{' '}
            <Link href="/privacy">Privacy Policy</Link>. We may suspend or terminate accounts
            that breach these terms.
          </p>
        </div>
      </section>

      {/* 12. Governing law */}
      <section id="governing-law" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>12</span>
            Governing law
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            These terms are governed by the laws of India. Disputes are subject to the exclusive
            jurisdiction of the courts at Seoni, Madhya Pradesh 480886, India.
          </p>
        </div>
      </section>

      {/* 13. Changes */}
      <section id="changes" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>13</span>
            Changes
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            These terms may change. Material changes will be reflected in the date above and
            notified in the app or by email. Continuing to use Siffty after a change means
            you accept it.
          </p>
          <div className={styles.calloutBox} style={{ marginTop: '16px' }}>
            <p>
              Questions about these terms:{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}><strong>{SUPPORT_EMAIL}</strong></a>
            </p>
          </div>
        </div>
      </section>
    </LegalLayout>
  );
}
