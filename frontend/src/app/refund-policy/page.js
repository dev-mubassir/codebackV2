import Link from 'next/link';
import { meta, legal } from '@/content/copy';
import { SUPPORT_EMAIL, BUSINESS_NAME } from '@/content/contact';
import styles from '../legal/legal.module.css';

export const metadata = {
  title: meta.refundPolicy.title,
  description: meta.refundPolicy.description,
};

/**
 * /refund-policy — Gate 11d.
 *
 * OWNER ACTION BEFORE LAUNCH. This page has legal weight and was drafted from
 * how the product works, not by a lawyer. It must be reviewed by someone
 * qualified against Indian consumer protection rules and Cashfree's merchant
 * requirements, and the Cashfree dashboard should be checked for exactly which
 * policy pages account activation currently requires. Nothing in code resolves
 * that.
 *
 * EVERY THRESHOLD IS A NUMBER. A policy that leaves the decision to us case by
 * case generates disputes rather than preventing them. Each rule here is one the
 * credit ledger can answer: usage is counted from SPEND rows after the payment.
 *
 * The terms must stay true to the revocation code (Gate 11c): a refunded
 * purchase's paid time and granted credits are removed.
 */

const LAST_UPDATED = '15 September 2026';
const REFUND_WINDOW_DAYS = 7;
const PLAN_USAGE_LIMIT_PERCENT = 20;

export default function RefundPolicyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>{legal.backToHome}</Link>

        <h1 className={styles.title}>{legal.refundPolicyTitle}</h1>
        <p className={styles.updated}>{legal.lastUpdated}: {LAST_UPDATED}</p>

        <section className={styles.section}>
          <h2>1. How paying for Siffty works</h2>
          <p>
            Every plan period and every add-on top-up is a one-time payment. A plan runs for 30
            days. Nothing renews automatically and there is no subscription to cancel: when a
            period ends, it ends, unless you choose to buy another one.
          </p>
        </section>

        <section className={styles.section}>
          <h2>2. Plan purchases</h2>
          <p>A plan purchase is refunded in full when both of these are true:</p>
          <ul>
            <li>you ask within {REFUND_WINDOW_DAYS} days of the payment, and</li>
            <li>
              fewer than {PLAN_USAGE_LIMIT_PERCENT}% of the auto-reply credits that purchase gave you
              have been used.
            </li>
          </ul>
          <div className={styles.callout}>
            <p>
              Example: a plan that gives you 500 auto-replies qualifies if you have sent 99 or fewer
              since paying. At 100 or more it does not.
            </p>
          </div>
          <p>
            Usage is counted from the auto-replies sent after the payment, as recorded in your
            account&apos;s credit history.
          </p>
        </section>

        <section className={styles.section}>
          <h2>3. Add-on top-ups</h2>
          <p>
            A top-up is refunded in full if you ask within {REFUND_WINDOW_DAYS} days of the payment
            and it is entirely unused — meaning no auto-reply has been sent since you bought it.
          </p>
        </section>

        <section className={styles.section}>
          <h2>4. When a refund is not available</h2>
          <ul>
            <li>More than {REFUND_WINDOW_DAYS} days after the payment.</li>
            <li>After the plan period you paid for has ended.</li>
            <li>
              When {PLAN_USAGE_LIMIT_PERCENT}% or more of a plan&apos;s auto-reply credits have been
              used.
            </li>
            <li>When any auto-reply has been sent since an add-on top-up was bought.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>5. Free trials</h2>
          <p>
            Trials are free and take no payment details, so there is nothing to refund.
          </p>
        </section>

        <section className={styles.section}>
          <h2>6. How a refund is paid</h2>
          <p>
            Refunds go back to the original payment method only. They typically arrive within 5–7
            business days after we issue them, depending on your bank or card provider.
          </p>
          <p>
            When a refund is issued, the plan time or top-up it paid for ends, and the auto-reply
            credits it gave you are removed from your balance.
          </p>
        </section>

        <section className={styles.section}>
          <h2>7. How to ask for a refund</h2>
          <p>
            Use the <Link href="/contact">contact page</Link> or email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Include the email address on
            your Siffty account and the date of the payment.
          </p>
        </section>

        <section className={styles.section}>
          <h2>8. Your rights</h2>
          <p>This policy does not limit any rights you have under applicable law.</p>
        </section>

        <p className={styles.contact}>
          {BUSINESS_NAME}, India. Questions: <strong>{SUPPORT_EMAIL}</strong>
        </p>

        <nav className={styles.footerNav} aria-label="Legal">
          <Link href="/privacy" className={styles.footerNavLink}>{legal.footerLinks.privacy}</Link>
          <Link href="/terms" className={styles.footerNavLink}>{legal.footerLinks.terms}</Link>
          <Link href="/refund-policy" className={styles.footerNavLink}>{legal.footerLinks.refundPolicy}</Link>
          <Link href="/data-deletion" className={styles.footerNavLink}>{legal.footerLinks.dataDeletion}</Link>
          <Link href="/support" className={styles.footerNavLink}>{legal.footerLinks.support}</Link>
          <Link href="/contact" className={styles.footerNavLink}>{legal.footerLinks.contact}</Link>
        </nav>
      </div>
    </main>
  );
}
