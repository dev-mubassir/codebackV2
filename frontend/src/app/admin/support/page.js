'use client';

/**
 * Admin — support lookup: find a customer or a connected account, read-only.
 *
 * Data layer is master's.
 *
 * Changed: the page repeated its own title under the topbar, which already
 * says "Support lookup" — only the one-line description stays. Inline styles
 * became classes, the results grid collapses to one column on narrow screens
 * (master's was a fixed two columns at every width), and the conversation
 * inspector is the shared Modal.
 *
 * NOT reachable, in master or here: nothing calls handleInspectConversation,
 * and the search endpoint returns customers and accounts, not conversations,
 * so there is no id to open. The inspector is kept and restyled so that
 * wiring it later is a data change only. Reported.
 */

import { useState } from 'react';
import { supportSearch, getSupportConversation } from '@/lib/api';
import { Badge, Button, Input, Modal, Skeleton } from '@/app/components/ui';
import { admin as t, common, errors, empty } from '@/content/copy';
import { tokenStatusLabel } from '@/content/labels';
import { formatDateTime } from '@/content/format';
import styles from '../admin.module.css';

export default function AdminSupportPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ users: [], accounts: [] });
  const [loading, setLoading] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [, setLoadingConv] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    try {
      const data = await supportSearch(query.trim());
      setResults(data);
      setSearched(true);
    } catch {
      setError(errors.admin.search);
    } finally {
      setLoading(false);
    }
  }

  async function handleInspectConversation(convId) {
    setLoadingConv(true);
    try {
      const data = await getSupportConversation(convId);
      setSelectedConversation(data);
    } catch {
      setError(errors.admin.conversation);
    } finally {
      setLoadingConv(false);
    }
  }

  const hasResults = results.users.length > 0 || results.accounts.length > 0;

  return (
    <div className={styles.stack}>
      <p className={styles.pageLeadText}>{t.support.subtitle}</p>

      <form onSubmit={handleSearch} className={styles.filters} role="search">
        <div className={styles.searchWide}>
          <Input
            type="search"
            placeholder={t.support.searchPlaceholder}
            aria-label={t.support.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" loading={loading}>{t.support.submit}</Button>
      </form>

      {error && (
        <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
          <span className={styles.noticeText}>{error}</span>
        </div>
      )}

      {loading && (
        <div aria-busy="true" aria-label={common.loading}>
          <Skeleton lines={3} height={40} />
        </div>
      )}

      {!loading && searched && !hasResults && (
        <div className={`${styles.panel} ${styles.cellEmpty}`}>
          <p className={styles.cellPrimary}>{empty.search.title}</p>
          <p className={styles.cellSub}>{empty.search.body}</p>
        </div>
      )}

      {!loading && hasResults && (
        <div className={styles.resultsGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                {t.support.matchedUsers} ({results.users.length})
              </h2>
            </div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <tbody>
                  {results.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className={styles.cellPrimary}>{u.name || t.users.unnamed}</div>
                        <div className={styles.cellSub}>{u.email || t.users.noEmail}</div>
                      </td>
                      <td>
                        <div className={styles.badgeRow}>
                          {u.instagramAccounts?.map((a) => (
                            <Badge key={a.id} tone="neutral">@{a.igUsername}</Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                {t.support.matchedAccounts} ({results.accounts.length})
              </h2>
            </div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <tbody>
                  {results.accounts.map((acc) => {
                    const status = tokenStatusLabel(acc.tokenStatus);
                    return (
                      <tr key={acc.id}>
                        <td>
                          <div className={styles.cellPrimary}>@{acc.igUsername}</div>
                          <div className={styles.cellSub}>
                            {t.support.owner}: {acc.user?.name || acc.user?.email || common.unknown}
                          </div>
                        </td>
                        <td className={styles.alignRight}>
                          <Badge tone={status.tone === 'positive' ? 'positive' : 'warning'}>{status.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {selectedConversation && (
        <Modal
          title={`${t.support.inspectorTitle} — @${selectedConversation.instagramAccount?.igUsername} and @${selectedConversation.contact?.username}`}
          onClose={() => setSelectedConversation(null)}
          actions={(
            <Button size="sm" onClick={() => setSelectedConversation(null)}>{t.support.inspectorClose}</Button>
          )}
        >
          <div className={styles.thread}>
            {selectedConversation.messages?.map((m) => (
              <div key={m.id} className={`${styles.bubble} ${m.direction === 'outbound' ? styles.bubbleOut : styles.bubbleIn}`}>
                <div>{m.content}</div>
                <div className={styles.bubbleMeta}>
                  {m.direction === 'outbound' ? t.support.outbound : t.support.inbound} · {formatDateTime(m.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
