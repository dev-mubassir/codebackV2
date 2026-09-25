'use client';

/**
 * Admin — customers: search and filter (plan, status, signup date), export,
 * suspend and restore. Sign-out-everywhere and delete live on the customer's
 * detail page (/admin/users/[id]).
 *
 * "View as customer" (impersonation) is gone for good: it exposed DMs.
 * Every action needs a written reason (audit log). The CSV export needs
 * step-up, so the page confirms the password before the download starts.
 *
 * Data layer is master's, including the Gate-1 initial load written out with
 * a cancelled flag rather than calling loadUsers() from the effect.
 *
 * The customer is named on its own line in the dialog, never spliced into the
 * title, and a failed action shows its error inside the dialog that caused it.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getAdminUsers, setUserSuspended } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { Badge, Button, Input, Select, Skeleton } from '@/app/components/ui';
import { admin as t, common, errors, empty, confirm as confirmCopy } from '@/content/copy';
import { formatDate, formatCount } from '@/content/format';
import { BACKEND_URL } from '@/lib/backendUrl';
import ReasonDialog from '../_components/ReasonDialog';
import { StepUpCancelled, useStepUp } from '../_components/StepUp';
import styles from '../admin.module.css';

/** Which dialog each action opens, and how loud its confirm button is. */
const DIALOGS = {
  suspend: { copy: confirmCopy.adminSuspendUser, variant: 'danger', error: errors.admin.suspend },
  restore: { copy: confirmCopy.adminRestoreUser, variant: 'primary', error: errors.admin.suspend },
};

