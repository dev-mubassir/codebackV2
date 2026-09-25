'use client';

/**
 * Admin — kill switches, the customer idle timeout, and alert thresholds
 * (Gate 7). Kill switches and the session timeout ask for the password again
 * (step-up); thresholds only need a reason. Every change is audited. Recent
 * alerts are listed from the audit log.
 */

import { useEffect, useState } from 'react';
import { getAdminAlerts, getAdminFlags, resetAdminFlag, updateAdminFlag } from '@/lib/api';
import { Badge, Button, Input, Skeleton } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import { formatDateTime } from '@/content/format';
import ReasonDialog from '../_components/ReasonDialog';
import { StepUpCancelled, useStepUp } from '../_components/StepUp';
import styles from '../admin.module.css';

const c = t.controls;
const GROUPS = ['flag', 'session', 'alert'];

export default function AdminControlsPage() {
  const [flags, setFlags] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [pending, setPending] = useState(null); // { setting, value } | { setting, reset: true }
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [notice, setNotice] = useState('');
  const { withStepUp } = useStepUp();

  const load = () =>
    Promise.all([getAdminFlags(), getAdminAlerts()])
      .then(([f, a]) => { setFlags(f); setAlerts(a); })
      .catch(() => setError(errors.admin.settings));
  useEffect(() => {
    let cancelled = false;
    Promise.all([getAdminFlags(), getAdminAlerts()])
      .then(([f, a]) => { if (!cancelled) { setFlags(f); setAlerts(a); } })
      .catch(() => { if (!cancelled) setError(errors.admin.settings); });
    return () => { cancelled = true; };
  }, []);

  async function confirm(reason) {
    setBusy(true);
    setDialogError('');
    try {
      const { setting } = pending;
      const call = () => (pending.reset ? resetAdminFlag(setting.key, reason) : updateAdminFlag(setting.key, pending.value, reason));
      const res = setting.requiresStepUp ? await withStepUp(call) : await call();
      setNotice(res?.requeued ? c.requeued(res.requeued) : '');
      setPending(null);
      setDrafts((d) => ({ ...d, [setting.key]: undefined }));
      await load();
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setDialogError(typeof err === 'string' ? err : err?.response?.data?.error || errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const ask = (next) => { setDialogError(''); setPending(next); };

  if (!flags && !error) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;

  return (
    <div className={styles.stack}>
      <p className={styles.pageLeadText}>{c.lead}</p>
      {error && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{error}</span></div>}
      {notice && <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status"><span className={styles.noticeText}>{notice}</span></div>}

      {GROUPS.map((group) => (
        <section key={group} className={styles.panel}>
          <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{c.groups[group]}</h2></div>
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.tableCompact}`}>
              <tbody>
                {(flags || []).filter((s) => s.group === group).map((s) => {
                  const isBool = typeof s.defaultValue === 'boolean' || typeof s.value === 'boolean';
                  const draft = drafts[s.key];
                  return (
                    <tr key={s.key}>
                      <td className={styles.cellKey}>
                        {c.labels[s.key] || s.label || s.key}
                        {c.hints[s.key] && <div className={styles.cellSub}>{c.hints[s.key]}</div>}
                      </td>
                      <td>
                        {isBool ? (
                          <Badge tone={s.value ? 'positive' : 'neutral'}>{s.value ? c.on : c.off}</Badge>
                        ) : (
                          <Input
                            aria-label={c.labels[s.key] || s.label || s.key}
                            type="number"
                            value={draft ?? String(s.value)}
                            onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                          />
                        )}
                        <div className={styles.cellSub}>
                          {s.source === 'admin' ? c.sourceAdmin : c.sourceDefault} · {c.defaultIs} {String(s.defaultValue)}
                          {s.updatedAt ? ` · ${formatDateTime(s.updatedAt)}` : ''}
                        </div>
                      </td>
                      <td className={styles.alignRight}>
                        <div className={styles.rowActions}>
                          {isBool ? (
                            <Button size="sm" variant={s.value ? 'secondary' : 'primary'} onClick={() => ask({ setting: s, value: !s.value })}>
                              {s.value ? c.turnOff : c.turnOn}
                            </Button>
                          ) : (
                            <Button size="sm" variant="primary" disabled={draft === undefined || draft === String(s.value) || draft === ''} onClick={() => ask({ setting: s, value: Number(draft) })}>
                              {c.save}
                            </Button>
                          )}
                          {s.source === 'admin' && <Button size="sm" onClick={() => ask({ setting: s, reset: true })}>{c.reset}</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{c.alertsTitle}</h2>
          <p className={styles.panelSubtitle}>{c.alertsNote}</p>
        </div>
        {alerts.length === 0 ? (
          <p className={styles.cellEmpty}>{c.alertsEmpty}</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.tableCompact}`}>
              <tbody>
                {alerts.map((a, i) => (
                  <tr key={`${a.createdAt}-${i}`}>
                    <td>{formatDateTime(a.createdAt)}</td>
                    <td className={styles.cellMono}>{a.targetId || a.action}</td>
                    <td>{a.after?.title || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pending && (
        <ReasonDialog
          title={`${c.labels[pending.setting.key] || pending.setting.key}: ${pending.reset ? c.reset : String(pending.value)}`}
          actionLabel={pending.reset ? c.reset : c.save}
          variant={pending.setting.group === 'flag' ? 'danger' : 'primary'}
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onClose={() => { if (!busy) setPending(null); }}
        />
      )}
    </div>
  );
}
