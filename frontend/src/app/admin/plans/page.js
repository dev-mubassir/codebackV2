'use client';

/**
 * Admin — plans (Gate 6). The catalogue lives in billing_plans + plan_prices.
 * An edit applies to NEW purchases and renewals only: each customer keeps the
 * limits they bought (the server snapshots them at every grant). Creating and
 * editing need a written reason and the password (step-up).
 */

import { useEffect, useState } from 'react';
import { createAdminPlan, getAdminPlans, updateAdminPlan } from '@/lib/api';
import { Badge, Button, Input, Skeleton } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import ReasonDialog from '../_components/ReasonDialog';
import { StepUpCancelled, useStepUp } from '../_components/StepUp';
import styles from '../admin.module.css';

const c = t.plans;
const INT_FIELDS = ['classificationCapCycle', 'classificationThrottlePerHour', 'autoReplyCreditsPerCycle', 'autoReplyBankCap', 'igAccountLimit'];
const EMPTY = { code: '', name: '', cycleLengthDays: '30', priceIn: '', priceIntl: '', features: '{}', isActive: false, isQuoteOnly: false, ...Object.fromEntries(INT_FIELDS.map((f) => [f, ''])) };

function toForm(plan) {
  const price = (region) => plan.prices.find((p) => p.billingRegion === region)?.amount;
  return {
    ...EMPTY,
    code: plan.code,
    name: plan.name,
    cycleLengthDays: String(plan.cycleLengthDays),
    priceIn: price('IN') != null ? String(price('IN')) : '',
    priceIntl: price('INTL') != null ? String(price('INTL')) : '',
    features: JSON.stringify(plan.features || {}),
    isActive: plan.isActive,
    isQuoteOnly: plan.isQuoteOnly,
    ...Object.fromEntries(INT_FIELDS.map((f) => [f, plan[f] == null ? '' : String(plan[f])])),
  };
}

/** Form -> API body. Throws a message string on invalid input. */
function toBody(form, creating) {
  let features;
  try {
    features = JSON.parse(form.features || '{}');
  } catch {
    throw c.badFeatures;
  }
  const num = (v) => (v === '' ? null : Number(v));
  const prices = [];
  if (form.priceIn !== '') prices.push({ billingRegion: 'IN', amount: Number(form.priceIn) });
  if (form.priceIntl !== '') prices.push({ billingRegion: 'INTL', amount: Number(form.priceIntl) });
  return {
    ...(creating ? { code: form.code.trim() } : {}),
    name: form.name,
    cycleLengthDays: Number(form.cycleLengthDays),
    isActive: form.isActive,
    isQuoteOnly: form.isQuoteOnly,
    features,
    ...(form.code === 'TRIAL' ? {} : { prices }),
    ...Object.fromEntries(INT_FIELDS.map((f) => [f, num(form[f])])),
  };
}

export default function AdminPlansPage() {
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | plan code
  const [form, setForm] = useState(EMPTY);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const { withStepUp } = useStepUp();

  const load = () => getAdminPlans().then(setPlans).catch(() => setError(errors.admin.settings));
  useEffect(() => {
    let cancelled = false;
    getAdminPlans().then((p) => { if (!cancelled) setPlans(p); }).catch(() => { if (!cancelled) setError(errors.admin.settings); });
    return () => { cancelled = true; };
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(reason) {
    setBusy(true);
    setDialogError('');
    try {
      const creating = editing === 'new';
      const body = { ...toBody(form, creating), reason };
      await withStepUp(() => (creating ? createAdminPlan(body) : updateAdminPlan(editing, body)));
      setConfirming(false);
      setEditing(null);
      await load();
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setDialogError(typeof err === 'string' ? err : err?.response?.data?.error || errors.generic);
    } finally {
      setBusy(false);
    }
  }

  if (!plans && !error) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;

  return (
    <div className={styles.stack}>
      <p className={styles.pageLeadText}>{c.note}</p>
      {error && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{error}</span></div>}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{t.nav.plans}</h2>
          <Button size="sm" onClick={() => { setForm(EMPTY); setEditing('new'); }}>{c.newPlan}</Button>
        </div>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.tableCompact}`}>
            <thead>
              <tr><th>{c.fields.code}</th><th>{c.fields.name}</th><th>{c.fields.classificationCapCycle}</th><th>{c.fields.autoReplyCreditsPerCycle}</th><th>{c.fields.priceIn}</th><th /></tr>
            </thead>
            <tbody>
              {(plans || []).map((p) => (
                <tr key={p.code}>
                  <td className={styles.cellMono}>{p.code} {p.isActive ? <Badge tone="positive">{c.visible}</Badge> : <Badge tone="neutral">{c.hidden}</Badge>}</td>
                  <td>{p.name}</td>
                  <td>{p.classificationCapCycle ?? '—'}</td>
                  <td>{p.autoReplyCreditsPerCycle ?? '—'}</td>
                  <td>{p.prices.find((x) => x.billingRegion === 'IN')?.amount ?? '—'}</td>
                  <td className={styles.alignRight}><Button size="sm" onClick={() => { setForm(toForm(p)); setEditing(p.code); }}>{c.edit}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <section className={styles.panel}>
          <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{editing === 'new' ? c.newPlan : `${c.edit} ${editing}`}</h2></div>
          <form className={styles.passwordForm} onSubmit={(e) => { e.preventDefault(); setDialogError(''); setConfirming(true); }}>
            {editing === 'new' && <Input label={c.fields.code} value={form.code} onChange={set('code')} required />}
            <Input label={c.fields.name} value={form.name} onChange={set('name')} required />
            {INT_FIELDS.map((f) => (
              <Input key={f} label={c.fields[f]} type="number" min="0" value={form[f]} onChange={set(f)} />
            ))}
            <Input label={c.fields.cycleLengthDays} type="number" min="1" max="366" value={form.cycleLengthDays} onChange={set('cycleLengthDays')} required />
            {form.code !== 'TRIAL' && (
              <>
                <Input label={c.fields.priceIn} type="number" min="1" value={form.priceIn} onChange={set('priceIn')} />
                <Input label={c.fields.priceIntl} type="number" min="1" value={form.priceIntl} onChange={set('priceIntl')} />
              </>
            )}
            <Input label={c.fields.features} value={form.features} onChange={set('features')} />
            <label className={styles.dialogBody}><input type="checkbox" checked={form.isActive} onChange={set('isActive')} /> {c.fields.isActive}</label>
            <label className={styles.dialogBody}><input type="checkbox" checked={form.isQuoteOnly} onChange={set('isQuoteOnly')} /> {c.fields.isQuoteOnly}</label>
            {editing === 'new' && <p className={styles.cellSub}>{c.notPurchasable}</p>}
            <div className={styles.rowActions}>
              <Button type="submit" variant="primary">{editing === 'new' ? c.create : c.save}</Button>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        </section>
      )}

      {confirming && (
        <ReasonDialog
          title={editing === 'new' ? c.create : `${c.save}: ${editing}`}
          body={c.note}
          actionLabel={editing === 'new' ? c.create : c.save}
          busy={busy}
          error={dialogError}
          onConfirm={save}
          onClose={() => { if (!busy) setConfirming(false); }}
        />
      )}
    </div>
  );
}
