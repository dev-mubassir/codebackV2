import Link from 'next/link';
import LegalLayout from '@/app/components/public/LegalLayout';
import { meta, legal } from '@/content/copy';
import styles from '@/app/components/public/public.module.css';

export const metadata = {
  title: meta.howToUse.title,
  description: meta.howToUse.description,
};

const TOC_ITEMS = [
  { id: 'safety-first', title: 'Important: AI Reply is Default OFF' },
  { id: 'step-1', title: 'Step 1: Account & Onboarding' },
  { id: 'step-2', title: 'Step 2: Knowledge Base Ground-Truth' },
  { id: 'step-3', title: 'Step 3: Connect Instagram Account' },
  { id: 'step-4', title: 'Step 4: Smart Inbox & CRM Folders' },
  { id: 'step-5', title: 'Step 5: Review & Send Suggested Replies' },
  { id: 'step-6', title: 'Step 6: Choosing Your Reply Mode' },
  { id: 'step-7', title: 'Step 7: Safety Pacing & Human Handoff' },
];

export default function HowToUsePage() {
  return (
    <LegalLayout
      eyebrow="STEP-BY-STEP GUIDE"
      title="How to Use Siffty"
      subtitle="A complete walkthrough to connect your Instagram account, organize customer DMs with smart folders, and manage replies safely."
      badgeText="AI Auto-Reply Default OFF"
      breadcrumbCategory="Resources"
      breadcrumbCurrent="How to Use"
      tocItems={TOC_ITEMS}
    >
      {/* Important Safety Banner */}
      <section id="safety-first" className={styles.contentCard} style={{ borderColor: 'rgba(65, 105, 225, 0.3)', background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)' }}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle} style={{ color: '#4169e1' }}>
            <span className={styles.sectionNumber} style={{ background: '#4169e1', color: '#ffffff' }}>🛡️</span>
            Important: AI Auto-Reply is Default OFF
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p style={{ fontSize: '1.02rem', fontWeight: 600, color: '#0c0c0e' }}>
            Siffty is built on a strict fail-closed architecture: your account starts in 100% Manual Mode.
          </p>
          <p>
            When you first sign up or connect an Instagram account, Siffty will <strong>NEVER</strong> send an
            automated message to any customer on your behalf.
          </p>
          <div className={styles.calloutBox}>
            <p>
              <strong>You are always in control:</strong> Siffty analyzes inbound customer messages and prepares
              accurate draft replies in your compose box. No message leaves your account unless you review and click
              <strong> Send</strong>, or unless you explicitly choose to enable automatic sending in your Settings.
            </p>
          </div>
        </div>
      </section>

      {/* Step 1: Account & Onboarding */}
      <section id="step-1" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>1</span>
            Step 1: Create Account &amp; Complete Onboarding
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Getting started with Siffty takes under 2 minutes:
          </p>
          <ol>
            <li>
              Sign up with your email and password at <Link href="/register">Create Account</Link>.
            </li>
            <li>
              Follow the quick 3-step <strong>Onboarding Wizard</strong>.
            </li>
            <li>
              Select the preset knowledge template matching your business (e.g. <em>Fashion Boutique, Video Editor,
              Online Store, Real Estate, Coaching, E-commerce, Freelancer, Agency</em>, or custom).
            </li>
          </ol>
          <p>
            The template pre-populates standard questions, service items, and policies that you can customize to
            match your exact offerings.
          </p>
        </div>
      </section>

      {/* Step 2: Knowledge Base Ground-Truth */}
      <section id="step-2" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>2</span>
            Step 2: Fill in Your Business Knowledge Base
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Siffty drafts replies using <strong>only the ground-truth facts you provide</strong>. It never guesses
            pricing or promises services you haven&apos;t approved.
          </p>
          <p>
            In your <strong>Settings → Knowledge Base</strong>, provide:
          </p>
          <ul>
            <li><strong>Business Profile:</strong> Name, category, and a brief description of what you do.</li>
            <li><strong>Products &amp; Services:</strong> List of items, standard prices, and turnaround times.</li>
            <li><strong>Delivery &amp; Coverage:</strong> Shipping areas, delivery times, or consultation booking links.</li>
            <li><strong>Payment Methods:</strong> UPI, credit card, bank transfer, or invoice terms.</li>
            <li><strong>Frequently Asked Questions (FAQs):</strong> Answers to return policies, sizes, sample edits, or revisions.</li>
            <li><strong>Tone of Voice:</strong> Friendly, professional, concise, or enthusiastic.</li>
          </ul>
          <div className={styles.calloutBox}>
            <p>
              <strong>Zero Hallucinations:</strong> If a customer asks a question that is not covered in your
              knowledge base, Siffty flags the message as <code>needsHuman</code> and alerts you rather than inventing an answer.
            </p>
          </div>
        </div>
      </section>

      {/* Step 3: Connect Instagram Account */}
      <section id="step-3" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>3</span>
            Step 3: Connect Your Instagram Professional Account
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Connect your Instagram account through the official Meta Graph API:
          </p>
          <ol>
            <li>Navigate to <strong>Dashboard</strong> or <strong>Accounts</strong>.</li>
            <li>Click <strong>Connect Instagram</strong>.</li>
            <li>
              Authorize Siffty using Facebook login. You will be asked to select your Instagram Professional
              (Business or Creator) account.
            </li>
            <li>Confirm permissions for messaging and profile read.</li>
          </ol>
          <p>
            Once connected, your account is immediately active. Siffty listens for incoming direct messages via
            secure, HMAC-SHA256 signature-verified webhooks.
          </p>
          <div className={styles.calloutBox}>
            <p>
              <strong>Security Guarantee:</strong> Siffty never asks for your Instagram password. Meta access tokens
              are encrypted at rest with AES-256-GCM envelope encryption.
            </p>
          </div>
        </div>
      </section>

      {/* Step 4: Smart Inbox & CRM Folders */}
      <section id="step-4" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>4</span>
            Step 4: Explore the 3-Column Smart Inbox
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Open <Link href="/inbox">Inbox</Link> to view your real-time conversation workspace. When a customer
            sends a DM, it streams instantly to your screen without needing a page refresh.
          </p>
          <p>
            Siffty automatically sorts conversations into dedicated smart folders:
          </p>

          <div className={styles.tableContainer}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Folder</th>
                  <th>What It Contains</th>
                  <th>Your Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Needs your reply</strong></td>
                  <td>Urgent messages, complex inquiries, or chats requiring personal attention.</td>
                  <td>Review and reply personally.</td>
                </tr>
                <tr>
                  <td><strong>Hot leads</strong></td>
                  <td>High purchase intent (score ≥ 80), inquiries ready to buy, budget confirmations.</td>
                  <td>Send payment details or close sale.</td>
                </tr>
                <tr>
                  <td><strong>Leads &amp; questions</strong></td>
                  <td>Inquiries about pricing, services, catalog items, or availability.</td>
                  <td>Send suggested product knowledge.</td>
                </tr>
                <tr>
                  <td><strong>Brand deals</strong></td>
                  <td>Creator sponsorships, collaboration pitches, and PR agency proposals.</td>
                  <td>Review extracted deal summary card.</td>
                </tr>
                <tr>
                  <td><strong>Customers</strong></td>
                  <td>Returning buyers with past purchase histories.</td>
                  <td>Provide priority after-sales care.</td>
                </tr>
                <tr>
                  <td><strong>Spam &amp; scams</strong></td>
                  <td>Crypto bots, suspicious links, phishing, or abusive direct messages.</td>
                  <td>Filtered automatically from notifications.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Step 5: Review & Send Suggested Replies */}
      <section id="step-5" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>5</span>
            Step 5: Review &amp; Send Suggested Replies (Manual Default)
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Because AI auto-reply is <strong>OFF by default</strong>, your standard workflow is fast, safe, and manual:
          </p>
          <ol>
            <li>Select a conversation in the Inbox list.</li>
            <li>View the <strong>Conversation Insights</strong> panel (buying intent, customer type, summary).</li>
            <li>
              Look at the message composer: Siffty has already generated a suggested reply based on your knowledge base.
            </li>
            <li>
              Review the draft. You can keep it as is, make quick edits, or erase it and type your own message.
            </li>
            <li>
              Click <strong>Send</strong>. Siffty delivers the response to your customer through Instagram Graph API.
            </li>
          </ol>
          <div className={styles.calloutBox}>
            <p>
              This hybrid workflow saves you 80% of repetitive typing while guaranteeing that no message is ever sent
              without your explicit approval.
            </p>
          </div>
        </div>
      </section>

      {/* Step 6: Choosing Your Reply Mode */}
      <section id="step-6" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>6</span>
            Step 6: Choosing Your Reply Mode (Optional Automation)
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            If you ever choose to automate routine inquiries, you can adjust your mode from{' '}
            <strong>Settings → Replies and Tone → Reply Mode</strong>:
          </p>

          <div className={styles.tableContainer}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Reply Mode</th>
                  <th>Status</th>
                  <th>How It Works</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Manual (<code>human_only</code>)</strong></td>
                  <td><span style={{ color: '#10b981', fontWeight: 700 }}>Default</span></td>
                  <td>Nothing is ever sent automatically. You write and dispatch all messages.</td>
                </tr>
                <tr>
                  <td><strong>Suggested Drafts (<code>suggest_only</code>)</strong></td>
                  <td>Optional</td>
                  <td>AI prepares draft suggestions in the composer; leaves only when you click Send.</td>
                </tr>
                <tr>
                  <td><strong>Automatic (<code>smart</code>)</strong></td>
                  <td>Optional</td>
                  <td>Routine, safe questions matching your knowledge base are answered automatically.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>Per-Conversation Overrides</h3>
          <p>
            Even if you turn on Automatic mode globally, you can switch any individual conversation to{' '}
            <strong>Manual</strong> directly from the chat header. Siffty will immediately stop auto-replying in that
            thread and hand complete control to you.
          </p>
        </div>
      </section>

      {/* Step 7: Safety Pacing & Human Handoff */}
      <section id="step-7" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>7</span>
            Step 7: Safety Pacing, Rate Limits &amp; Human Handoff
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            When automatic replies are enabled, Siffty protects your account with multi-layered safety gates:
          </p>
          <ul>
            <li>
              <strong>Anti-Loop Guard:</strong> Short acknowledgments like <em>&quot;ok&quot;</em>, <em>&quot;thanks&quot;</em>,
              <em>&quot;cool&quot;</em>, or <em>&quot;got it&quot;</em> are detected and ignored so your assistant never gets trapped
              in an infinite conversation loop.
            </li>
            <li>
              <strong>Consecutive Reply Cap (Max 2):</strong> Siffty will never send more than 2 consecutive automated
              messages in a row without a human response. If the customer asks more questions, Siffty pauses and flags
              the chat for your personal attention.
            </li>
            <li>
              <strong>Daily Rate Limit (Max 3 / 24 Hours):</strong> No single chat thread receives more than 3 auto-replies
              per day.
            </li>
            <li>
              <strong>Instant Disconnect &amp; Deletion:</strong> You can disconnect your Instagram account anytime from
              Dashboard, or permanently erase all stored data from <Link href="/data-deletion">Delete Your Data</Link>.
            </li>
          </ul>
        </div>
      </section>
    </LegalLayout>
  );
}
