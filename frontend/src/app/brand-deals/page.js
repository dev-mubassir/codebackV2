'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getBrandDeals, updateBrandDealStatus } from '@/lib/api';
import styles from './brand-deals.module.css';

const STATUS_TABS = ['all', 'new', 'contacted', 'negotiating', 'confirmed', 'declined', 'expired'];

/**
 * Brand Deals — the signature "🔥 Brand Deal" pipeline view. Shows every
 * commercial collaboration AI has extracted across all of the creator's
 * connected Instagram accounts, with a lightweight status pipeline.
 */
export default function BrandDealsPage() {
  const router = useRouter();
  const [deals, setDeals] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const loadDeals = useCallback(async (status) => {
    setLoading(true);
    try {
      const data = await getBrandDeals(status === 'all' ? undefined : status);
      setDeals(data);
    } catch (err) {
      console.error('Failed to load brand deals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        await getMe();
      } catch (err) {
        router.push('/');
        return;
      }
      loadDeals(statusFilter);
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleTabChange(status) {
    setStatusFilter(status);
    loadDeals(status);
  }

  async function handleStatusChange(dealId, newStatus) {
    try {
      const updated = await updateBrandDealStatus(dealId, newStatus);
      setDeals(prev => prev.map(d => (d.id === dealId ? { ...d, status: updated.status } : d)));
    } catch (err) {
      alert('Failed to update deal status');
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <a href="/dashboard" className={styles.navBrand}>Codeback</a>
        <button className="btn btn-secondary btn-sm" onClick={() => router.push('/dashboard')}>← Dashboard</button>
      </nav>

      <main className={styles.content}>
        <div className={styles.header}>
          <h1>🔥 Brand Deals</h1>
          <p className={styles.subtitle}>Every commercial collaboration AI has found in your DMs, in one place.</p>
        </div>

        <div className={styles.statusTabs}>
          {STATUS_TABS.map(s => (
            <button
              key={s}
              className={`${styles.statusTab} ${statusFilter === s ? styles.statusTabActive : ''}`}
              onClick={() => handleTabChange(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px' }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : deals.length === 0 ? (
          <div className={styles.emptyState}>
            <h2>No brand deals yet</h2>
            <p>When AI detects a sponsorship or collaboration in your DMs, it will show up here automatically.</p>
          </div>
        ) : (
          <div className={styles.dealsGrid}>
            {deals.map(deal => (
              <div key={deal.id} className={styles.dealCard}>
                <div className={styles.dealCardHeader}>
                  <div>
                    <div className={styles.dealBrandName}>{deal.brandName || 'Unknown Brand'}</div>
                    <div className={styles.dealContact}>
                      @{deal.conversation?.contact?.username || 'unknown'} · {deal.instagramAccount?.igUsername ? `via @${deal.instagramAccount.igUsername}` : ''}
                    </div>
                  </div>
                </div>

                <div className={styles.dealFieldsGrid}>
                  <div className={styles.dealField}>
                    <span className={styles.dealFieldLabel}>Budget</span>
                    <span className={styles.dealFieldValue}>
                      {deal.budgetAmount ? `${deal.budgetAmount} ${deal.budgetCurrency || ''}`.trim() : 'Unknown'}
                    </span>
                  </div>
                  <div className={styles.dealField}>
                    <span className={styles.dealFieldLabel}>Deadline</span>
                    <span className={styles.dealFieldValue}>{deal.deadline || 'Unknown'}</span>
                  </div>
                  <div className={styles.dealField} style={{ gridColumn: '1 / -1' }}>
                    <span className={styles.dealFieldLabel}>Deliverables</span>
                    <span className={styles.dealFieldValue}>{deal.deliverables || 'Unknown'}</span>
                  </div>
                  {deal.campaign && (
                    <div className={styles.dealField} style={{ gridColumn: '1 / -1' }}>
                      <span className={styles.dealFieldLabel}>Campaign</span>
                      <span className={styles.dealFieldValue}>{deal.campaign}</span>
                    </div>
                  )}
                </div>

                <div className={styles.dealFooter}>
                  <select
                    className={styles.statusSelect}
                    value={deal.status}
                    onChange={(e) => handleStatusChange(deal.id, e.target.value)}
                  >
                    {STATUS_TABS.filter(s => s !== 'all').map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                  </select>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => router.push(`/inbox?conversationId=${deal.conversationId}`)}
                  >
                    Open Conversation →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
