'use client';

/**
 * Admin — connected Instagram accounts: filter, export, and the three
 * per-account actions.
 *
 * Data layer is master's, including the Gate-1 initial load (see admin/users).
 *
 * Changed:
 *   - Disconnect used window.confirm() with the handle spliced into the title
 *     by string replace. It is the shared Modal now, handle on its own line.
 *   - Success and failure notices were both rendered in the warning style, so
 *     "access refreshed" and "couldn't refresh" looked identical. Each notice
 *     now carries the tone it already had in state.
 *   - The account picture was a bare <img> with no fallback when Instagram's
 *     URL expires; it is the shared Avatar, which falls back to the initial.
 */

import { useEffect, useState, useCallback } from 'react';
import { getAdminAccounts, refreshAccountToken, resubscribeAccountWebhook, disconnectAccountAdmin } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { Avatar, Badge, Button, Input, Modal, Select, Skeleton } from '@/app/components/ui';
import { admin as t, common, errors, empty, confirm as confirmCopy, toast } from '@/content/copy';
import { tokenStatusLabel } from '@/content/labels';
import { formatDateTime, formatCount } from '@/content/format';
import { BACKEND_URL } from '@/lib/backendUrl';
import styles from '../admin.module.css';

const NOTICE_TONE = { success: styles.noticeSuccess, error: styles.noticeError };

// "Reconnect needed" is shown as warning — something to act on — the same as
// on the customer's own profile page, not the danger labels.js assigns it.
const connectionTone = (tone) => (tone === 'positive' ? 'positive' : 'warning');

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');

  const loadAccounts = useCallback(async (searchQuery = search, status = statusFilter) => {
    setLoading(true);
    try {
      const data = await getAdminAccounts(searchQuery, status);
      setAccounts(data);
    } catch {
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
      } catch {
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
    } catch {
      setNotice({ tone: 'error', text: `${errors.admin.refreshToken} @${acc.igUsername}` });
    }
  }

  async function handleResubscribe(acc) {
    try {
      await resubscribeAccountWebhook(acc.id);
      setNotice({ tone: 'success', text: `${toast.adminResubscribed} for @${acc.igUsername}` });
      await loadAccounts();
    } catch {
      setNotice({ tone: 'error', text: `${errors.admin.resubscribe} @${acc.igUsername}` });
    }
  }

  function openDisconnect(acc) {
    setDisconnectError('');
    setDisconnecting(acc);
  }

  const closeDisconnect = useCallback(() => {
    if (disconnectBusy) return;
    setDisconnecting(null);
    setDisconnectError('');
  }, [disconnectBusy]);

  async function handleDisconnect() {
    if (!disconnecting) return;
    setDisconnectBusy(true);
    setDisconnectError('');
    try {
      await disconnectAccountAdmin(disconnecting.id);
      setDisconnecting(null);
      setNotice({ tone: 'success', text: toast.adminAccountDisconnected });
      await loadAccounts();
    } catch {
      setDisconnectError(errors.admin.disconnect);
    } finally {
      setDisconnectBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <form onSubmit={handleFilterSubmit} className={styles.filters} role="search">
          <Input
            type="search"
            className={styles.filterField}
            placeholder={t.accounts.searchPlaceholder}
            aria-label={t.accounts.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <Select
            className={styles.filterSelect}
            aria-label={t.accounts.columns.status}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              loadAccounts(search, e.target.value);
            }}
          >
            <option value="">{t.accounts.statusAll}</option>
            <option value="VALID">{t.accounts.statusValid}</option>
            <option value="NEEDS_RECONNECT">{t.accounts.statusNeedsReconnect}</option>
          </Select>

          <Button type="submit" size="sm">{common.filter}</Button>
        </form>

        <a
          href={`${BACKEND_URL}/api/admin/accounts/export/csv`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.linkBtn}
        >
          <Icon name="download" size={13} /> {t.accounts.exportCsv}
        </a>
      </div>

      {notice && (
        <div
          className={`${styles.notice} ${NOTICE_TONE[notice.tone] || ''}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <span className={`${styles.noticeBody} ${styles.noticeText}`}>{notice.text}</span>
          <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>{common.close}</Button>
        </div>
      )}

      <section className={styles.panel}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t.accounts.columns.account}</th>
                <th>{t.accounts.columns.owner}</th>
                <th>{t.accounts.columns.status}</th>
                <th>{t.accounts.columns.lastWebhook}</th>
                <th>{t.accounts.columns.conversations}</th>
                <th className={styles.alignRight}>{t.accounts.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" aria-busy="true" aria-label={common.loading}>
                    <Skeleton lines={3} height={20} />
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan="6" className={styles.cellEmpty}>
                    {search || statusFilter ? t.accounts.empty : empty.adminAccounts.body}
                  </td>
                </tr>
              ) : accounts.map((acc) => {
                const status = tokenStatusLabel(acc.tokenStatus);
                return (
                  <tr key={acc.id}>
                    <td>
                      <div className={styles.cellIdentity}>
                        <Avatar src={acc.igProfilePic} name={acc.igUsername} size={32} decorative />
                        <div>
                          <div className={styles.cellPrimary}>@{acc.igUsername || 'unknown'}</div>
                          <div className={styles.cellSub}>{t.accounts.instagramId} {acc.igUserId}</div>
                        </div>
                      </div>
                    </td>

                    <td>
                      <div className={styles.cellPrimary}>{acc.user?.name || t.users.unnamed}</div>
                      <div className={styles.cellSub}>{acc.user?.email || t.users.noEmail}</div>
                    </td>

                    <td><Badge tone={connectionTone(status.tone)}>{status.label}</Badge></td>

                    <td>{acc.lastWebhookAt ? formatDateTime(acc.lastWebhookAt) : common.never}</td>

                    <td>{formatCount(acc._count?.conversations)}</td>

                    <td className={styles.alignRight}>
                      <div className={styles.rowActions}>
                        <Button size="sm" onClick={() => handleRefresh(acc)}>
                          <Icon name="refresh" size={13} /> {t.accounts.refreshToken}
                        </Button>
                        <Button size="sm" onClick={() => handleResubscribe(acc)}>
                          <Icon name="zap" size={13} /> {t.accounts.resubscribe}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => openDisconnect(acc)}>
                          {t.accounts.disconnect}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {disconnecting && (
        <Modal
          title={confirmCopy.adminDisconnectAccount.title}
          onClose={closeDisconnect}
          actions={(
            <>
              <Button size="sm" onClick={closeDisconnect} disabled={disconnectBusy}>{common.cancel}</Button>
              <Button size="sm" variant="danger" onClick={handleDisconnect} loading={disconnectBusy}>
                {confirmCopy.adminDisconnectAccount.action}
              </Button>
            </>
          )}
        >
          <p className={styles.dialogWho}>@{disconnecting.igUsername || 'unknown'}</p>
          <p className={styles.dialogBody}>{confirmCopy.adminDisconnectAccount.body}</p>
          {disconnectError && (
            <p className={`${styles.notice} ${styles.noticeError} ${styles.dialogError}`} role="alert">
              {disconnectError}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
