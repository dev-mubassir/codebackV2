'use client';

/**
 * Admin — payment history (Gate 6). Read-only, from the orders, payment
 * attempts and refunds Siffty already stores — no call to Cashfree, and no
 * raw payment payloads (the API never returns them).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAdminPayments } from '@/lib/api';
import { Badge, Button, Select, Skeleton } from '@/app/components/ui';
import { admin as t, common, errors } from '@/content/copy';
import { formatDateTime } from '@/content/format';
import styles from '../admin.module.css';

const c = t.payments;
const money = (amount, currency) => `${(amount / 100).toFixed(2)} ${currency}`;
const TONE = { PAID: 'positive', CREATED: 'neutral', EXPIRED: 'warning' };

export default function AdminPaymentsPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (page = 1, st = status) => {
    try {
      setData(await getAdminPayments(page, st));
      setError('');
    } catch {
      setError(errors.admin.settings);
    }
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    getAdminPayments(1, '')
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(errors.admin.settings); });
    return () => { cancelled = true; };
  }, []);

  if (!data && !error) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;
  const pg = data?.pagination || { page: 1, totalPages: 1 };

  return (
    <div className={styles.stack}>
      {error && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{error}</span></div>}
      <div className={styles.filters}>
        <Select aria-label={c.status} value={status} onChange={(e) => { setStatus(e.target.value); load(1, e.target.value); }}>
          <option value="">{c.all}</option>
          <option value="PAID">PAID</option>
          <option value="CREATED">CREATED</option>
          <option value="EXPIRED">EXPIRED</option>
        </Select>
      </div>
      <section className={styles.panel}>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.tableCompact}`}>
            <thead>
              <tr><th>{c.order}</th><th>{c.customer}</th><th>{c.item}</th><th>{c.amount}</th><th>{c.status}</th><th>{c.paid}</th><th>{c.attempts}</th><th>{c.refunds}</th></tr>
            </thead>
            <tbody>
              {(data?.payments || []).length === 0 ? (
                <tr><td colSpan="8" className={styles.cellEmpty}>{c.none}</td></tr>
              ) : data.payments.map((p) => (
                <tr key={p.id}>
                  <td className={styles.cellMono}>{p.cashfreeOrderId}</td>
                  <td>{p.customerEmail ? <Link href={`/admin/users/${p.tenantId}`}>{p.customerEmail}</Link> : <span className={styles.cellSub}>{c.deleted}</span>}</td>
                  <td className={styles.cellMono}>{p.planCode || p.addonCode}</td>
                  <td>{money(p.amount, p.currency)}</td>
                  <td><Badge tone={TONE[p.status] || 'neutral'}>{p.status}</Badge></td>
                  <td>{p.paidAt ? formatDateTime(p.paidAt) : '—'}</td>
                  <td>{p.attempts.map((a) => a.status).join(', ') || '—'}</td>
                  <td>{p.refunds.map((r) => `${money(r.amount, p.currency)} ${r.status}`).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className={styles.pagination}>
        <span>{pg.page} / {pg.totalPages || 1}</span>
        <div className={styles.paginationButtons}>
          <Button size="sm" disabled={pg.page <= 1} onClick={() => load(pg.page - 1)}>{common.previous}</Button>
          <Button size="sm" disabled={pg.page >= pg.totalPages} onClick={() => load(pg.page + 1)}>{common.next}</Button>
        </div>
      </div>
    </div>
  );
}
