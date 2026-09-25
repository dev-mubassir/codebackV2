'use client';

/**
 * Admin — one customer (Gate 5): profile, plan and expiry, usage this cycle,
 * connected Instagram accounts, classification counts, last active, recent AI
 * errors. Counts and metadata only — the API never returns message content.
 *
 * Actions (each with a written reason, all audit-logged): suspend / restore,
 * sign out everywhere, delete (also needs the password again — step-up).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { deleteUserAdmin, forceLogoutUser, getAdminUserDetail, setUserSuspended } from '@/lib/api';
import { Badge, Button, Skeleton } from '@/app/components/ui';
import { admin as t, confirm as confirmCopy, errors } from '@/content/copy';
import { formatCount, formatDate, formatDateTime } from '@/content/format';
import ReasonDialog from '../../_components/ReasonDialog';
import { StepUpCancelled, useStepUp } from '../../_components/StepUp';
import styles from '../../admin.module.css';

const d = t.users.detail;

const ACTIONS = {
  suspend: { copy: confirmCopy.adminSuspendUser, variant: 'danger' },
  restore: { copy: confirmCopy.adminRestoreUser, variant: 'primary' },
  logout: { copy: confirmCopy.adminForceLogout, variant: 'primary' },
  delete: { copy: confirmCopy.adminDeleteUser, variant: 'danger' },
};

function Row({ k, v }) {
  return (
    <tr>
      <td className={styles.cellKey}>{k}</td>
      <td>{v}</td>
    </tr>
  );
}

export default function AdminUserDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const { withStepUp } = useStepUp();

  const load = useCallback(async () => {
    try {
      setUser(await getAdminUserDetail(id));
      setError('');
    } catch (err) {
      setError(err?.response?.data?.error || errors.admin.users);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    getAdminUserDetail(id)
      .then((data) => { if (!cancelled) setUser(data); })
      .catch((err) => { if (!cancelled) setError(err?.response?.data?.error || errors.admin.users); });
    return () => { cancelled = true; };
  }, [id]);

  async function confirm(reason) {
    setBusy(true);
    setDialogError('');
    try {
      if (pending === 'delete') {
        await withStepUp(() => deleteUserAdmin(id, reason));
        router.push('/admin/users');
        return;
      }
      if (pending === 'logout') await forceLogoutUser(id, reason);
      else await setUserSuspended(id, pending === 'suspend', reason);
      setPending(null);
      await load();
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setDialogError(err?.response?.data?.error || errors.generic);
    } finally {
      setBusy(false);
    }
  }

  if (!user && !error) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;

  return (
    <div className={styles.stack}>
      <Link href="/admin/users" className={styles.linkBtn}>← {d.back}</Link>
      {error && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{error}</span></div>}

      {user && (
        <>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2 className={styles.panelTitle}>{user.name || t.users.unnamed}</h2>
                <p className={styles.panelSubtitle}>{user.email || t.users.noEmail}</p>
              </div>
              {user.isSuspended ? <Badge tone="danger">{t.users.suspended}</Badge> : <Badge tone="neutral">{t.users.active}</Badge>}
            </div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <tbody>
                  <Row k={d.verified} v={user.emailVerifiedAt ? d.yes : d.no} />
                  <Row k={d.joined} v={formatDate(user.createdAt)} />
                  <Row k={d.lastActive} v={user.lastActiveAt ? formatDateTime(user.lastActiveAt) : '—'} />
                  <Row k={d.plan} v={user.plan.planCode ? `${user.plan.planCode} · ${user.plan.status}` : d.none} />
                  <Row k={d.expires} v={user.plan.validUntil ? formatDateTime(user.plan.validUntil) : '—'} />
                  {user.plan.graceUntil && <Row k={d.graceUntil} v={formatDateTime(user.plan.graceUntil)} />}
                  <Row
                    k={d.classifications}
                    v={`${formatCount(user.quota.classificationsUsedThisCycle)} · ${
                      user.quota.classificationCapPerCycle == null
                        ? d.unlimited
                        : `${formatCount(user.quota.classificationsRemaining)} ${d.remaining}`
                    }`}
                  />
                  <Row k={d.replyCredits} v={`${formatCount(user.quota.replyCreditsCurrent)} (+${formatCount(user.quota.replyCreditsBanked)} ${d.banked})`} />
                  <Row k={`${d.totals} — ${d.total}`} v={formatCount(user.classifications.total)} />
                  <Row k={`${d.totals} — ${d.last30}`} v={formatCount(user.classifications.last30Days)} />
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{d.accounts}</h2></div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <thead><tr><th>@</th><th>{d.connected}</th><th>{d.tokenExpires}</th><th>{t.accounts.columns.status}</th></tr></thead>
                <tbody>
                  {user.instagramAccounts.length === 0 ? (
                    <tr><td colSpan="4" className={styles.cellEmpty}>{d.none}</td></tr>
                  ) : user.instagramAccounts.map((a) => (
                    <tr key={a.id}>
                      <td>@{a.igUsername || a.igUserId}</td>
                      <td>{formatDate(a.createdAt)}</td>
                      <td>{a.tokenExpiresAt ? formatDateTime(a.tokenExpiresAt) : '—'}</td>
                      <td><Badge tone={a.tokenStatus === 'VALID' ? 'positive' : 'warning'}>{a.connectionStatus} · {a.tokenStatus}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{d.aiErrors}</h2></div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <tbody>
                  {user.recentAiErrors.length === 0 ? (
                    <tr><td className={styles.cellEmpty}>{d.none}</td></tr>
                  ) : user.recentAiErrors.map((e, i) => (
                    <tr key={`${e.createdAt}-${i}`}>
                      <td>{formatDateTime(e.createdAt)}</td>
                      <td className={styles.cellMono}>{e.provider} / {e.model}</td>
                      <td className={styles.cellMono}>{e.jobType}</td>
                      <td className={styles.cellMono}>{e.errorCode}{e.httpStatus ? ` (${e.httpStatus})` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{d.actions}</h2></div>
            <div className={`${styles.rowActions} ${styles.passwordForm}`}>
              <Button size="sm" onClick={() => { setDialogError(''); setPending(user.isSuspended ? 'restore' : 'suspend'); }}>
                {user.isSuspended ? t.users.unsuspend : t.users.suspend}
              </Button>
              <Button size="sm" onClick={() => { setDialogError(''); setPending('logout'); }}>{d.forceLogout}</Button>
              <Button size="sm" variant="danger" onClick={() => { setDialogError(''); setPending('delete'); }}>{d.delete}</Button>
            </div>
          </section>
        </>
      )}

      {pending && user && (
        <ReasonDialog
          title={ACTIONS[pending].copy.title}
          who={user.name || user.email || user.id}
          body={ACTIONS[pending].copy.body}
          actionLabel={ACTIONS[pending].copy.action}
          variant={ACTIONS[pending].variant}
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onClose={() => { if (!busy) setPending(null); }}
        />
      )}
    </div>
  );
}
