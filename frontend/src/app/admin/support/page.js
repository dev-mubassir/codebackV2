'use client';

/**
 * Admin — support lookup: find a customer or a connected account, read-only.
 *
 * Data layer is master's.
 *
 * The results grid collapses to one column on narrow screens.
 *
 * Admin rebuild (Gate 1): the conversation inspector is REMOVED, frontend and
 * backend. It rendered customers' Instagram DMs, and the admin panel shows
 * counts and metadata only — never message content.
 */

import { useState } from 'react';
import { supportSearch } from '@/lib/api';
import { Badge, Button, Input, Skeleton } from '@/app/components/ui';
import { admin as t, common, errors, empty } from '@/content/copy';
import { tokenStatusLabel } from '@/content/labels';
import styles from '../admin.module.css';

export default function AdminSupportPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ users: [], accounts: [] });
  const [loading, setLoading] = useState(false);
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

    </div>
  );
}
