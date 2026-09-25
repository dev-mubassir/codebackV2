'use client';

/**
 * Admin — announcement banners for the customer app (Gate 7). Message, type
 * and a time window; never deleted, only turned off. Every change needs a
 * reason and is audited. The message is rendered as plain text.
 */

import { useEffect, useState } from 'react';
import { createAdminAnnouncement, getAdminAnnouncements, updateAdminAnnouncement } from '@/lib/api';
import { Badge, Button, Input, Select, Skeleton, Textarea } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import { formatDateTime } from '@/content/format';
import ReasonDialog from '../_components/ReasonDialog';
import styles from '../admin.module.css';

const c = t.announcements;

/** `datetime-local` wants local time without a zone. */
function localInput(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
const emptyForm = () => ({ message: '', type: 'info', startsAt: localInput(new Date()), endsAt: localInput(new Date(Date.now() + 24 * 3600 * 1000)) });

function status(a, now) {
  if (!a.isActive) return ['neutral', c.off];
  if (new Date(a.startsAt) > now) return ['neutral', c.scheduled];
  if (new Date(a.endsAt) <= now) return ['neutral', c.ended];
  return ['positive', c.live];
}

export default function AdminAnnouncementsPage() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [pending, setPending] = useState(null); // { kind: 'create' } | { kind: 'toggle', item }
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const load = () => getAdminAnnouncements().then(setList).catch(() => setError(errors.admin.settings));
  useEffect(() => {
    let cancelled = false;
    getAdminAnnouncements()
      .then((l) => { if (!cancelled) setList(l); })
      .catch(() => { if (!cancelled) setError(errors.admin.settings); });
    return () => { cancelled = true; };
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function confirm(reason) {
    setBusy(true);
    setDialogError('');
    try {
      if (pending.kind === 'create') {
        await createAdminAnnouncement({
          message: form.message,
          type: form.type,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          reason,
        });
        setForm(emptyForm());
      } else {
        await updateAdminAnnouncement(pending.item.id, { isActive: !pending.item.isActive, reason });
      }
      setPending(null);
      await load();
    } catch (err) {
      setDialogError(err?.response?.data?.error || errors.generic);
    } finally {
      setBusy(false);
    }
  }

  if (!list && !error) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;
  const now = new Date();

  return (
    <div className={styles.stack}>
      <p className={styles.pageLeadText}>{c.lead}</p>
      {error && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{error}</span></div>}

      <section className={styles.panel}>
        <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{c.newTitle}</h2></div>
        <form className={styles.passwordForm} onSubmit={(e) => { e.preventDefault(); setDialogError(''); setPending({ kind: 'create' }); }}>
          <Textarea label={c.message} value={form.message} onChange={set('message')} required minLength={3} maxLength={500} rows={3} />
          <Select label={c.type} value={form.type} onChange={set('type')}>
            {Object.entries(c.types).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </Select>
          <Input label={c.startsAt} type="datetime-local" value={form.startsAt} onChange={set('startsAt')} required />
          <Input label={c.endsAt} type="datetime-local" value={form.endsAt} onChange={set('endsAt')} required />
          <div><Button type="submit" variant="primary">{c.create}</Button></div>
        </form>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{t.nav.announcements}</h2></div>
        {(list || []).length === 0 ? (
          <p className={styles.cellEmpty}>{c.empty}</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.tableCompact}`}>
              <thead><tr><th>{c.message}</th><th>{c.type}</th><th>{c.startsAt}</th><th>{c.endsAt}</th><th>{c.status}</th><th /></tr></thead>
              <tbody>
                {list.map((a) => {
                  const [tone, label] = status(a, now);
                  return (
                    <tr key={a.id}>
                      <td>{a.message}</td>
                      <td>{c.types[a.type] || a.type}</td>
                      <td>{formatDateTime(a.startsAt)}</td>
                      <td>{formatDateTime(a.endsAt)}</td>
                      <td><Badge tone={tone}>{label}</Badge></td>
                      <td className={styles.alignRight}>
                        <Button size="sm" onClick={() => { setDialogError(''); setPending({ kind: 'toggle', item: a }); }}>{a.isActive ? c.turnOff : c.turnOn}</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pending && (
        <ReasonDialog
          title={pending.kind === 'create' ? c.create : pending.item.isActive ? c.turnOff : c.turnOn}
          body={pending.kind === 'create' ? form.message : pending.item.message}
          actionLabel={pending.kind === 'create' ? c.create : pending.item.isActive ? c.turnOff : c.turnOn}
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onClose={() => { if (!busy) setPending(null); }}
        />
      )}
    </div>
  );
}
