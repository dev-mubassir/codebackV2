'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getBrandDeals, updateBrandDealStatus } from '@/lib/api';
import AppShell from '@/app/components/AppShell';
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
    <AppShell activeRoute="/brand-deals">
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>🔥 Brand Deals Pipeline</h1>
          <p className={styles.pageSubtitle}>
            Commercial sponsorship opportunities extracted from your DMs by AI.
          </p>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className={styles.statusTabs}>
        {STATUS_TABS.map(s => (
          <button
            key={s}
            className={`${styles.statusTab} ${statusFilter === s ? styles.statusTabActive : ''}`}
            onClick={() => handleTabChange(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Deals Content */}
      {loading ? (
        <div className={styles.loadingContainer}>
          <div className="spinner spinner-lg" />
        </div>
      ) : deals.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🤝</div>
          <h3 className={styles.emptyTitle}>No brand deals found</h3>
          <p className={styles.emptyDesc}>
            {statusFilter === 'all'
              ? 'When AI detects sponsorship inquiries in your Instagram DMs, they will automatically appear here.'
              : `No brand deals currently marked as "${statusFilter}".`}
          </p>
        </div>
      ) : (
        <div className={styles.dealsGrid}>
          {deals.map(deal => (
            <div key={deal.id} className={styles.dealCard}>
              <div className={styles.dealCardHeader}>
                <div>
                  <h3 className={styles.dealBrandName}>{deal.brandName || 'Unknown Brand'}</h3>
                  <div className={styles.dealContact}>
                    @{deal.conversation?.contact?.username || 'unknown'}
                    {deal.instagramAccount?.igUsername ? ` · via @${deal.instagramAccount.igUsername}` : ''}
                  </div>
                </div>
                <span className={`badge ${getStatusBadgeClass(deal.status)}`}>
                  {deal.status.toUpperCase()}
                </span>
              </div>

              <div className={styles.dealFieldsGrid}>
                <div className={styles.dealField}>
                  <span className={styles.dealFieldLabel}>Budget</span>
                  <span className={styles.dealFieldValue}>
                    {deal.budgetAmount ? `${deal.budgetAmount} ${deal.budgetCurrency || ''}`.trim() : 'Not specified'}
                  </span>
                </div>
                <div className={styles.dealField}>
                  <span className={styles.dealFieldLabel}>Deadline</span>
                  <span className={styles.dealFieldValue}>{deal.deadline || 'Not specified'}</span>
                </div>
                <div className={`${styles.dealField} ${styles.dealFieldFull}`}>
                  <span className={styles.dealFieldLabel}>Deliverables</span>
                  <span className={styles.dealFieldValue}>{deal.deliverables || 'Not specified'}</span>
                </div>
                {deal.campaign && (
                  <div className={`${styles.dealField} ${styles.dealFieldFull}`}>
                    <span className={styles.dealFieldLabel}>Campaign</span>
                    <span className={styles.dealFieldValue}>{deal.campaign}</span>
                  </div>
                )}
              </div>

              <div className={styles.dealFooter}>
                <select
                  className="select btn-sm"
                  value={deal.status}
                  onChange={(e) => handleStatusChange(deal.id, e.target.value)}
                  style={{ width: 'auto', padding: '4px 28px 4px 10px', fontSize: '12px' }}
                >
                  {STATUS_TABS.filter(s => s !== 'all').map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                </select>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => router.push(`/inbox?conversationId=${deal.conversationId}`)}
                >
                  Open Chat →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'confirmed': return 'badge-success';
    case 'negotiating': return 'badge-ai';
    case 'contacted': return 'badge-info';
    case 'declined': case 'expired': return 'badge-error';
    default: return 'badge-warning';
  }
}
