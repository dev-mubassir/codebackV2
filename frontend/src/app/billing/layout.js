import { billing } from '@/content/billingCopy';

/**
 * Metadata lives in a layout rather than the page because the page is a
 * client component ('use client' — it needs hooks for the summary, the
 * catalogue and the ?renew= deep link), and the app router only reads a
 * `metadata` export from server components. Same split every other
 * interactive page in this app uses.
 *
 * Strings come from content/billingCopy rather than content/copy: Gate 6
 * owns copy.js, and two gates appending to one file is the merge conflict
 * the split exists to avoid.
 */
export const metadata = {
  title: billing.meta.title,
  description: billing.meta.description,
};

export default function BillingLayout({ children }) {
  return children;
}
