'use client';

import { useState } from 'react';
import { supportSearch, getSupportConversation } from '@/lib/api';
import Icon from '@/app/components/Icon';
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
        <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '4px' }}>
          {t.support.title}
        </h2>
        <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>{t.support.subtitle}</p>
      </div>

      {/* Search Input */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px', marginBottom: '28px' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={t.support.searchPlaceholder}
            aria-label={t.support.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', padding: '12px 16px' }}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-md">
          <Icon name="search" size={14} />
          <span>{t.support.submit}</span>
        </button>
      </form>

      {error && (
        <div className={`${styles.alertBox} ${styles.alertBoxWarning}`} role="alert">
          <Icon name="alertTriangle" size={16} />
          <span className={styles.alertText}>{error}</span>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px' }} aria-busy="true" aria-label={common.loading}>
          <div className="spinner spinner-lg" style={{ margin: '0 auto' }} />
        </div>
      )}

      {!loading && searched && results.users.length === 0 && results.accounts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 24px', background: '#ffffff', borderRadius: '18px', border: '1px dashed #cbd5e1' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <Icon name="search" size={22} />
          </div>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>
            {empty.search.title}
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>{empty.search.body}</p>
        </div>
      )}

      {/* Search Results */}
      {!loading && (results.users.length > 0 || results.accounts.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
          {/* Matched Users */}
          <div className={styles.tableContainer}>
            <div className={styles.panelHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="users" size={16} />
                <h3 className={styles.panelTitle}>{t.support.matchedUsers} ({results.users.length})</h3>
              </div>
            </div>
            <table className={styles.table} style={{ minWidth: 'auto' }}>
              <tbody>
                {results.users.length === 0 ? (
                  <tr>
                    <td style={{ color: '#94a3b8', textAlign: 'center', padding: '24px' }}>None found</td>
                  </tr>
                ) : (
                  results.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{u.name || t.users.unnamed}</div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>{u.email || t.users.noEmail}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {u.instagramAccounts?.map((a) => (
                            <span key={a.id} className={styles.badgeValid}>
                              <Icon name="instagram" size={11} />
                              <span>@{a.igUsername}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Matched Accounts */}
          <div className={styles.tableContainer}>
            <div className={styles.panelHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="instagram" size={16} />
                <h3 className={styles.panelTitle}>{t.support.matchedAccounts} ({results.accounts.length})</h3>
              </div>
            </div>
            <table className={styles.table} style={{ minWidth: 'auto' }}>
              <tbody>
                {results.accounts.length === 0 ? (
                  <tr>
                    <td style={{ color: '#94a3b8', textAlign: 'center', padding: '24px' }}>None found</td>
                  </tr>
                ) : (
                  results.accounts.map((acc) => (
                    <tr key={acc.id}>
                      <td>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>@{acc.igUsername}</div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {t.support.owner}: {acc.user?.name || acc.user?.email || common.unknown}
                        </div>
                      </td>
                      <td>
                        <span className={acc.tokenStatus === 'VALID' ? styles.badgeValid : styles.badgeExpired}>
                          <Icon name={acc.tokenStatus === 'VALID' ? 'check' : 'alertTriangle'} size={11} />
                          <span>{tokenStatusLabel(acc.tokenStatus).label}</span>
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Conversation Inspector Modal */}
      {selectedConversation && (
        <div className={styles.modalOverlay} onClick={() => setSelectedConversation(null)}>
          <div className={styles.modalContent} style={{ maxWidth: '680px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <Icon name="messageSquare" size={20} />
              <h3 className={styles.modalTitle} style={{ margin: 0 }}>
                {t.support.inspectorTitle} — @{selectedConversation.instagramAccount?.igUsername} & @{selectedConversation.contact?.username}
              </h3>
            </div>

            <div style={{ maxHeight: '380px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: '16px', margin: '14px 0' }}>
              {selectedConversation.messages?.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.direction === 'outbound' ? 'flex-end' : 'flex-start',
                    background: m.direction === 'outbound' ? '#2563eb' : '#ffffff',
                    color: m.direction === 'outbound' ? '#ffffff' : '#0f172a',
                    padding: '10px 14px',
                    maxWidth: '75%',
                    borderRadius: '14px',
                    border: '1px solid',
                    borderColor: m.direction === 'outbound' ? '#2563eb' : '#f1f5f9',
                    fontSize: '13px',
                    boxShadow: '0 2px 6px rgba(15, 23, 42, 0.04)',
                  }}
                >
                  <div>{m.content}</div>
                  <div style={{ fontSize: '10px', opacity: 0.75, marginTop: '4px', textAlign: 'right' }}>
                    {m.direction === 'outbound' ? t.support.outbound : t.support.inbound} · {formatDateTime(m.createdAt)}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className="btn btn-secondary btn-md"
                onClick={() => setSelectedConversation(null)}
              >
                {common.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
