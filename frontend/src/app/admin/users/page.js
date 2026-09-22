'use client';

import { useEffect, useState, useCallback } from 'react';
import { getAdminUsers, toggleUserSuspension, deleteUserAdmin, impersonateUser } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { admin as t, common, errors, empty, confirm as confirmCopy } from '@/content/copy';
import { roleLabel } from '@/content/labels';
import { formatDate, formatCount } from '@/content/format';
import { BACKEND_URL } from '@/lib/backendUrl';
import styles from '../admin.module.css';

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, totalCount: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async (page = 1, searchQuery = search) => {
    setLoading(true);
    try {
      const data = await getAdminUsers(searchQuery, page, 10);
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (err) {
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
      } catch (err) {
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

  async function handleToggleSuspend(user) {
    const dialog = user.isSuspended ? confirmCopy.adminRestoreUser : confirmCopy.adminSuspendUser;
    const who = user.name || user.email || user.id;
    if (!confirm(`${dialog.title.replace('this customer', who)}\n\n${dialog.body}`)) return;

    try {
      await toggleUserSuspension(user.id, !user.isSuspended);
      await loadUsers(pagination.page);
    } catch (err) {
      setError(errors.admin.suspend);
    }
  }

  async function handleConfirmDelete() {
    if (!selectedUser) return;
    try {
      await deleteUserAdmin(selectedUser.id);
      setShowDeleteModal(false);
      setSelectedUser(null);
      await loadUsers(pagination.page);
    } catch (err) {
      setError(errors.admin.deleteUser);
    }
  }

  async function handleImpersonate(userId) {
    if (!confirm(`${confirmCopy.adminImpersonate.title}\n\n${confirmCopy.adminImpersonate.body}`)) return;
    try {
      const data = await impersonateUser(userId);
      window.location.assign(data.redirectUrl || '/dashboard');
    } catch (err) {
      setError(errors.admin.impersonate);
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={t.users.searchPlaceholder}
            aria-label={t.users.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary btn-sm">{common.search}</button>
        </form>

        <div>
          <a
            href={`${BACKEND_URL}/api/admin/users/export/csv`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
          >
            <Icon name="download" size={13} /> {t.users.exportCsv}
          </a>
        </div>
      </div>

      {error && (
        <div className={`${styles.alertBox} ${styles.alertBoxWarning}`} role="alert">
          <span className={styles.alertText}>{error}</span>
        </div>
      )}

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t.users.columns.user}</th>
              <th>{t.users.columns.status}</th>
              <th>{t.users.columns.accounts}</th>
              <th>{t.users.columns.joined}</th>
              <th style={{ textAlign: 'right' }}>{t.users.columns.actions}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '32px' }} aria-busy="true">
                  <div className="spinner spinner-lg" style={{ margin: '0 auto' }} />
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '32px' }}>
                  {search ? t.users.empty : empty.adminUsers.body}
                </td>
              </tr>
            ) : (
              users.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{u.name || t.users.unnamed}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{u.email || t.users.noEmail}</div>
                  </td>
                  <td>
                    {u.isSuspended ? (
                      <span className={styles.badgeSuspended}>{t.users.suspended}</span>
                    ) : (
                      <span className={styles.badgeValid}>{roleLabel(u.role).label}</span>
                    )}
                  </td>
                  <td>
                    {u.instagramAccounts?.length === 0 ? (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>{t.users.noAccounts}</span>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {u.instagramAccounts.map(acc => (
                          <span key={acc.id} className={styles.badgeValid}>
                            @{acc.igUsername || 'account'}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleImpersonate(u.id)}
                      >
                        <Icon name="eye" size={13} /> {t.users.impersonate}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleToggleSuspend(u)}
                      >
                        {u.isSuspended ? t.users.unsuspend : t.users.suspend}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => { setSelectedUser(u); setShowDeleteModal(true); }}
                      >
                        {t.users.delete}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      <div className={styles.pagination}>
        <span>
          {t.users.paginationLabel} {pagination.page} {t.users.paginationOf} {pagination.totalPages} —{' '}
          {formatCount(pagination.totalCount)} total
        </span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={pagination.page <= 1}
            onClick={() => loadUsers(pagination.page - 1)}
          >
            {common.previous}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => loadUsers(pagination.page + 1)}
          >
            {common.next}
          </button>
        </div>
      </div>

      {/* Delete User Modal */}
      {showDeleteModal && selectedUser && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>{confirmCopy.adminDeleteUser.title}</h3>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              This erases <strong>{selectedUser.name || selectedUser.email || selectedUser.id}</strong>, their connected
              Instagram accounts, and every conversation. It cannot be undone.
            </p>
            <div className={styles.modalActions}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowDeleteModal(false)}>{common.cancel}</button>
              <button className="btn btn-danger btn-sm" onClick={handleConfirmDelete}>{confirmCopy.adminDeleteUser.action}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
