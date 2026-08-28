'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { io } from 'socket.io-client';
import { getMe, getAccounts, getInstagramAuthUrl, disconnectAccount, getDashboardSummary, getAnalyticsSummary } from '@/lib/api';
import AppShell from '@/app/components/AppShell';
import styles from './dashboard.module.css';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

/**
 * Dashboard page — the Creator Home. Shows what AI handled while the
 * creator was away, what needs their attention now, their connected
 * Instagram accounts, and Cloudflare-style Analytics overview.
 */
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // Analytics states
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsTimeRange, setAnalyticsTimeRange] = useState('24h');
  const [refreshingAnalytics, setRefreshingAnalytics] = useState(false);

  const fetchAnalytics = useCallback(async (timeRange = '24h') => {
    try {
      const data = await getAnalyticsSummary(timeRange);
      setAnalyticsData(data);
    } catch (e) {
      console.error('Failed to load analytics summary:', e);
    }
  }, []);

  const refreshSummary = useCallback(async () => {
    try {
      const summaryData = await getDashboardSummary();
      setSummary(summaryData);
    } catch (e) {
      console.error('Failed to load dashboard summary:', e);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    refreshSummary();
    fetchAnalytics(analyticsTimeRange);
  }, [refreshSummary, fetchAnalytics, analyticsTimeRange]);

  useEffect(() => {
    async function loadData() {
      try {
        const userData = await getMe();
        if (!userData?.onboardingCompleted) {
          router.push('/onboarding');
          return;
        }
        setUser(userData);

        const accountsData = await getAccounts();
        setAccounts(accountsData);

        getDashboardSummary().then(setSummary).catch((e) => console.error('Failed to load dashboard summary:', e));
        fetchAnalytics(analyticsTimeRange);
      } catch (err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Window focus & tab visibility listener (auto-refreshes when returning from /inbox or another tab)
  useEffect(() => {
    const onFocus = () => refreshAll();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshAll();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshAll]);

  // Real-time Socket.io updates (refreshes instantly when messages are read or arrive)
  useEffect(() => {
    if (!user?.id) return;

    const socket = io(BACKEND_URL, { withCredentials: true });

    socket.on('connect', () => {
      socket.emit('join', { userId: user.id });
    });

    const handleSocketUpdate = () => {
      refreshAll();
    };

    socket.on('conversation_read', handleSocketUpdate);
    socket.on('conversation_updated', handleSocketUpdate);
    socket.on('new_message', handleSocketUpdate);
    socket.on('chat_cleared', handleSocketUpdate);
    socket.on('analysis_completed', handleSocketUpdate);
    socket.on('conversation_deleted', handleSocketUpdate);

    return () => {
      socket.disconnect();
    };
  }, [user, refreshAll]);

  async function handleRefreshAnalytics() {
    setRefreshingAnalytics(true);
    await fetchAnalytics(analyticsTimeRange);
    setTimeout(() => setRefreshingAnalytics(false), 600);
  }

  function handleTimeRangeChange(e) {
    const newRange = e.target.value;
    setAnalyticsTimeRange(newRange);
    fetchAnalytics(newRange);
  }

  function handleConnect(e) {
    if (e) e.preventDefault();
    // Programmatic navigation prevents mobile OS from intercepting universal links into the native app
    window.location.href = getInstagramAuthUrl();
  }

  async function handleDisconnect(accountId) {
    if (!confirm('Disconnect this Instagram account? Your conversation history will be kept safe and will reappear if you reconnect.')) return;

    try {
      await disconnectAccount(accountId);
      setAccounts(prev => prev.map(a => (a.id === accountId ? { ...a, connectionStatus: 'DISCONNECTED' } : a)));
    } catch (err) {
      alert('Failed to disconnect account');
    }
  }

  if (loading) {
    return (
      <AppShell activeRoute="/dashboard">
        <div className={styles.loadingSkeleton}>
          <div className={`skeleton ${styles.skeletonTitle}`} />
          <div className={styles.skeletonCards}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className={`skeleton ${styles.skeletonCard}`} />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  const breakdown = summary?.breakdown || {};
  const away = summary?.whileYouWereAway;

  return (
    <AppShell activeRoute="/dashboard">
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            Good {greetingTimeOfDay()}{user?.name ? `, ${user.name}` : ''}
          </h1>
          <p className={styles.pageSubtitle}>
            {summary
              ? `AI reviewed ${summary.totalDmsReviewed.toLocaleString()} DMs. ${summary.attentionQueueCount} conversation${summary.attentionQueueCount === 1 ? '' : 's'} need${summary.attentionQueueCount === 1 ? 's' : ''} your attention.`
              : 'Manage your connected Instagram accounts and monitor AI activity.'}
          </p>
        </div>
        <a
          href={getInstagramAuthUrl()}
          onClick={handleConnect}
          className="btn btn-primary"
          id="connect-instagram-dashboard-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
          </svg>
          {accounts.length > 0 ? 'Add Account' : 'Connect Instagram'}
        </a>
      </div>

      {/* Connection problems */}
      {summary?.connectionProblems?.length > 0 && (
        <div className={styles.alertBanner}>
          <div className={styles.alertIcon}>⚠️</div>
          <div className={styles.alertContent}>
            <strong>Account attention needed</strong>
            <span>{summary.connectionProblems.map(a => `@${a.igUsername || 'account'}`).join(', ')} need{summary.connectionProblems.length === 1 ? 's' : ''} reconnection.</span>
          </div>
        </div>
      )}

      {/* Metrics Cards */}
      {summary && (
        <div className={styles.metricsGrid}>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=important')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconAttention}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            </div>
            <div className={styles.metricValue}>{summary.attentionQueueCount || 0}</div>
            <div className={styles.metricLabel}>Need Attention</div>
          </button>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=hot_leads')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconDeals}`}>🔥</div>
            <div className={styles.metricValue}>{breakdown.hotLeads || 0}</div>
            <div className={styles.metricLabel}>Hot Leads</div>
          </button>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=collaboration')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconCollabs}`}>🤝</div>
            <div className={styles.metricValue}>{breakdown.collaborations || 0}</div>
            <div className={styles.metricLabel}>Collaborations</div>
          </button>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=unread')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconUnread}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </div>
            <div className={styles.metricValue}>{summary.unreadCount || 0}</div>
            <div className={styles.metricLabel}>Unread Messages</div>
          </button>
        </div>
      )}

      {/* While You Were Away */}
      {away && (
        <div className={styles.awayCard}>
          <div className={styles.awayHeader}>
            <h2 className={styles.cardTitle}>While you were away</h2>
            <span className={styles.awaySubtext}>{away.newMessages} new DM{away.newMessages === 1 ? '' : 's'}</span>
          </div>
          <div className={styles.awayGrid}>
            {Object.entries(away.categoryCounts || {}).map(([category, count]) => (
              <button key={category} className={styles.awayChip} onClick={() => router.push(`/inbox?filter=${category}`)}>
                <span className={styles.awayChipCount}>{count}</span>
                <span className={styles.awayChipLabel}>{category.replace(/_/g, ' ')}</span>
              </button>
            ))}
          </div>
          {away.needsAttention > 0 && (
            <button className="btn btn-primary btn-sm" onClick={() => router.push('/inbox?filter=important')} style={{ marginTop: '16px' }}>
              Review {away.needsAttention} important conversation{away.needsAttention === 1 ? '' : 's'} →
            </button>
          )}
        </div>
      )}

      {/* Connected Accounts */}
      <div className={styles.sectionHeader}>
        <h2 className={styles.cardTitle}>Connected Accounts</h2>
        <span className={styles.sectionCount}>{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span>
      </div>

      {accounts.length > 0 ? (
        <div className={styles.accountsList}>
          {accounts.map((account) => {
            const isDisconnected = account.connectionStatus === 'DISCONNECTED';
            const needsReconnect = account.tokenStatus === 'NEEDS_RECONNECT' || isDisconnected;
            return (
              <div key={account.id} className={styles.accountRow}>
                <div className={styles.accountLeft}>
                  {account.igProfilePic ? (
                    <img src={account.igProfilePic} alt={account.igUsername} className={styles.accountAvatar} />
                  ) : (
                    <div className={`avatar avatar-lg ${styles.accountAvatarFallback}`}>
                      {(account.igUsername || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <div className={styles.accountInfo}>
                    <div className={styles.accountUsername}>@{account.igUsername || 'unknown'}</div>
                    {account.igName && <div className={styles.accountName}>{account.igName}</div>}
                  </div>
                </div>
                <div className={styles.accountMeta}>
                  {isDisconnected ? (
                    <span className="badge badge-warning">Disconnected</span>
                  ) : (
                    <span className="badge badge-success">Connected</span>
                  )}
                  {account.tokenExpiresAt && (
                    <span className={styles.accountMetaItem}>
                      Token expires {new Date(account.tokenExpiresAt).toLocaleDateString()}
                    </span>
                  )}
                  {account._count?.conversations !== undefined && (
                    <span className={styles.accountMetaItem}>
                      {account._count.conversations} conversation{account._count.conversations !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className={styles.accountActions}>
                  {needsReconnect ? (
                    <a href={getInstagramAuthUrl()} onClick={handleConnect} className="btn btn-primary btn-sm">Reconnect</a>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => router.push(`/inbox?accountId=${account.id}`)}>
                      Open Inbox
                    </button>
                  )}
                  {!isDisconnected && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleDisconnect(account.id)}>
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
          </div>
          <h3 className={styles.emptyTitle}>No accounts connected</h3>
          <p className={styles.emptyDesc}>Connect your Instagram Professional account to start managing DMs with AI.</p>
          <a href={getInstagramAuthUrl()} onClick={handleConnect} className="btn btn-primary" style={{ marginTop: '12px' }}>Connect Instagram</a>
        </div>
      )}

      {/* Cloudflare-Inspired Analytics Section */}
      <div className={styles.analyticsSection}>
        <div className={styles.analyticsHeaderRow}>
          <h2 className={styles.analyticsTitle}>Analytics</h2>
          <div className={styles.analyticsControls}>
            <div className={styles.timeRangeSelectWrap}>
              <svg className={styles.calendarIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <select
                className={styles.timeRangeSelect}
                value={analyticsTimeRange}
                onChange={handleTimeRangeChange}
                aria-label="Analytics time range"
              >
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
              <svg className={styles.chevronIcon} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            <button
              type="button"
              className={styles.analyticsIconBtn}
              title="Add metric filter"
              aria-label="Add metric"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            <button
              type="button"
              className={`${styles.analyticsIconBtn} ${refreshingAnalytics ? styles.spinning : ''}`}
              onClick={handleRefreshAnalytics}
              title="Refresh analytics data"
              aria-label="Refresh analytics"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          </div>
        </div>

        {/* Primary Row: 2 Big Metric Cards with Sparklines */}
        <div className={styles.analyticsGridTop}>
          {/* Card 1: Total Inbound DMs */}
          <div className={styles.analyticsCard}>
            <div>
              <div className={styles.cardHeaderRow}>
                <span className={styles.cardLabel}>📥 Total Inbound DMs</span>
              </div>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricBigValue}>
                  {analyticsData?.totalDms?.formatted || '0'}
                </span>
                <DeltaBadge changePercent={analyticsData?.totalDms?.changePercent} />
              </div>
            </div>
            <SparklineChart
              series={analyticsData?.totalDms?.series}
              labels={analyticsData?.totalDms?.labels}
              unit="DMs"
              strokeColor="#2563eb"
              fillId="sparkline-dms-grad"
            />
          </div>

          {/* Card 2: Hot Leads & Commercial Inquiries */}
          <div className={styles.analyticsCard}>
            <div>
              <div className={styles.cardHeaderRow}>
                <span className={styles.cardLabel}>🔥 Hot Leads & Buying Intent</span>
              </div>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricBigValue}>
                  {analyticsData?.hotLeads?.formatted || '0'}
                </span>
                <DeltaBadge changePercent={analyticsData?.hotLeads?.changePercent} />
              </div>
            </div>
            <SparklineChart
              series={analyticsData?.hotLeads?.series}
              labels={analyticsData?.hotLeads?.labels}
              unit="hot leads"
              strokeColor="#f59e0b"
              fillId="sparkline-hotleads-grad"
            />
          </div>
        </div>

        {/* Secondary Row: 4 Real DM Business Metric Cards */}
        <div className={styles.analyticsGridBottom}>
          {/* Card 3: Needs Attention & Important */}
          <div className={`${styles.analyticsCard} ${styles.analyticsCardCompact}`}>
            <div>
              <div className={styles.cardHeaderRow}>
                <span className={styles.cardLabel}>⭐ Needs Attention</span>
              </div>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricBigValue}>
                  {analyticsData?.needsAttention?.formatted || '0'}
                </span>
              </div>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              High-priority & escalated threads
            </span>
          </div>

          {/* Card 4: Brand Deals & Collaborations */}
          <div className={`${styles.analyticsCard} ${styles.analyticsCardCompact}`}>
            <div>
              <div className={styles.cardHeaderRow}>
                <span className={styles.cardLabel}>💰 Brand Deals & Collabs</span>
              </div>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricBigValue}>
                  {analyticsData?.brandDeals?.formatted || '0'}
                </span>
              </div>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              Commercial sponsor inquiries
            </span>
          </div>

          {/* Card 5: AI Auto-Replied */}
          <div className={`${styles.analyticsCard} ${styles.analyticsCardCompact}`}>
            <div>
              <div className={styles.cardHeaderRow}>
                <span className={styles.cardLabel}>🤖 AI Auto-Replied</span>
              </div>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricBigValue}>
                  {analyticsData?.aiHandled?.formatted || '0'}
                </span>
              </div>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              Answered using Core Profile
            </span>
          </div>

          {/* Card 6: Spam & Threats Blocked */}
          <div className={`${styles.analyticsCard} ${styles.analyticsCardCompact}`}>
            <div>
              <div className={styles.cardHeaderRow}>
                <span className={styles.cardLabel}>🛡️ Spam Blocked</span>
              </div>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricBigValue}>
                  {analyticsData?.spamBlocked?.formatted || '0'}
                </span>
              </div>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              Zero-token filter protected
            </span>
          </div>
        </div>

        {/* Category-Adaptive Intelligence Breakdown Card */}
        <div className={styles.categoryIntelligenceCard}>
          <div className={styles.categoryHeader}>
            <div>
              <h3 className={styles.categoryTitle}>{analyticsData?.categoryTitle || '🏢 Business Intelligence & Lead Trends'}</h3>
              <p className={styles.categorySubtitle}>
                Real-time inquiry breakdown adapted to your active business profile offerings.
              </p>
            </div>
          </div>

          {/* 4 Category Metric Chips */}
          <div className={styles.categoryGrid}>
            {(analyticsData?.categoryMetrics || []).map((m, idx) => (
              <div key={idx} className={styles.categoryChip}>
                <div className={styles.categoryChipTop}>
                  <span className={styles.categoryChipIcon}>{m.icon}</span>
                  <span className={styles.categoryChipValue}>{m.value}</span>
                </div>
                <span className={styles.categoryChipLabel}>{m.label}</span>
                <span className={styles.categoryChipDesc}>{m.desc}</span>
              </div>
            ))}
          </div>

          {/* Intent Distribution Progress Visualizer */}
          {analyticsData?.intentDistribution && (
            <div className={styles.distributionSection}>
              <div className={styles.distributionHeader}>
                <span className={styles.distributionTitle}>DM Intent & Inquiry Distribution</span>
              </div>

              <div className={styles.distributionBar}>
                {analyticsData.intentDistribution.map((item) => (
                  <div
                    key={item.key}
                    className={styles.distributionSegment}
                    style={{
                      width: `${item.pct}%`,
                      backgroundColor: item.color,
                    }}
                    title={`${item.label}: ${item.count} (${item.pct}%)`}
                  />
                ))}
              </div>

              <div className={styles.distributionLegend}>
                {analyticsData.intentDistribution.map((item) => (
                  <div key={item.key} className={styles.legendItem}>
                    <span className={styles.legendDot} style={{ backgroundColor: item.color }} />
                    <span>{item.label}</span>
                    <span className={styles.legendCount}>{item.count}</span>
                    <span className={styles.legendPct}>({item.pct}%)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DeltaBadge({ changePercent }) {
  if (changePercent === null || changePercent === undefined || changePercent === 0) {
    return null;
  }
  if (changePercent > 0) {
    return <span className={styles.deltaPositive}>↗ {changePercent}%</span>;
  }
  return <span className={styles.deltaNegative}>↘ {Math.abs(changePercent)}%</span>;
}

function SparklineChart({ series = [], labels = [], unit = 'DMs', strokeColor = '#2563eb', fillId = 'sparkline-grad' }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  if (!series || series.length === 0 || series.every((v) => v === 0)) {
    return <div className={styles.noDataPlaceholder}>Not enough data</div>;
  }

  const maxVal = Math.max(...series, 1);
  const chartWidth = 320;
  const chartHeight = 85;
  const topPadding = 12;
  const bottomPadding = 10;
  const usableHeight = chartHeight - topPadding - bottomPadding;

  const points = series.map((val, idx) => {
    const x = (idx / (series.length - 1 || 1)) * chartWidth;
    const y = topPadding + usableHeight - (val / maxVal) * usableHeight;
    return { x, y, val };
  });

  const pathD = points.reduce((acc, pt, idx) => {
    return idx === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }, '');

  const lastPoint = points[points.length - 1] || { x: chartWidth, y: chartHeight };
  const firstPoint = points[0] || { x: 0, y: chartHeight };
  const areaD = `${pathD} L ${lastPoint.x.toFixed(1)} ${chartHeight} L ${firstPoint.x.toFixed(1)} ${chartHeight} Z`;

  const topTick = maxVal >= 1000 ? (maxVal / 1000).toFixed(1) + 'k' : maxVal;
  const midTick = Math.round(maxVal / 2) >= 1000 ? (Math.round(maxVal / 2) / 1000).toFixed(1) + 'k' : Math.round(maxVal / 2);

  function handlePointerMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const chartPixelWidth = (chartWidth / 380) * rect.width;
    const ratio = Math.min(Math.max(mouseX / chartPixelWidth, 0), 1);
    const idx = Math.min(Math.max(Math.round(ratio * (series.length - 1)), 0), series.length - 1);
    
    setHoveredIdx(idx);
    const ptX = (points[idx].x / 380) * rect.width;
    const ptY = (points[idx].y / 95) * rect.height;
    setTooltipPos({ x: ptX, y: ptY });
  }

  function handlePointerLeave() {
    setHoveredIdx(null);
  }

  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : null;
  const activeLabel = hoveredIdx !== null && labels && labels[hoveredIdx] ? labels[hoveredIdx] : `Point #${(hoveredIdx ?? 0) + 1}`;

  return (
    <div
      className={styles.sparklineContainer}
      onMouseMove={handlePointerMove}
      onMouseLeave={handlePointerLeave}
      onTouchMove={(e) => {
        if (e.touches && e.touches[0]) {
          handlePointerMove(e.touches[0]);
        }
      }}
      onTouchEnd={handlePointerLeave}
    >
      {hoveredIdx !== null && activePoint && (
        <div
          className={styles.sparklineTooltip}
          style={{
            left: `${Math.max(35, Math.min(tooltipPos.x, 285))}px`,
            top: `${Math.max(20, tooltipPos.y)}px`,
          }}
        >
          <span className={styles.sparklineTooltipValue}>
            {activePoint.val.toLocaleString()} {unit}
          </span>
          <span className={styles.sparklineTooltipLabel}>
            {activeLabel}
          </span>
        </div>
      )}

      <svg
        className={styles.sparklineSvg}
        viewBox="0 0 380 95"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Faint Horizontal Gridlines */}
        <line x1="0" y1={topPadding} x2={chartWidth} y2={topPadding} stroke="var(--border-subtle)" strokeDasharray="3 3" strokeWidth="1" />
        <line x1="0" y1={topPadding + usableHeight / 2} x2={chartWidth} y2={topPadding + usableHeight / 2} stroke="var(--border-subtle)" strokeDasharray="3 3" strokeWidth="1" />
        <line x1="0" y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="var(--border-subtle)" strokeWidth="1" />

        {/* Y-Axis Numbers (Right Side) */}
        <text x="332" y={topPadding + 4} fill="var(--text-tertiary)" fontSize="10" fontFamily="var(--font-sans)">{topTick}</text>
        <text x="332" y={topPadding + usableHeight / 2 + 3} fill="var(--text-tertiary)" fontSize="10" fontFamily="var(--font-sans)">{midTick}</text>
        <text x="332" y={chartHeight + 1} fill="var(--text-tertiary)" fontSize="10" fontFamily="var(--font-sans)">0</text>

        {/* Gradient Fill Under Line */}
        <path d={areaD} fill={`url(#${fillId})`} />

        {/* Line */}
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover Crosshair Line and Circle Marker */}
        {activePoint && (
          <g>
            <line
              x1={activePoint.x}
              y1={topPadding}
              x2={activePoint.x}
              y2={chartHeight}
              stroke="#64748b"
              strokeDasharray="2 2"
              strokeWidth="1.2"
            />
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r="4.5"
              fill="#ffffff"
              stroke={strokeColor}
              strokeWidth="2.5"
            />
          </g>
        )}
      </svg>
    </div>
  );
}

function greetingTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}
