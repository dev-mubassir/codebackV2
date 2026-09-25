'use client';

/**
 * Admin — connected Instagram accounts: filter, export, and the per-account
 * actions (refresh access, resubscribe, mark for reconnect).
 *
 * Admin rebuild (Gate 1):
 *   - every action asks for a written reason, which the audit log records;
 *   - Disconnect is gone: it hard-deleted the account and every conversation
 *     under it. Deleting data returns in Gate 5 on top of the real deletion
 *     path;
 *   - the CSV export needs step-up, confirmed before the download starts.
 *
 * Success and failure notices keep their own tone, and the account picture is
 * the shared Avatar, which falls back to the initial when Instagram's URL
 * expires.
 */

import { useEffect, useState, useCallback } from 'react';
import { getAdminAccounts, refreshAccountToken, resubscribeAccountWebhook, markAccountNeedsReconnect } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { Avatar, Badge, Button, Input, Select, Skeleton } from '@/app/components/ui';
import { admin as t, common, errors, empty, confirm as confirmCopy, toast } from '@/content/copy';
import { tokenStatusLabel } from '@/content/labels';
import { formatDateTime, formatCount } from '@/content/format';
import { BACKEND_URL } from '@/lib/backendUrl';
import ReasonDialog from '../_components/ReasonDialog';
import { StepUpCancelled, useStepUp } from '../_components/StepUp';
import styles from '../admin.module.css';

const NOTICE_TONE = { success: styles.noticeSuccess, error: styles.noticeError };

// "Reconnect needed" is shown as warning — something to act on — the same as
// on the customer's own profile page, not the danger labels.js assigns it.
const connectionTone = (tone) => (tone === 'positive' ? 'positive' : 'warning');

/** What each action is called, what it calls, and what it says afterwards. */
const ACTIONS = {
  refresh: { copy: confirmCopy.adminRefreshToken, run: refreshAccountToken, done: toast.adminTokenRefreshed, error: errors.admin.refreshToken },
  resubscribe: { copy: confirmCopy.adminResubscribe, run: resubscribeAccountWebhook, done: toast.adminResubscribed, error: errors.admin.resubscribe },
  markReconnect: { copy: confirmCopy.adminMarkReconnect, run: markAccountNeedsReconnect, done: toast.adminMarkedReconnect, error: errors.admin.markReconnect },
};

const handleOf = (acc) => `@${acc.igUsername || 'unknown'}`;

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  // { kind: keyof ACTIONS, account }
  const [pending, setPending] = useState(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const { ensureStepUp } = useStepUp();

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

  async function handleExport() {
    try {
      await ensureStepUp();
      window.location.assign(`${BACKEND_URL}/api/admin/accounts/export/csv`);
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setNotice({ tone: 'error', text: errors.admin.export });
    }
  }

  function openAction(kind, account) {
    setPendingError('');
    setPending({ kind, account });
  }

  const closeAction = useCallback(() => {
    if (pendingBusy) return;
    setPending(null);
    setPendingError('');
  }, [pendingBusy]);

  async function handleConfirm(reason) {
    if (!pending) return;
    const { kind, account } = pending;
    const action = ACTIONS[kind];
    setPendingBusy(true);
    setPendingError('');
    try {
      await action.run(account.id, reason);
      setPending(null);
      setNotice({ tone: 'success', text: `${action.done} for ${handleOf(account)}` });
      await loadAccounts();
    } catch (err) {
      setPendingError(err?.response?.data?.error || action.error);
    } finally {
      setPendingBusy(false);
    }
  }

  const dialog = pending ? ACTIONS[pending.kind] : null;

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

        <Button size="sm" onClick={handleExport}>
          <Icon name="download" size={13} /> {t.accounts.exportCsv}
        </Button>
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
                          <div className={styles.cellPrimary}>{handleOf(acc)}</div>
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
                        <Button size="sm" onClick={() => openAction('refresh', acc)}>
                          <Icon name="refresh" size={13} /> {t.accounts.refreshToken}
                        </Button>
                        <Button size="sm" onClick={() => openAction('resubscribe', acc)}>
                          <Icon name="zap" size={13} /> {t.accounts.resubscribe}
                        </Button>
                        {acc.tokenStatus !== 'NEEDS_RECONNECT' && (
                          <Button size="sm" onClick={() => openAction('markReconnect', acc)}>
                            {t.accounts.markReconnect}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {pending && dialog && (
        <ReasonDialog
          title={dialog.copy.title}
          who={handleOf(pending.account)}
          body={dialog.copy.body}
          actionLabel={dialog.copy.action}
          busy={pendingBusy}
          error={pendingError}
          onConfirm={handleConfirm}
          onClose={closeAction}
        />
      )}
    </div>
  );
}
