'use client';

import { useEffect, useState, useCallback } from 'react';
import { getAdminAccounts, refreshAccountToken, resubscribeAccountWebhook, disconnectAccountAdmin } from '@/lib/api';
import styles from '../admin.module.css';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const loadAccounts = useCallback(async (searchQuery = search, status = statusFilter) => {
    setLoading(true);
    try {
      const data = await getAdminAccounts(searchQuery, status);
      setAccounts(data);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    loadAccounts('', '');
  }, [loadAccounts]);

  function handleFilterSubmit(e) {
    e.preventDefault();
    loadAccounts(search, statusFilter);
  }

  async function handleRefresh(acc) {
    try {
      await refreshAccountToken(acc.id);
      alert(`Token refreshed successfully for @${acc.igUsername}`);
      await loadAccounts();
    } catch (err) {
      alert(`Failed to refresh token: ${err.response?.data?.details || err.message}`);
    }
  }

  async function handleResubscribe(acc) {
    try {
      await resubscribeAccountWebhook(acc.id);
      alert(`Webhook re-subscribed successfully for @${acc.igUsername}`);
      await loadAccounts();
    } catch (err) {
      alert(`Failed to re-subscribe webhook: ${err.response?.data?.details || err.message}`);
    }
  }

  async function handleDisconnect(acc) {
    if (!confirm(`Are you sure you want to disconnect @${acc.igUsername}?`)) return;
    try {
      await disconnectAccountAdmin(acc.id);
      await loadAccounts();
    } catch (err) {
      alert('Failed to disconnect account');
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <form onSubmit={handleFilterSubmit} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by @username or owner..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            className={styles.selectInput}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              loadAccounts(search, e.target.value);
            }}
          >
            <option value="">All Statuses</option>
            <option value="VALID">Valid Tokens</option>
            <option value="NEEDS_RECONNECT">Needs Reconnect</option>
          </select>

          <button type="submit" className="btn btn-secondary btn-sm">Filter</button>
        </form>

        <div>
          <a
            href={`${BACKEND_URL}/api/admin/accounts/export/csv`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
          >
            📥 Export CSV
          </a>
        </div>
      </div>

      {/* Accounts Table */}
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Instagram Account</th>
              <th>Owner (User)</th>
              <th>Token Status</th>
              <th>Last Webhook</th>
              <th>Conversations</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '32px' }}>
                  <div className="spinner spinner-lg" style={{ margin: '0 auto' }} />
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '32px' }}>
                  No connected Instagram accounts found.
                </td>
              </tr>
            ) : (
              accounts.map(acc => (
                <tr key={acc.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {acc.igProfilePic ? (
                        <img src={acc.igProfilePic} alt={acc.igUsername} className="avatar" />
                      ) : (
                        <div className="avatar">{(acc.igUsername || '?')[0].toUpperCase()}</div>
                      )}
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>@{acc.igUsername || 'unknown'}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>IG ID: {acc.igUserId}</div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{acc.user?.name || 'Unnamed User'}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{acc.user?.email || acc.userId}</div>
                  </td>

                  <td>
                    {acc.tokenStatus === 'VALID' ? (
                      <span className={styles.badgeValid}>VALID</span>
                    ) : (
                      <span className={styles.badgeExpired}>NEEDS RECONNECT</span>
                    )}
                  </td>

                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                    {acc.lastWebhookAt ? new Date(acc.lastWebhookAt).toLocaleString() : 'Never'}
                  </td>

                  <td style={{ fontFamily: 'var(--font-mono)' }}>
                    {acc._count?.conversations || 0}
                  </td>

                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRefresh(acc)}
                        title="Force token refresh with Meta API"
                      >
                        🔄 Refresh Token
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleResubscribe(acc)}
                        title="Re-subscribe webhook events with Meta"
                      >
                        ⚡ Re-Subscribe
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDisconnect(acc)}
                      >
                        Disconnect
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
