'use client';

import { useEffect, useState, useCallback } from 'react';
import { getAdminUsers, toggleUserSuspension, deleteUserAdmin, impersonateUser } from '@/lib/api';
import styles from '../admin.module.css';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, totalCount: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const loadUsers = useCallback(async (page = 1, searchQuery = search) => {
    setLoading(true);
    try {
      const data = await getAdminUsers(searchQuery, page, 10);
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadUsers(1, '');
  }, [loadUsers]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    loadUsers(1, search);
  }

  async function handleToggleSuspend(user) {
    const actionText = user.isSuspended ? 'unsuspend' : 'suspend';
    if (!confirm(`Are you sure you want to ${actionText} user "${user.name || user.id}"?`)) return;

    try {
      await toggleUserSuspension(user.id, !user.isSuspended);
      await loadUsers(pagination.page);
    } catch (err) {
      alert('Failed to update suspension status');
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
      alert('Failed to delete user');
    }
  }

  async function handleImpersonate(userId) {
    if (!confirm('Start impersonating this user? You will be redirected to their dashboard view.')) return;
    try {
      const data = await impersonateUser(userId);
      window.location.href = data.redirectUrl || '/dashboard';
    } catch (err) {
      alert('Failed to impersonate user');
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
            placeholder="Search by name, email, or @username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary btn-sm">Search</button>
        </form>

        <div>
          <a
            href={`${BACKEND_URL}/api/admin/users/export/csv`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
          >
            📥 Export CSV
          </a>
        </div>
      </div>

      {/* Users Table */}
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>User</th>
              <th>Status / Role</th>
              <th>Connected IG Accounts</th>
              <th>Joined Date</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '32px' }}>
                  <div className="spinner" style={{ margin: '0 auto' }} />
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', color: '#737373', padding: '32px' }}>
                  No users found.
                </td>
              </tr>
            ) : (
              users.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 'bold' }}>{u.name || 'Unnamed User'}</div>
                    <div style={{ fontSize: '0.75rem', color: '#a3a3a3' }}>{u.email || u.id}</div>
                  </td>
                  <td>
                    {u.isSuspended ? (
                      <span className={styles.badgeSuspended}>SUSPENDED</span>
                    ) : (
                      <span className={styles.badgeValid}>{u.role}</span>
                    )}
                  </td>
                  <td>
                    {u.instagramAccounts?.length === 0 ? (
                      <span style={{ color: '#737373', fontSize: '0.75rem' }}>No accounts connected</span>
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
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleImpersonate(u.id)}
                        title="Impersonate user for support"
                      >
                        👁 Impersonate
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleToggleSuspend(u)}
                      >
                        {u.isSuspended ? 'Unsuspend' : 'Suspend'}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => { setSelectedUser(u); setShowDeleteModal(true); }}
                      >
                        Delete
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
        <span>Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} total users)</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={pagination.page <= 1}
            onClick={() => loadUsers(pagination.page - 1)}
          >
            Previous
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => loadUsers(pagination.page + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {/* Delete User Modal */}
      {showDeleteModal && selectedUser && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>Delete User Account</h3>
            <p style={{ fontSize: '0.875rem', color: '#a3a3a3', marginBottom: '16px' }}>
              Are you sure you want to permanently delete user <strong>{selectedUser.name || selectedUser.id}</strong>?
              This will also disconnect all connected Instagram accounts and remove their conversations.
            </p>
            <div className={styles.modalActions}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowDeleteModal(false)}>Cancel</button>
              <button className="btn btn-danger btn-sm" onClick={handleConfirmDelete}>Permanently Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
