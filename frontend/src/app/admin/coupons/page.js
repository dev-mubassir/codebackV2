'use client';

/**
 * Admin — coupons and the influencer report (Gate 6).
 *
 * Codes are redeemed at signup (and at trial claim) — that records which
 * influencer brought the customer. Applying the discount at checkout is not
 * built yet (Cashfree changes were out of scope). Coupons are never deleted,
 * only turned off, so the report keeps its history. Every change needs a
 * written reason and is audited.
 */

import { useEffect, useState } from 'react';
import { createAdminCoupon, getAdminCouponReport, getAdminCoupons, updateAdminCoupon } from '@/lib/api';
import { Badge, Button, Input, Select, Skeleton } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import { formatDate } from '@/content/format';
import ReasonDialog from '../_components/ReasonDialog';
import styles from '../admin.module.css';

const c = t.coupons;
const EMPTY = { code: '', discountType: 'PERCENT', value: '', currency: 'INR', maxUses: '', expiresAt: '', influencerTag: '' };

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState(null);
  const [report, setReport] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [pending, setPending] = useState(null); // { kind: 'create' } | { kind: 'toggle', coupon }
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const load = async () => {
    try {
      const [list, rep] = await Promise.all([getAdminCoupons(), getAdminCouponReport()]);
      setCoupons(list);
      setReport(rep);
    } catch {
      setError(errors.admin.settings);
    }
  };
  useEffect(() => {
    let cancelled = false;
    Promise.all([getAdminCoupons(), getAdminCouponReport()])
      .then(([list, rep]) => { if (!cancelled) { setCoupons(list); setReport(rep); } })
      .catch(() => { if (!cancelled) setError(errors.admin.settings); });
    return () => { cancelled = true; };
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function confirm(reason) {
    setBusy(true);
    setDialogError('');
    try {
      if (pending.kind === 'create') {
        await createAdminCoupon({
          code: form.code,
          discountType: form.discountType,
          value: Number(form.value),
          ...(form.discountType === 'FLAT' ? { currency: form.currency } : {}),
          maxUses: form.maxUses === '' ? null : Number(form.maxUses),
          expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
          influencerTag: form.influencerTag || null,
          reason,
        });
        setForm(EMPTY);
      } else {
        await updateAdminCoupon(pending.coupon.id, { isActive: !pending.coupon.isActive, reason });
      }
      setPending(null);
      await load();
    } catch (err) {
      setDialogError(err?.response?.data?.error || errors.generic);
    } finally {
      setBusy(false);
    }
  }

  if (!coupons && !error) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;

  return (
    <div className={styles.stack}>
      <p className={styles.pageLeadText}>{c.checkoutNote}</p>
      {error && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{error}</span></div>}

      <section className={styles.panel}>
        <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{c.report}</h2></div>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.tableCompact}`}>
            <thead><tr><th>{c.tag}</th><th>{c.code}</th><th>{c.signups}</th><th>{c.paid}</th><th>{c.rate}</th></tr></thead>
            <tbody>
              {report.map((r) => (
                <tr key={r.influencerTag}>
                  <td>{r.influencerTag}</td>
                  <td className={styles.cellMono}>{r.coupons.join(', ')}</td>
                  <td>{r.signups}</td>
                  <td>{r.paidConversions}</td>
                  <td>{(r.conversionRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{t.nav.coupons}</h2></div>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.tableCompact}`}>
            <thead><tr><th>{c.code}</th><th>{c.type}</th><th>{c.used}</th><th>{c.expiresAt}</th><th>{c.tag}</th><th /></tr></thead>
            <tbody>
              {(coupons || []).map((x) => (
                <tr key={x.id}>
                  <td className={styles.cellMono}>{x.code} {x.isActive ? <Badge tone="positive">{c.active}</Badge> : <Badge tone="neutral">{c.inactive}</Badge>}</td>
                  <td>{x.discountType === 'PERCENT' ? `${x.value}%` : `${x.value} ${x.currency}`}</td>
                  <td>{x.usedCount}{x.maxUses != null ? ` / ${x.maxUses}` : ''}</td>
                  <td>{x.expiresAt ? formatDate(x.expiresAt) : '—'}</td>
                  <td>{x.influencerTag || '—'}</td>
                  <td className={styles.alignRight}>
                    <Button size="sm" onClick={() => { setDialogError(''); setPending({ kind: 'toggle', coupon: x }); }}>{x.isActive ? c.turnOff : c.turnOn}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{c.newCoupon}</h2></div>
        <form className={styles.passwordForm} onSubmit={(e) => { e.preventDefault(); setDialogError(''); setPending({ kind: 'create' }); }}>
          <Input label={c.code} value={form.code} onChange={set('code')} required maxLength={32} />
          <Select label={c.type} value={form.discountType} onChange={set('discountType')}>
            <option value="PERCENT">{c.percent}</option>
            <option value="FLAT">{c.flat}</option>
          </Select>
          <Input label={c.value} type="number" min="1" value={form.value} onChange={set('value')} required />
          {form.discountType === 'FLAT' && (
            <Select label={c.currency} value={form.currency} onChange={set('currency')}>
              <option value="INR">INR</option>
              <option value="USD">USD</option>
            </Select>
          )}
          <Input label={c.maxUses} type="number" min="1" value={form.maxUses} onChange={set('maxUses')} />
          <Input label={c.expiresAt} type="date" value={form.expiresAt} onChange={set('expiresAt')} />
          <Input label={c.tag} value={form.influencerTag} onChange={set('influencerTag')} maxLength={40} />
          {form.code && <p className={styles.cellSub}>{c.link}{form.code.toUpperCase()}</p>}
          <div><Button type="submit" variant="primary">{c.create}</Button></div>
        </form>
      </section>

      {pending && (
        <ReasonDialog
          title={pending.kind === 'create' ? c.create : `${pending.coupon.isActive ? c.turnOff : c.turnOn}: ${pending.coupon.code}`}
          actionLabel={pending.kind === 'create' ? c.create : pending.coupon.isActive ? c.turnOff : c.turnOn}
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onClose={() => { if (!busy) setPending(null); }}
        />
      )}
    </div>
  );
}