const whoOf = (u) => u.name || u.email || u.id;

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, totalCount: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ plan: '', status: '', signedUpFrom: '', signedUpTo: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { ensureStepUp } = useStepUp();
  const [exportError, setExportError] = useState('');
  // { kind: 'suspend' | 'restore', user }
  const [pending, setPending] = useState(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingError, setPendingError] = useState('');

  const loadUsers = useCallback(async (page = 1, searchQuery = search, f = filters) => {
    setLoading(true);
    try {
      const data = await getAdminUsers(searchQuery, page, 10, f);
      setUsers(data.users);
      setPagination(data.pagination);
    } catch {
      setError(errors.admin.users);
    } finally {
      setLoading(false);
    }
  }, [search, filters]);

  // Initial load, written out rather than calling loadUsers(): loadUsers opens
  // with a synchronous setLoading(true), and a synchronous setState in an
  // effect body is a cascading render. Every setState below lands after an
  // await, and the cancelled flag stops a late response writing into an
  // unmounted page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getAdminUsers('', 1, 10);
        if (cancelled) return;
        setUsers(data.users);
        setPagination(data.pagination);
      } catch {
        if (!cancelled) setError(errors.admin.users);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleSearchSubmit(e) {
    e.preventDefault();
    loadUsers(1, search);
  }

  function openDialog(kind, user) {
    setPendingError('');
    setPending({ kind, user });
  }

  const closeDialog = useCallback(() => {
    if (pendingBusy) return;
    setPending(null);
    setPendingError('');
  }, [pendingBusy]);

  async function handleExport() {
    setExportError('');
    try {
      await ensureStepUp();
      window.location.assign(`${BACKEND_URL}/api/admin/users/export/csv`);
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setExportError(errors.admin.export);
    }
  }

  async function handleConfirm(reason) {
    if (!pending) return;
    const { kind, user } = pending;
    setPendingBusy(true);
    setPendingError('');
    try {
      await setUserSuspended(user.id, kind === 'suspend', reason);
      setPending(null);
      await loadUsers(pagination.page);
    } catch (err) {
      setPendingError(err?.response?.data?.error || DIALOGS[kind].error);
    } finally {
      setPendingBusy(false);
    }
  }

  const dialog = pending ? DIALOGS[pending.kind] : null;

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <form onSubmit={handleSearchSubmit} className={styles.filters} role="search">
          <Input
            type="search"
            className={styles.filterField}
            placeholder={t.users.searchPlaceholder}
            aria-label={t.users.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select aria-label={t.users.filters.plan} value={filters.plan} onChange={(e) => setFilters((f) => ({ ...f, plan: e.target.value }))}>
            <option value="">{t.users.filters.anyPlan}</option>
            <option value="NONE">{t.users.filters.noPlan}</option>
            <option value="TRIAL">TRIAL</option>
            <option value="STARTER">STARTER</option>
            <option value="PRO">PRO</option>
            <option value="ENTERPRISE">ENTERPRISE</option>
          </Select>
          <Select aria-label={t.users.filters.status} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">{t.users.filters.anyStatus}</option>
            <option value="active">{t.users.active}</option>
            <option value="suspended">{t.users.suspended}</option>
          </Select>
          <Input type="date" aria-label={t.users.filters.from} value={filters.signedUpFrom} onChange={(e) => setFilters((f) => ({ ...f, signedUpFrom: e.target.value }))} />
          <Input type="date" aria-label={t.users.filters.to} value={filters.signedUpTo} onChange={(e) => setFilters((f) => ({ ...f, signedUpTo: e.target.value }))} />
          <Button type="submit" size="sm">{common.search}</Button>
        </form>

        <Button size="sm" onClick={handleExport}>
          <Icon name="download" size={13} /> {t.users.exportCsv}
        </Button>
      </div>

      {exportError && (
        <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
          <span className={styles.noticeText}>{exportError}</span>
        </div>
      )}

      {error && (
        <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
          <span className={styles.noticeText}>{error}</span>
        </div>
      )}

      <section className={styles.panel}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t.users.columns.user}</th>
                <th>{t.users.columns.status}</th>
                <th>{t.users.columns2.plan}</th>
                <th>{t.users.columns.accounts}</th>
                <th>{t.users.columns.joined}</th>
                <th className={styles.alignRight}>{t.users.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" aria-busy="true" aria-label={common.loading}>
                    <Skeleton lines={3} height={20} />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan="6" className={styles.cellEmpty}>
                    {search ? t.users.empty : empty.adminUsers.body}
                  </td>
                </tr>
              ) : users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className={styles.cellPrimary}>{u.name || t.users.unnamed}</div>
                    <div className={styles.cellSub}>{u.email || t.users.noEmail}</div>
                  </td>
                  <td>
                    {u.isSuspended
                      ? <Badge tone="danger">{t.users.suspended}</Badge>
                      : <Badge tone="neutral">{t.users.active}</Badge>}
                  </td>
                  <td className={styles.cellMono}>
                    {u.plan?.planCode ? `${u.plan.planCode} · ${u.plan.status}` : '—'}
                  </td>
                  <td>
                    {u.instagramAccounts?.length === 0 ? (
                      <span className={styles.cellMuted}>{t.users.noAccounts}</span>
                    ) : (
                      <div className={styles.badgeRow}>
                        {u.instagramAccounts.map((acc) => (
                          <Badge key={acc.id} tone="neutral">@{acc.igUsername || 'account'}</Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td className={styles.alignRight}>
                    <div className={styles.rowActions}>
                      <Link href={`/admin/users/${u.id}`} className={styles.linkBtn}>{t.users.details}</Link>
                      <Button size="sm" onClick={() => openDialog(u.isSuspended ? 'restore' : 'suspend', u)}>
                        {u.isSuspended ? t.users.unsuspend : t.users.suspend}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.pagination}>
        <span>
          {t.users.paginationLabel} {pagination.page} {t.users.paginationOf} {pagination.totalPages} —{' '}
          {formatCount(pagination.totalCount)} total
        </span>
        <div className={styles.paginationButtons}>
          <Button size="sm" disabled={pagination.page <= 1} onClick={() => loadUsers(pagination.page - 1)}>
            {common.previous}
          </Button>
          <Button
            size="sm"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => loadUsers(pagination.page + 1)}
          >
            {common.next}
          </Button>
        </div>
      </div>

      {pending && dialog && (
        <ReasonDialog
          title={dialog.copy.title}
          who={whoOf(pending.user)}
          body={dialog.copy.body}
          actionLabel={dialog.copy.action}
          variant={dialog.variant}
          busy={pendingBusy}
          error={pendingError}
          onConfirm={handleConfirm}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
