'use client';

/**
 * Admin — add-on packs: the one-time top-ups the billing page sells, for
 * auto-reply credits and for AI draft credits. Prices are per purchasing tier
 * (STARTER / PRO) and region, in paise / cents. Creating, editing, and putting
 * a pack on sale or hiding it all need a written reason and the password
 * (step-up), and are audited. A pack's credit type is fixed once it exists.
 */

import { useEffect, useState } from 'react';
import { createAdminAddonPack, getAdminAddonPacks, updateAdminAddonPack } from '@/lib/api';
import { Badge, Button, Input, Select, Skeleton } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import { formatPrice } from '@/lib/pricing';
import ReasonDialog from '../_components/ReasonDialog';
import { StepUpCancelled, useStepUp } from '../_components/StepUp';
import styles from '../admin.module.css';

const c = t.packs;
const PRICE_SLOTS = [
  ['STARTER', 'IN'],
  ['STARTER', 'INTL'],
  ['PRO', 'IN'],
  ['PRO', 'INTL'],
];
const slotKey = (tier, region) => `${tier}_${region}`;
const EMPTY = { code: '', pool: 'DRAFT', creditAmount: '', isListed: false, ...Object.fromEntries(PRICE_SLOTS.map(([tr, r]) => [slotKey(tr, r), ''])) };

function toForm(pack) {
  const price = (tier, region) => pack.prices.find((p) => p.planCode === tier && p.billingRegion === region)?.amount;
  return {
    ...EMPTY,
    code: pack.code,
    pool: pack.pool,
    creditAmount: String(pack.creditAmount),
    isListed: pack.isListed,
    ...Object.fromEntries(PRICE_SLOTS.map(([tr, r]) => [slotKey(tr, r), price(tr, r) != null ? String(price(tr, r)) : ''])),
  };
}

function toBody(form, creating) {
  const prices = PRICE_SLOTS.filter(([tr, r]) => form[slotKey(tr, r)] !== '').map(([tr, r]) => ({
    planCode: tr,
    billingRegion: r,
    amount: Number(form[slotKey(tr, r)]),
  }));
  return {
    ...(creating ? { code: form.code.trim(), pool: form.pool } : {}),
    creditAmount: Number(form.creditAmount),
    isListed: form.isListed,
    prices,
  };
}

const priceOf = (pack, tier, region) => {
  const p = pack.prices.find((x) => x.planCode === tier && x.billingRegion === region);
  return p ? formatPrice(p.amount, p.currency) : '—';
};

export default function AdminPacksPage() {
  const [packs, setPacks] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | pack code
  const [form, setForm] = useState(EMPTY);
  const [pending, setPending] = useState(null); // { title, run(reason) }
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const { withStepUp } = useStepUp();

  const load = () => getAdminAddonPacks().then(setPacks).catch(() => setError(errors.admin.settings));
  useEffect(() => {
    let cancelled = false;
    getAdminAddonPacks()
      .then((p) => { if (!cancelled) setPacks(p); })
      .catch(() => { if (!cancelled) setError(errors.admin.settings); });
    return () => { cancelled = true; };
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function confirm(reason) {
    setBusy(true);
    setDialogError('');
    try {
      await withStepUp(() => pending.run(reason));
      setPending(null);
      setEditing(null);
      await load();
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setDialogError(err?.response?.data?.error || errors.generic);
    } finally {
      setBusy(false);
    }
  }

  function askSave() {
    const creating = editing === 'new';
    const body = toBody(form, creating);
    setDialogError('');
    setPending({
      title: creating ? c.create : `${c.save}: ${editing}`,
      run: (reason) => (creating ? createAdminAddonPack({ ...body, reason }) : updateAdminAddonPack(editing, { ...body, reason })),
    });
  }

  function askToggle(pack) {
    setDialogError('');
    setPending({
      title: `${pack.isListed ? c.hidden : c.listed}: ${pack.code}`,
      run: (reason) => updateAdminAddonPack(pack.code, { isListed: !pack.isListed, reason }),
    });
  }

  if (!packs && !error) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;

  return (
    <div className={styles.stack}>
      <p className={styles.pageLeadText}>{c.note}</p>
      {error && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{error}</span></div>}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{t.nav.packs}</h2>
          <Button size="sm" onClick={() => { setForm(EMPTY); setEditing('new'); }}>{c.newPack}</Button>
        </div>
        {packs && packs.length === 0 ? (
          <p className={styles.cellEmpty}>{c.empty}</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.tableCompact}`}>
              <thead>
                <tr>
                  <th>{c.fields.code.split(' (')[0]}</th>
                  <th>{c.fields.pool}</th>
                  <th>{c.fields.creditAmount}</th>
                  {PRICE_SLOTS.map(([tr, r]) => <th key={slotKey(tr, r)}>{`${tr} ${r}`}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {(packs || []).map((p) => (
                  <tr key={p.code}>
                    <td className={styles.cellMono}>
                      {p.code} {p.isListed ? <Badge tone="positive">{c.listed}</Badge> : <Badge tone="neutral">{c.hidden}</Badge>}
                    </td>
                    <td>{c.pools[p.pool] || p.pool}</td>
                    <td>{p.creditAmount.toLocaleString('en-IN')}</td>
                    {PRICE_SLOTS.map(([tr, r]) => <td key={slotKey(tr, r)}>{priceOf(p, tr, r)}</td>)}
                    <td className={styles.alignRight}>
                      <div className={styles.rowActions}>
                        <Button size="sm" onClick={() => { setForm(toForm(p)); setEditing(p.code); }}>{c.edit}</Button>
                        <Button size="sm" onClick={() => askToggle(p)}>{p.isListed ? c.hidden : c.listed}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <section className={styles.panel}>
          <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{editing === 'new' ? c.newPack : `${c.edit} ${editing}`}</h2></div>
          <form className={styles.passwordForm} onSubmit={(e) => { e.preventDefault(); askSave(); }}>
            {editing === 'new' ? (
              <>
                <Input label={c.fields.code} value={form.code} onChange={set('code')} required />
                <Select label={c.fields.pool} value={form.pool} onChange={set('pool')}>
                  <option value="DRAFT">{c.pools.DRAFT}</option>
                  <option value="REPLY">{c.pools.REPLY}</option>
                </Select>
              </>
            ) : (
              <p className={styles.cellSub}>{`${c.fields.pool}: ${c.pools[form.pool] || form.pool}. ${c.poolFixed}`}</p>
            )}
            <Input label={c.fields.creditAmount} type="number" min="1" max="100000" value={form.creditAmount} onChange={set('creditAmount')} required />
            <p className={styles.cellSub}>{c.prices}</p>
            {PRICE_SLOTS.map(([tr, r]) => (
              <Input key={slotKey(tr, r)} label={c.fields.price(tr, r)} type="number" min="1" value={form[slotKey(tr, r)]} onChange={set(slotKey(tr, r))} />
            ))}
            <label className={styles.dialogBody}><input type="checkbox" checked={form.isListed} onChange={set('isListed')} /> {c.fields.isListed}</label>
            <div className={styles.rowActions}>
              <Button type="submit" variant="primary">{editing === 'new' ? c.create : c.save}</Button>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        </section>
      )}

      {pending && (
        <ReasonDialog
          title={pending.title}
          body={c.note}
          actionLabel={pending.title}
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onClose={() => { if (!busy) setPending(null); }}
        />
      )}
    </div>
  );
}
