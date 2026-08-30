'use client';

import { useState } from 'react';
import { supportSearch, getSupportConversation } from '@/lib/api';
import { admin as t, common, errors, empty } from '@/content/copy';
import { tokenStatusLabel } from '@/content/labels';
import { formatDateTime } from '@/content/format';
import styles from '../admin.module.css';

export default function AdminSupportPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ users: [], accounts: [] });
  const [loading, setLoading] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [loadingConv, setLoadingConv] = useState(false);
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
    } catch (err) {
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
    } catch (err) {
      setError(errors.admin.conversation);
    } finally {
      setLoadingConv(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
          {t.support.title}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{t.support.subtitle}</p>
      </div>

      {/* Search Input */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder={t.support.searchPlaceholder}
          aria-label={t.support.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, padding: '10px 14px' }}
        />
        <button type="submit" className="btn btn-primary">{t.support.submit}</button>
      </form>

      {error && (
        <div className={`${styles.alertBox} ${styles.alertBoxWarning}`} role="alert">
          <span className={styles.alertText}>{error}</span>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '32px' }} aria-busy="true" aria-label={common.loading}>
          <div className="spinner spinner-lg" style={{ margin: '0 auto' }} />
        </div>
      )}

      {!loading && searched && results.users.length === 0 && results.accounts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-tertiary)' }}>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            {empty.search.title}
          </h3>
          <p style={{ fontSize: 'var(--text-xs)', marginTop: '4px' }}>{empty.search.body}</p>
        </div>
      )}

      {/* Search Results */}
      {!loading && (results.users.length > 0 || results.accounts.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {/* Matched Users */}
          <div className={styles.tableContainer}>
            <div style={{ padding: '12px 16px', background: 'var(--bg-surface-secondary)', borderBottom: '1px solid var(--border-default)', fontWeight: 600, fontSize: 'var(--text-xs)' }}>
              {t.support.matchedUsers} ({results.users.length})
            </div>
            <table className={styles.table}>
              <tbody>
                {results.users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{u.name || t.users.unnamed}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{u.email || t.users.noEmail}</div>
                    </td>
                    <td>
                      {u.instagramAccounts?.map(a => (
                        <span key={a.id} className={styles.badgeValid} style={{ marginRight: '4px' }}>
                          @{a.igUsername}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Matched Accounts */}
          <div className={styles.tableContainer}>
            <div style={{ padding: '12px 16px', background: 'var(--bg-surface-secondary)', borderBottom: '1px solid var(--border-default)', fontWeight: 600, fontSize: 'var(--text-xs)' }}>
              {t.support.matchedAccounts} ({results.accounts.length})
            </div>
            <table className={styles.table}>
              <tbody>
                {results.accounts.map(acc => (
                  <tr key={acc.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>@{acc.igUsername}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        {t.support.owner}: {acc.user?.name || acc.user?.email || common.unknown}
                      </div>
                    </td>
                    <td>
                      <span className={acc.tokenStatus === 'VALID' ? styles.badgeValid : styles.badgeExpired}>
                        {tokenStatusLabel(acc.tokenStatus).label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Conversation Inspector Modal */}
      {selectedConversation && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent} style={{ maxWidth: '650px', width: '100%' }}>
            <h3 className={styles.modalTitle}>
              {t.support.inspectorTitle} — @{selectedConversation.instagramAccount?.igUsername} and
              {' '}@{selectedConversation.contact?.username}
            </h3>

            <div style={{ maxHeight: '350px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', margin: '12px 0' }}>
              {selectedConversation.messages?.map(m => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.direction === 'outbound' ? 'flex-end' : 'flex-start',
                    background: m.direction === 'outbound' ? 'var(--color-primary)' : 'var(--bg-surface)',
                    color: m.direction === 'outbound' ? 'white' : 'var(--text-primary)',
                    padding: '8px 12px',
                    maxWidth: '75%',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: 'var(--text-xs)'
                  }}
                >
                  <div>{m.content}</div>
                  <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '4px', textAlign: 'right' }}>
                    {m.direction === 'outbound' ? t.support.outbound : t.support.inbound} · {formatDateTime(m.createdAt)}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.modalActions}>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedConversation(null)}>{t.support.inspectorClose}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
