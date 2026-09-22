'use client';

import { useEffect, useState, useCallback } from 'react';
import { getAdminAccounts, refreshAccountToken, resubscribeAccountWebhook, disconnectAccountAdmin } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { admin as t, common, errors, empty, confirm as confirmCopy, toast } from '@/content/copy';
import { tokenStatusLabel } from '@/content/labels';
import { formatDateTime, formatCount } from '@/content/format';
import { BACKEND_URL } from '@/lib/backendUrl';
import styles from '../admin.module.css';

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  const loadAccounts = useCallback(async (searchQuery = search, status = statusFilter) => {
    setLoading(true);
    try {
      const data = await getAdminAccounts(searchQuery, status);
      setAccounts(data);
    } catch (err) {
      setNotice({ tone: 'error', text: errors.admin.accounts });
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  // Initial load — see the note on the same effect in admin/users.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getAdminAccounts('', '');
        if (cancelled) return;
        setAccounts(data);
      } catch (err) {
        if (!cancelled) setNotice({ tone: 'error', text: errors.admin.accounts });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleFilterSubmit(e) {
    e.preventDefault();
    loadAccounts(search, statusFilter);
  }

  async function handleRefresh(acc) {
    try {
      await refreshAccountToken(acc.id);
      setNotice({ tone: 'success', text: `${toast.adminTokenRefreshed} for @${acc.igUsername}` });
      await loadAccounts();
    } catch (err) {
      setNotice({ tone: 'error', text: `${errors.admin.refreshToken} @${acc.igUsername}` });
    }
  }

  async function handleResubscribe(acc) {
    try {
      await resubscribeAccountWebhook(acc.id);
      setNotice({ tone: 'success', text: `${toast.adminResubscribed} for @${acc.igUsername}` });
      await loadAccounts();
    } catch (err) {
      setNotice({ tone: 'error', text: `${errors.admin.resubscribe} @${acc.igUsername}` });
    }
  }

  async function handleDisconnect(acc) {
    if (!confirm(`${confirmCopy.adminDisconnectAccount.title.replace('this account', `@${acc.igUsername}`)}\n\n${confirmCopy.adminDisconnectAccount.body}`)) return;
    try {
      await disconnectAccountAdmin(acc.id);
      setNotice({ tone: 'success', text: toast.adminAccountDisconnected });
      await loadAccounts();
    } catch (err) {
      setNotice({ tone: 'error', text: errors.admin.disconnect });
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
            placeholder={t.accounts.searchPlaceholder}
            aria-label={t.accounts.searchPlaceholder}
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
            <option value="">{t.accounts.statusAll}</option>
            <option value="VALID">{t.accounts.statusValid}</option>
            <option value="NEEDS_RECONNECT">{t.accounts.statusNeedsReconnect}</option>
          </select>

          <button type="submit" className="btn btn-secondary btn-sm">{common.filter}</button>
        </form>

        <div>
          <a
            href={`${BACKEND_URL}/api/admin/accounts/export/csv`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
          >
            <Icon name="download" size={13} /> {t.accounts.exportCsv}
          </a>
        </div>
      </div>

      {notice && (
        <div
          className={`${styles.alertBox} ${styles.alertBoxWarning}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <span className={styles.alertText}>{notice.text}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setNotice(null)}>{common.close}</button>
        </div>
      )}

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t.accounts.columns.account}</th>
              <th>{t.accounts.columns.owner}</th>
              <th>{t.accounts.columns.status}</th>
              <th>{t.accounts.columns.lastWebhook}</th>
              <th>{t.accounts.columns.conversations}</th>
              <th style={{ textAlign: 'right' }}>{t.accounts.columns.actions}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '32px' }} aria-busy="true">
                  <div className="spinner spinner-lg" style={{ margin: '0 auto' }} />
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '32px' }}>
                  {search || statusFilter ? t.accounts.empty : empty.adminAccounts.body}
                </td>
              </tr>
            ) : (
              accounts.map(acc => (
                <tr key={acc.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {acc.igProfilePic ? (
                        <img src={acc.igProfilePic} alt="" className="avatar" />
                      ) : (
                        <div className="avatar">{(acc.igUsername || '?')[0].toUpperCase()}</div>
                      )}
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>@{acc.igUsername || 'unknown'}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                          {t.accounts.instagramId} {acc.igUserId}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{acc.user?.name || t.users.unnamed}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{acc.user?.email || t.users.noEmail}</div>
                  </td>

                  <td>
                    <span className={acc.tokenStatus === 'VALID' ? styles.badgeValid : styles.badgeExpired}>
                      {tokenStatusLabel(acc.tokenStatus).label}
                    </span>
                  </td>

                  <td>{acc.lastWebhookAt ? formatDateTime(acc.lastWebhookAt) : common.never}</td>

                  <td>{formatCount(acc._count?.conversations)}</td>

                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRefresh(acc)}
                      >
                        <Icon name="refresh" size={13} /> {t.accounts.refreshToken}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleResubscribe(acc)}
                      >
                        <Icon name="zap" size={13} /> {t.accounts.resubscribe}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDisconnect(acc)}
                      >
                        {t.accounts.disconnect}
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
