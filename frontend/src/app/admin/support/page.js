'use client';

import { useState } from 'react';
import { supportSearch, getSupportConversation } from '@/lib/api';
import styles from '../admin.module.css';

export default function AdminSupportPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ users: [], accounts: [] });
  const [loading, setLoading] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [loadingConv, setLoadingConv] = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const data = await supportSearch(query.trim());
      setResults(data);
    } catch (err) {
      console.error('Support search failed:', err);
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
      alert('Failed to load conversation details');
    } finally {
      setLoadingConv(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, textTransform: 'uppercase', marginBottom: '8px' }}>
          Support Lookup & Read-Only Inspector
        </h2>
        <p style={{ color: '#a3a3a3', fontSize: '0.875rem' }}>
          Instant search across Codeback emails, usernames, and IG IDs. Inspect user accounts and conversations safely.
        </p>
      </div>

      {/* Search Input */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Enter email or Instagram username (e.g. @mubassir or user@example.com)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, padding: '12px 16px', fontSize: '1rem' }}
        />
        <button type="submit" className="btn btn-primary btn-lg">Search Support DB</button>
      </form>

      {loading && (
        <div style={{ textAlign: 'center', padding: '32px' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      )}

      {/* Search Results */}
      {!loading && (results.users.length > 0 || results.accounts.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {/* Matched Users */}
          <div className={styles.tableContainer}>
            <div style={{ padding: '12px 16px', background: '#141414', borderBottom: '1px solid #262626', fontWeight: 'bold' }}>
              MATCHED USERS ({results.users.length})
            </div>
            <table className={styles.table}>
              <tbody>
                {results.users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ fontWeight: 'bold' }}>{u.name || 'Unnamed User'}</div>
                      <div style={{ fontSize: '0.75rem', color: '#a3a3a3' }}>{u.email || u.id}</div>
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
            <div style={{ padding: '12px 16px', background: '#141414', borderBottom: '1px solid #262626', fontWeight: 'bold' }}>
              MATCHED INSTAGRAM ACCOUNTS ({results.accounts.length})
            </div>
            <table className={styles.table}>
              <tbody>
                {results.accounts.map(acc => (
                  <tr key={acc.id}>
                    <td>
                      <div style={{ fontWeight: 'bold' }}>@{acc.igUsername}</div>
                      <div style={{ fontSize: '0.75rem', color: '#a3a3a3' }}>Owner: {acc.user?.name || acc.user?.email || 'N/A'}</div>
                    </td>
                    <td>
                      <span className={acc.tokenStatus === 'VALID' ? styles.badgeValid : styles.badgeExpired}>
                        {acc.tokenStatus}
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
              Read-Only Support View: @{selectedConversation.instagramAccount?.igUsername} &amp; @{selectedConversation.contact?.username}
            </h3>

            <div style={{ maxHeight: '350px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: '#000000', border: '1px solid #262626', margin: '12px 0' }}>
              {selectedConversation.messages?.map(m => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.direction === 'outbound' ? 'flex-end' : 'flex-start',
                    background: m.direction === 'outbound' ? '#ffffff' : '#141414',
                    color: m.direction === 'outbound' ? '#000000' : '#ffffff',
                    padding: '8px 12px',
                    maxWidth: '75%',
                    border: '1px solid #333333'
                  }}
                >
                  <div>{m.content}</div>
                  <div style={{ fontSize: '0.6875rem', opacity: 0.6, marginTop: '4px', textAlign: 'right' }}>
                    {m.direction} • {new Date(m.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.modalActions}>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedConversation(null)}>Close Inspector</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
