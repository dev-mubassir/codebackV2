'use client';

/**
 * Admin — customers: search, export, and the three account actions.
 *
 * Data layer is master's, including the Gate-1 initial load written out with
 * a cancelled flag rather than calling loadUsers() from the effect.
 *
 * Changed:
 *   - Suspend, restore and "view as customer" used window.confirm(). All four
 *     actions now go through the shared Modal with the copy that was already
 *     written for them (title, body, action label — the labels were unused).
 *   - Master named the customer by string surgery on the title
 *     (`title.replace('this customer', who)`), which silently stops working
 *     the moment the title is reworded. The name is its own line in the body.
 *   - The delete dialog's hard-coded sentence is now confirm.adminDeleteUser.body.
 *   - A failed action shows its error inside the dialog that caused it, not
 *     on the page behind the overlay.
 */

import { useEffect, useState, useCallback } from 'react';
import { getAdminUsers, toggleUserSuspension, deleteUserAdmin, impersonateUser } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { Badge, Button, Input, Modal, Skeleton } from '@/app/components/ui';
import { admin as t, common, errors, empty, confirm as confirmCopy } from '@/content/copy';
import { roleLabel } from '@/content/labels';
import { formatDate, formatCount } from '@/content/format';
import { BACKEND_URL } from '@/lib/backendUrl';
import styles from '../admin.module.css';

/** Which dialog each action opens, and how loud its confirm button is. */
const DIALOGS = {
  suspend: { copy: confirmCopy.adminSuspendUser, variant: 'danger', error: errors.admin.suspend },
  restore: { copy: confirmCopy.adminRestoreUser, variant: 'primary', error: errors.admin.suspend },
  impersonate: { copy: confirmCopy.adminImpersonate, variant: 'primary', error: errors.admin.impersonate },
  delete: { copy: confirmCopy.adminDeleteUser, variant: 'danger', error: errors.admin.deleteUser },
};

const whoOf = (u) => u.name || u.email || u.id;

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, totalCount: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // { kind: 'suspend' | 'restore' | 'impersonate' | 'delete', user }
  const [pending, setPending] = useState(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingError, setPendingError] = useState('');

  const loadUsers = useCallback(async (page = 1, searchQuery = search) => {
    setLoading(true);
    try {
      const data = await getAdminUsers(searchQuery, page, 10);
      setUsers(data.users);
      setPagination(data.pagination);
    } catch {
      setError(errors.admin.users);
    } finally {
      setLoading(false);
    }
  }, [search]);

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

  async function handleConfirm() {
    if (!pending) return;
    const { kind, user } = pending;
    setPendingBusy(true);
    setPendingError('');
    try {
      if (kind === 'impersonate') {
        const data = await impersonateUser(user.id);
        window.location.assign(data.redirectUrl || '/dashboard');
        return;
      }
      if (kind === 'delete') {
        await deleteUserAdmin(user.id);
      } else {
        await toggleUserSuspension(user.id, !user.isSuspended);
      }
      setPending(null);
      await loadUsers(pagination.page);
    } catch {
      setPendingError(DIALOGS[kind].error);
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
          <Button type="submit" size="sm">{common.search}</Button>
        </form>

        <a
          href={`${BACKEND_URL}/api/admin/users/export/csv`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.linkBtn}
        >
          <Icon name="download" size={13} /> {t.users.exportCsv}
        </a>
      </div>

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
                <th>{t.users.columns.accounts}</th>
                <th>{t.users.columns.joined}</th>
                <th className={styles.alignRight}>{t.users.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" aria-busy="true" aria-label={common.loading}>
                    <Skeleton lines={3} height={20} />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan="5" className={styles.cellEmpty}>
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
                      : <Badge tone="neutral">{roleLabel(u.role).label}</Badge>}
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
                      <Button size="sm" onClick={() => openDialog('impersonate', u)}>
                        <Icon name="eye" size={13} /> {t.users.impersonate}
                      </Button>
                      <Button size="sm" onClick={() => openDialog(u.isSuspended ? 'restore' : 'suspend', u)}>
                        {u.isSuspended ? t.users.unsuspend : t.users.suspend}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => openDialog('delete', u)}>
                        {t.users.delete}
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
        <Modal
          title={dialog.copy.title}
          onClose={closeDialog}
          actions={(
            <>
              <Button size="sm" onClick={closeDialog} disabled={pendingBusy}>{common.cancel}</Button>
              <Button size="sm" variant={dialog.variant} onClick={handleConfirm} loading={pendingBusy}>
                {dialog.copy.action}
              </Button>
            </>
          )}
        >
          <p className={styles.dialogWho}>{whoOf(pending.user)}</p>
          <p className={styles.dialogBody}>{dialog.copy.body}</p>
          {pendingError && (
            <p className={`${styles.notice} ${styles.noticeError} ${styles.dialogError}`} role="alert">
              {pendingError}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
