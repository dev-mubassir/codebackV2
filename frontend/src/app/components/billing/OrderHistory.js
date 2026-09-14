'use client';

/**
 * Every payment attempt on the account, successful or not.
 *
 * FAILED AND ABANDONED ATTEMPTS ARE SHOWN ON PURPOSE. The obvious instinct
 * is to list only PAID rows and keep the table tidy, but the single most
 * common billing support message is "I paid and nothing happened" — and the
 * honest answer is usually an attempt that was never completed, or one that
 * failed at the bank. Showing those rows, with their own status, answers
 * that question before it is asked. A tidy table that hides the row the
 * customer is asking about is worse than an untidy one.
 *
 * Amounts are rendered from the order's OWN stored amount and currency, not
 * recalculated from today's catalogue: a row must keep showing what was
 * actually charged even after the price changes.
 */

import { formatDateTime } from '@/content/format';
import { formatPrice } from '@/lib/pricing';
import { billing } from '@/content/billingCopy';
import styles from './billing.module.css';

/** OrderStatus -> the globals.css badge class that reads right for it. */
const STATUS_BADGE = {
  PAID: 'badge-success',
  CREATED: 'badge-default',
  FAILED: 'badge-error',
  EXPIRED: 'badge-warning',
};

/** Plan name where the catalogue knows it, the raw code where it does not (a retired plan). */
function itemLabel(order, plansByCode) {
  if (order.planCode) {
    return billing.orders.planItem(plansByCode[order.planCode]?.name || order.planCode);
  }
  if (order.addonCode) return billing.orders.addonItem(order.addonCode);
  return '—';
}

export default function OrderHistory({ orders, plans }) {
  const plansByCode = Object.fromEntries((plans || []).map((plan) => [plan.code, plan]));

  return (
    <section className={styles.panel} aria-label={billing.orders.heading}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{billing.orders.heading}</h2>
      </div>

      {!orders || orders.length === 0 ? (
        <p className={styles.help}>{billing.orders.empty}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{billing.orders.columnDate}</th>
                <th>{billing.orders.columnItem}</th>
                <th>{billing.orders.columnAmount}</th>
                <th>{billing.orders.columnStatus}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.cashfreeOrderId}>
                  {/* paidAt where it exists, createdAt otherwise: a failed
                      attempt still happened at a time worth showing. */}
                  <td>{formatDateTime(order.paidAt || order.createdAt)}</td>
                  <td>{itemLabel(order, plansByCode)}</td>
                  <td className={styles.amountCell}>{formatPrice(order.amount, order.currency)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[order.status] || 'badge-default'}`}>
                      {billing.orders.status[order.status] || order.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
