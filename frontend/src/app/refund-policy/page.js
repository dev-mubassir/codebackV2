import Link from 'next/link';
import LegalLayout from '@/app/components/public/LegalLayout';
import { meta, legal } from '@/content/copy';
import { SUPPORT_EMAIL, BUSINESS_NAME } from '@/content/contact';
import styles from '@/app/components/public/public.module.css';

export const metadata = {
  title: meta.refundPolicy.title,
  description: meta.refundPolicy.description,
};

const LAST_UPDATED = '15 September 2026';
const REFUND_WINDOW_DAYS = 7;
const PLAN_USAGE_LIMIT_PERCENT = 20;

const TOC_ITEMS = [
  { id: 'how-payments-work', title: '1. How paying for Siffty works' },
  { id: 'plan-purchases', title: '2. Plan purchases' },
  { id: 'add-ons', title: '3. Add-ons' },
  { id: 'not-available', title: '4. When a refund is not available' },
  { id: 'free-trials', title: '5. Free trials' },
  { id: 'how-refund-paid', title: '6. How a refund is paid' },
  { id: 'how-to-ask', title: '7. How to ask for a refund' },
  { id: 'your-rights', title: '8. Your rights' },
];

export default function RefundPolicyPage() {
  return (
    <LegalLayout
      eyebrow="BILLING & POLICIES"
      title={legal.refundPolicyTitle}
      subtitle="Transparent, straightforward refund terms with no auto-debit, no hidden mandates, and clear eligibility thresholds."
      badgeText={`${legal.lastUpdated}: ${LAST_UPDATED}`}
      breadcrumbCategory="Legal"
      breadcrumbCurrent="Refund Policy"
      tocItems={TOC_ITEMS}
    >
      {/* Policy Guarantee Banner Box */}
      <div className={styles.calloutBox} style={{ margin: '0 0 28px 0', borderLeftColor: '#10b981', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(16, 185, 129, 0.01) 100%)', borderColor: 'rgba(16, 185, 129, 0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, color: '#065f46', fontSize: '1rem', marginBottom: '6px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          <span>{REFUND_WINDOW_DAYS}-Day Satisfaction Window Guarantee</span>
        </div>
        <p style={{ margin: 0, color: '#065f46', fontSize: '0.92rem' }}>
          Plan purchases qualify for a full refund if requested within {REFUND_WINDOW_DAYS} days of payment
          and less than {PLAN_USAGE_LIMIT_PERCENT}% of the purchased credits have been consumed.
        </p>
      </div>

      {/* 1. How paying for Siffty works */}
      <section id="how-payments-work" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>1</span>
            How paying for Siffty works
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Every plan period and every add-on top-up is a one-time payment. A plan runs for 30
            days. Nothing renews automatically and there is no subscription to cancel: when a
            period ends, it ends, unless you choose to buy another one.
          </p>
        </div>
      </section>

      {/* 2. Plan purchases */}
      <section id="plan-purchases" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>2</span>
            Plan purchases
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>A plan purchase is refunded in full when both of these are true:</p>
          <ul>
            <li>you ask within {REFUND_WINDOW_DAYS} days of the payment, and</li>
            <li>less than {PLAN_USAGE_LIMIT_PERCENT}% of the credits from that purchase have been used.</li>
          </ul>
          <div className={styles.calloutBox}>
            <p>
              <strong>Calculation Example:</strong> A plan that gives you 500 credits qualifies while fewer
              than 100 of those 500 have been used. At 100 or more it does not.
            </p>
          </div>
          <p>
            Credits you already had are used first. If you buy a plan while you still have credits
            left from before, replies use those up before touching the new purchase, so they do not
            count against it. Usage is taken from your account&apos;s credit history.
          </p>
        </div>
      </section>

      {/* 3. Add-ons */}
      <section id="add-ons" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>3</span>
            Add-ons
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            <strong>Auto-reply top-ups</strong> are refunded in full if you ask within{' '}
            {REFUND_WINDOW_DAYS} days of the payment and the top-up is entirely unused — none of its
            credits have been used. Credits you already had are used first.
          </p>
          <p>
            <strong>Extra Instagram accounts</strong> are refunded in full if you ask within{' '}
            {REFUND_WINDOW_DAYS} days of the payment and no Instagram account has ever been connected
            using that extra account.
          </p>
        </div>
      </section>

      {/* 4. When a refund is not available */}
      <section id="not-available" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>4</span>
            When a refund is not available
          </h2>
        </div>
        <div className={styles.cardBody}>
          <ul>
            <li>More than {REFUND_WINDOW_DAYS} days after the payment.</li>
            <li>After the plan period you paid for has ended.</li>
            <li>
              When {PLAN_USAGE_LIMIT_PERCENT}% or more of the credits from a plan purchase have been
              used.
            </li>
            <li>When any of a top-up&apos;s credits have been used.</li>
            <li>When an Instagram account has been connected using an extra account.</li>
          </ul>
        </div>
      </section>

      {/* 5. Free trials */}
      <section id="free-trials" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>5</span>
            Free trials
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Trials are free and take no payment details, so there is nothing to refund.
          </p>
        </div>
      </section>

      {/* 6. How a refund is paid */}
      <section id="how-refund-paid" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>6</span>
            How a refund is paid
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Refunds go back to the original payment method only. They typically arrive within 5–7
            business days after we issue them, depending on your bank or card provider.
          </p>
          <p>
            When a refund is issued, the plan time or top-up it paid for ends, and the auto-reply
            credits it gave you are removed from your balance.
          </p>
        </div>
      </section>

      {/* 7. How to ask for a refund */}
      <section id="how-to-ask" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>7</span>
            How to ask for a refund
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>
            Use the <Link href="/contact">contact page</Link> or email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Include the email address on
            your Siffty account and the date of the payment.
          </p>
        </div>
      </section>

      {/* 8. Your rights */}
      <section id="your-rights" className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            <span className={styles.sectionNumber}>8</span>
            Your rights
          </h2>
        </div>
        <div className={styles.cardBody}>
          <p>This policy does not limit any rights you have under applicable law.</p>
          <div className={styles.calloutBox} style={{ marginTop: '16px' }}>
            <p>
              {BUSINESS_NAME}, India. Questions: <a href={`mailto:${SUPPORT_EMAIL}`}><strong>{SUPPORT_EMAIL}</strong></a>
            </p>
          </div>
        </div>
      </section>
    </LegalLayout>
  );
}
