'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { io } from 'socket.io-client';
import { getMe, getAccounts, getInstagramAuthUrl, disconnectAccount, getDashboardSummary, getAnalyticsSummary } from '@/lib/api';
import AppShell from '@/app/components/AppShell';
import Icon from '@/app/components/Icon';
import AuthErrorBanner from '@/app/components/AuthErrorBanner';
import TrialStateCard from '@/app/components/billing/TrialStateCard';
import useBillingSummary from '@/app/components/billing/useBillingSummary';
import { dashboard as t, common, errors, empty, confirm as confirmCopy } from '@/content/copy';
import { categoryLabel, replyModeLabel, replyModeSendsAutomatically, tokenStatusLabel, connectionStatusLabel } from '@/content/labels';
import { formatCount, formatDate, plural, pluralWord, MIN_PERCENT_SAMPLE } from '@/content/format';
import { BACKEND_URL } from '@/lib/backendUrl';
import styles from './dashboard.module.css';

/**
 * Dashboard — what arrived, what needs the user personally, which accounts are
 * connected, and how the last 24 hours / 7 days / 30 days compare.
 */
export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsError, setAnalyticsError] = useState('');
  const [analyticsTimeRange, setAnalyticsTimeRange] = useState('24h');
  const [refreshingAnalytics, setRefreshingAnalytics] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const isRedirectingRef = useRef(false);
  // Why the connect button refused, if it did. Rendered inline so the user
  // never leaves the page to find out.
  const [connectBlocked, setConnectBlocked] = useState(null);

  const fetchAnalytics = useCallback(async (timeRange = '24h') => {
    try {
      const data = await getAnalyticsSummary(timeRange);
      setAnalyticsData(data);
      setAnalyticsError('');
    } catch (e) {
      setAnalyticsError(errors.analytics);
    }
  }, []);

  const refreshSummary = useCallback(async () => {
    try {
      const summaryData = await getDashboardSummary();
      setSummary(summaryData);
      setLoadError('');
    } catch (e) {
      setLoadError(errors.dashboard);
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

        refreshSummary();
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

  // Refresh when the user comes back from /inbox or another tab.
  useEffect(() => {
    const onFocus = () => refreshAll();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshAll();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshAll]);

  // Live updates when messages are read or arrive.
  useEffect(() => {
    if (!user?.id) return;

    const socket = io(BACKEND_URL, { withCredentials: true });

    socket.on('connect', () => {
      socket.emit('join', { userId: user.id });
    });

    const handleSocketUpdate = () => refreshAll();

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

    // CATCH IT BEFORE THE REDIRECT.
    //
    // The backend refuses to start a connect for an unverified address and
    // bounces to /profile?error=email_unverified. That is correct — a trial
    // needs a confirmed address — but sending someone through Instagram's
    // consent screen only to reject them on the way back is a bad way to
    // deliver the news. Say it here instead. The error rendering stays as a
    // fallback, because the redirect is also reachable directly.
    if (user && user.needsEmail) {
      setConnectBlocked('email_required');
      return;
    }
    if (user && user.emailVerified === false) {
      setConnectBlocked('email_unverified');
      return;
    }

    if (isRedirectingRef.current) return;
    isRedirectingRef.current = true;
    setIsRedirecting(true); // keep this for the UI (aria-disabled, opacity, spin)
    // Programmatic navigation stops mobile from intercepting the link into
    // the native Instagram app.
    window.location.href = getInstagramAuthUrl();
  }

  async function handleDisconnect(accountId) {
    if (!confirm(`${confirmCopy.disconnectAccount.title}\n\n${confirmCopy.disconnectAccount.body}`)) return;

    try {
      await disconnectAccount(accountId);
      setAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, connectionStatus: 'DISCONNECTED' } : a)));
    } catch (err) {
      setLoadError(errors.disconnectAccount);
    }
  }

  if (loading) {
    return (
      <AppShell activeRoute="/dashboard">
        <div className={styles.loadingSkeleton} aria-busy="true" aria-label={common.loading}>
          <div className={`skeleton ${styles.skeletonTitle}`} />
          <div className={styles.skeletonCards}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={`skeleton ${styles.skeletonCard}`} />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  const breakdown = summary?.breakdown || {};
  const away = summary?.whileYouWereAway;
  const attentionCount = summary?.attentionQueueCount || 0;
  // `collaborations` is the combined brand_deal + collaboration count from the
  // dashboard endpoint. Sponsorships and collabs are one concept in the UI
  // ("brand deals"), so this is the count that belongs on the card — the
  // narrower `brandDeals` key would undercount the folder it links to.
  const brandDealCount = breakdown.collaborations || 0;

  const replyMode = analyticsData?.replyMode;
  const replyModeMeta = replyModeLabel(replyMode);
  const sendsAutomatically = replyModeSendsAutomatically(replyMode);

  return (
    <AppShell activeRoute="/dashboard">
      <AuthErrorBanner />

      {/* The connect button refused before starting OAuth. Rendered here so
          the reason appears in place, without a round trip through Instagram
          and back. */}
      {connectBlocked && (
        <div
          role="alert"
          style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            padding: '12px 14px', marginBottom: 16, borderRadius: 10,
            background: 'var(--color-error-bg, #fef2f2)',
            border: '1px solid var(--color-error-border, #fecaca)',
            color: 'var(--color-error-text, #991b1b)',
            fontSize: 14, lineHeight: 1.5,
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 2 }}>
            <Icon name="alertTriangle" size={15} />
          </span>
          <div style={{ flex: 1 }}>
            <div>{errors.oauthCallback[connectBlocked] || errors.oauthCallback.generic}</div>
            <div style={{ marginTop: 8 }}>
              <Link href="/profile" className="btn" style={{ fontSize: 13, padding: '6px 12px' }}>
                Go to your profile
              </Link>
            </div>
          </div>
        </div>
      )}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            {t.greeting[greetingTimeOfDay()]}{user?.name ? `, ${user.name}` : ''}
          </h1>
          <p className={styles.pageSubtitle}>
            {summary
              ? `${plural(summary.totalDmsReviewed, 'message')} reviewed. ${plural(attentionCount, 'conversation')} ${pluralWord(attentionCount, 'needs', 'need')} your reply.`
              : t.subtitleFallback}
          </p>
        </div>
        <a
          href={getInstagramAuthUrl()}
          onClick={handleConnect}
          className="btn btn-primary"
          id="connect-instagram-dashboard-btn"
          aria-disabled={isRedirecting}
          style={isRedirecting ? { opacity: 0.6 } : undefined}
        >
          <Icon name="instagram" size={16} className={isRedirecting ? styles.spinning : undefined} />
          {accounts.length > 0 ? t.addAccount : t.connectInstagram}
        </a>
      </div>

      {/* Mounted only with billing on, so pre-launch the dashboard never
          calls the billing summary at all. */}
      {user?.features?.billing && <TrialPrompt onConnect={handleConnect} />}

      {loadError && (
        <div className={styles.alertBanner} role="alert">
          <div className={styles.alertIcon}><Icon name="alertTriangle" size={18} /></div>
          <div className={styles.alertContent}>
            <span>{loadError}</span>
          </div>
        </div>
      )}

      {summary?.connectionProblems?.length > 0 && (
        <div className={styles.alertBanner} role="alert">
          <div className={styles.alertIcon}><Icon name="alertTriangle" size={18} /></div>
          <div className={styles.alertContent}>
            <strong>{t.connectionAlert.title}</strong>
            <span>
              {summary.connectionProblems.map((a) => `@${a.igUsername || 'account'}`).join(', ')} — {t.connectionAlert.body}
            </span>
          </div>
        </div>
      )}

      {summary && (
        <div className={styles.metricsGrid}>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=important')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconAttention}`}>
              <Icon name="alertTriangle" size={18} />
            </div>
            <div className={styles.metricValue}>{formatCount(attentionCount)}</div>
            <div className={styles.metricLabel}>{t.metrics.needsReply.label}</div>
            <div className={styles.metricHint}>{t.metrics.needsReply.hint}</div>
          </button>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=hot_leads')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconDeals}`}>
              <Icon name="flame" size={18} />
            </div>
            <div className={styles.metricValue}>{formatCount(breakdown.hotLeads)}</div>
            <div className={styles.metricLabel}>{t.metrics.hotLeads.label}</div>
            <div className={styles.metricHint}>{t.metrics.hotLeads.hint}</div>
          </button>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=brand_deal')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconCollabs}`}>
              <Icon name="handshake" size={18} />
            </div>
            <div className={styles.metricValue}>{formatCount(brandDealCount)}</div>
            <div className={styles.metricLabel}>{t.metrics.brandDeals.label}</div>
            <div className={styles.metricHint}>{t.metrics.brandDeals.hint}</div>
          </button>
          <button className={styles.metricCard} onClick={() => router.push('/inbox?filter=unread')}>
            <div className={`${styles.metricIconWrap} ${styles.metricIconUnread}`}>
              <Icon name="messageSquare" size={18} />
            </div>
            <div className={styles.metricValue}>{formatCount(summary.unreadCount)}</div>
            <div className={styles.metricLabel}>{t.metrics.unread.label}</div>
            <div className={styles.metricHint}>{t.metrics.unread.hint}</div>
          </button>
        </div>
      )}

      {away && (
        <div className={styles.awayCard}>
          <div className={styles.awayHeader}>
            <h2 className={styles.cardTitle}>{t.away.title}</h2>
            <span className={styles.awaySubtext}>{plural(away.newMessages, 'new message')}</span>
          </div>
          <div className={styles.awayGrid}>
            {Object.entries(away.categoryCounts || {}).map(([category, count]) => (
              <button key={category} className={styles.awayChip} onClick={() => router.push(`/inbox?filter=${category}`)}>
                <span className={styles.awayChipCount}>{formatCount(count)}</span>
                <span className={styles.awayChipLabel}>{categoryLabel(category).label}</span>
              </button>
            ))}
          </div>
          {away.needsAttention > 0 && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => router.push('/inbox?filter=important')}
              style={{ marginTop: '16px' }}
            >
              {t.away.reviewAction}
              <Icon name="arrowRight" size={14} />
            </button>
          )}
        </div>
      )}

      <div className={styles.sectionHeader}>
        <h2 className={styles.cardTitle}>{t.accounts.title}</h2>
        <span className={styles.sectionCount}>{plural(accounts.length, 'account')}</span>
      </div>

      {accounts.length > 0 ? (
        <div className={styles.accountsList}>
          {accounts.map((account) => {
            const isDisconnected = account.connectionStatus === 'DISCONNECTED';
            const needsReconnect = account.tokenStatus === 'NEEDS_RECONNECT' || isDisconnected;
            const status = isDisconnected
              ? connectionStatusLabel(account.connectionStatus)
              : tokenStatusLabel(account.tokenStatus);
            return (
              <div key={account.id} className={styles.accountRow}>
                <div className={styles.accountLeft}>
                  {account.igProfilePic ? (
                    <img
                      src={account.igProfilePic}
                      alt={`Profile picture for @${account.igUsername || 'account'}`}
                      className={styles.accountAvatar}
                    />
                  ) : (
                    <div className={`avatar avatar-lg ${styles.accountAvatarFallback}`}>
                      {(account.igUsername || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <div className={styles.accountInfo}>
                    <div className={styles.accountUsername}>@{account.igUsername || 'account'}</div>
                    {account.igName && <div className={styles.accountName}>{account.igName}</div>}
                  </div>
                </div>
                <div className={styles.accountMeta}>
                  <span className={`badge ${status.tone === 'positive' ? 'badge-success' : 'badge-warning'}`}>
                    {status.label}
                  </span>
                  {account.tokenExpiresAt && (
                    <span className={styles.accountMetaItem}>
                      {t.accounts.tokenExpires} {formatDate(account.tokenExpiresAt)}
                    </span>
                  )}
                  {account._count?.conversations !== undefined && (
                    <span className={styles.accountMetaItem}>
                      {plural(account._count.conversations, 'conversation')}
                    </span>
                  )}
                </div>
                <div className={styles.accountActions}>
                  {needsReconnect ? (
                    <a
                      href={getInstagramAuthUrl()}
                      onClick={handleConnect}
                      className="btn btn-primary btn-sm"
                      aria-disabled={isRedirecting}
                      style={isRedirecting ? { opacity: 0.6 } : undefined}
                    >
                      {t.accounts.reconnect}
                    </a>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => router.push(`/inbox?accountId=${account.id}`)}>
                      {t.accounts.openInbox}
                    </button>
                  )}
                  {!isDisconnected && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleDisconnect(account.id)}>
                      {t.accounts.disconnect}
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
            <Icon name="instagram" size={40} strokeWidth={1.5} />
          </div>
          <h3 className={styles.emptyTitle}>{empty.accounts.title}</h3>
          <p className={styles.emptyDesc}>{empty.accounts.body}</p>
          <a
            href={getInstagramAuthUrl()}
            onClick={handleConnect}
            className="btn btn-primary"
            aria-disabled={isRedirecting}
            style={{ marginTop: '12px', ...(isRedirecting ? { opacity: 0.6 } : null) }}
          >
            {empty.accounts.action}
          </a>
        </div>
      )}

      <div className={styles.analyticsSection}>
        <div className={styles.analyticsHeaderRow}>
          <h2 className={styles.analyticsTitle}>{t.analytics.title}</h2>
          <div className={styles.analyticsControls}>
            <div className={styles.timeRangeSelectWrap}>
              <span className={styles.calendarIcon}><Icon name="calendar" size={14} /></span>
              <select
                className={styles.timeRangeSelect}
                value={analyticsTimeRange}
                onChange={handleTimeRangeChange}
                aria-label={t.analytics.rangeLabel}
              >
                <option value="24h">{t.analytics.ranges['24h']}</option>
                <option value="7d">{t.analytics.ranges['7d']}</option>
                <option value="30d">{t.analytics.ranges['30d']}</option>
              </select>
              <span className={styles.chevronIcon}><Icon name="chevronDown" size={12} /></span>
            </div>

            <button
              type="button"
              className={`${styles.analyticsIconBtn} ${refreshingAnalytics ? styles.spinning : ''}`}
              onClick={handleRefreshAnalytics}
              title={t.analytics.refresh}
              aria-label={t.analytics.refresh}
            >
              <Icon name="refresh" size={14} />
            </button>
          </div>
        </div>

        {analyticsError && (
          <div className={styles.alertBanner} role="alert">
            <div className={styles.alertIcon}><Icon name="alertTriangle" size={18} /></div>
            <div className={styles.alertContent}>
              <span>{analyticsError}</span>
            </div>
          </div>
        )}

        {/* States the reply mode plainly, so no card on this page can imply
            replies are being sent when the account is set to manual. */}
        {replyMode && (
          <div className={styles.replyModeBanner}>
            <span className={styles.replyModeLeft}>
              <Icon name={sendsAutomatically ? 'zap' : 'user'} size={14} />
              <strong>{t.analytics.replyModeBanner.title}:</strong> {replyModeMeta.label}
              <span className={styles.replyModeHint}>{replyModeMeta.description}</span>
            </span>
            <button className="btn btn-secondary btn-sm" onClick={() => router.push('/settings?tab=replies')}>
              {t.analytics.replyModeBanner.manageAction}
            </button>
          </div>
        )}

        <div className={styles.analyticsGridTop}>
          <div className={styles.analyticsCard}>
            <div>
              <div className={styles.cardHeaderRow}>
                <span className={styles.cardLabel}>{t.analytics.totalMessages.label}</span>
              </div>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricBigValue}>{analyticsData?.totalDms?.formatted || '0'}</span>
                <DeltaBadge changePercent={analyticsData?.totalDms?.changePercent} />
              </div>
              <span className={styles.cardHint}>{t.analytics.totalMessages.hint}</span>
            </div>
            <SparklineChart
              series={analyticsData?.totalDms?.series}
              labels={analyticsData?.totalDms?.labels}
              unit={t.analytics.totalMessages.unit}
              strokeColor="#4169e1"
              fillId="sparkline-dms-grad"
            />
          </div>

          <div className={styles.analyticsCard}>
            <div>
              <div className={styles.cardHeaderRow}>
                <span className={styles.cardLabel}>{t.analytics.hotLeads.label}</span>
              </div>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricBigValue}>{analyticsData?.hotLeads?.formatted || '0'}</span>
                <DeltaBadge changePercent={analyticsData?.hotLeads?.changePercent} />
              </div>
              <span className={styles.cardHint}>{t.analytics.hotLeads.hint}</span>
            </div>
            <SparklineChart
              series={analyticsData?.hotLeads?.series}
              labels={analyticsData?.hotLeads?.labels}
              unit={t.analytics.hotLeads.unit}
              strokeColor="#f59e0b"
              fillId="sparkline-hotleads-grad"
            />
          </div>
        </div>

        <div className={styles.analyticsGridBottom}>
          <CompactMetric
            label={t.analytics.needsReply.label}
            value={analyticsData?.needsAttention?.formatted}
            hint={t.analytics.needsReply.hint}
          />
          <CompactMetric
            label={t.analytics.brandDeals.label}
            value={analyticsData?.brandDeals?.formatted}
            hint={t.analytics.brandDeals.hint}
          />
          <CompactMetric
            label={t.analytics.autoReplies.label}
            value={analyticsData?.autoRepliesSent?.formatted}
            hint={sendsAutomatically ? t.analytics.autoReplies.hintOn : t.analytics.autoReplies.hintOff}
          />
          <CompactMetric
            label={t.analytics.spamBlocked.label}
            value={analyticsData?.spamBlocked?.formatted}
            hint={t.analytics.spamBlocked.hint}
          />
        </div>

        <div className={styles.categoryIntelligenceCard}>
          <div className={styles.categoryHeader}>
            <div>
              <h3 className={styles.categoryTitle}>{t.analytics.breakdown.title}</h3>
              <p className={styles.categorySubtitle}>{t.analytics.breakdown.subtitle}</p>
            </div>
          </div>

          <div className={styles.categoryGrid}>
            {(analyticsData?.categoryMetrics || []).map((m) => (
              <div key={m.key || m.label} className={styles.categoryChip}>
                <div className={styles.categoryChipTop}>
                  <span className={styles.categoryChipIcon}><Icon name={m.icon} size={16} /></span>
                  <span className={styles.categoryChipValue}>{formatCount(m.value)}</span>
                </div>
                <span className={styles.categoryChipLabel}>{m.label}</span>
                <span className={styles.categoryChipDesc}>{m.hint}</span>
              </div>
            ))}
          </div>

          {analyticsData?.intentDistribution && (
            <DistributionBar
              items={analyticsData.intentDistribution}
              total={analyticsData.distributionTotal || 0}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

/**
 * The no-entitlement prompt, for someone who reaches the dashboard before
 * connecting an account. Status NONE only: once a trial or a plan exists the
 * billing page is where that state lives, and repeating it above the metrics
 * would just push the inbox numbers down.
 *
 * Uses the dashboard's own handleConnect, so the unverified-email check still
 * runs before anyone is sent through Instagram's consent screen.
 */
function TrialPrompt({ onConnect }) {
  const { summary } = useBillingSummary();
  if (summary?.status !== 'NONE') return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <TrialStateCard summary={summary} connectHref={getInstagramAuthUrl()} onConnect={onConnect} />
    </div>
  );
}

function CompactMetric({ label, value, hint }) {
  return (
    <div className={`${styles.analyticsCard} ${styles.analyticsCardCompact}`}>
      <div>
        <div className={styles.cardHeaderRow}>
          <span className={styles.cardLabel}>{label}</span>
        </div>
        <div className={styles.metricNumberRow}>
          <span className={styles.metricBigValue}>{value || '0'}</span>
        </div>
      </div>
      <span className={styles.cardHint}>{hint}</span>
    </div>
  );
}

/**
 * Shares are only shown once there is a sample large enough for them to mean
 * something. Below the threshold the counts still render — they are honest —
 * but the percentages are replaced with a line saying why.
 */
function DistributionBar({ items, total }) {
  const showPercentages = total >= MIN_PERCENT_SAMPLE;

  if (total === 0) {
    return (
      <div className={styles.distributionSection}>
        <span className={styles.distributionTitle}>{t.analytics.breakdown.distributionTitle}</span>
        <p className={styles.noDataPlaceholder}>{t.analytics.noData}</p>
      </div>
    );
  }

  return (
    <div className={styles.distributionSection}>
      <div className={styles.distributionHeader}>
        <span className={styles.distributionTitle}>{t.analytics.breakdown.distributionTitle}</span>
        <span className={styles.distributionTotal}>{plural(total, 'conversation')}</span>
      </div>

      <div className={styles.distributionBar}>
        {items.map((item) => (
          <div
            key={item.key}
            className={styles.distributionSegment}
            style={{ width: `${item.pct}%`, backgroundColor: item.color }}
            title={`${item.label}: ${plural(item.count, 'conversation')}`}
          />
        ))}
      </div>

      <div className={styles.distributionLegend}>
        {items.map((item) => (
          <div key={item.key} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
            <span className={styles.legendCount}>{formatCount(item.count)}</span>
            {showPercentages && <span className={styles.legendPct}>{item.pct}%</span>}
          </div>
        ))}
      </div>

      {!showPercentages && (
        <p className={styles.distributionNote}>{t.analytics.breakdown.sampleTooSmall}</p>
      )}
    </div>
  );
}

function DeltaBadge({ changePercent }) {
  // Null means the previous period had nothing to compare against.
  if (changePercent === null || changePercent === undefined || changePercent === 0) {
    return null;
  }
  if (changePercent > 0) {
    return <span className={styles.deltaPositive}>+{changePercent}%</span>;
  }
  return <span className={styles.deltaNegative}>{changePercent}%</span>;
}

function SparklineChart({ series = [], labels = [], unit = 'messages', strokeColor = '#4169e1', fillId = 'sparkline-grad' }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  if (!series || series.length === 0 || series.every((v) => v === 0)) {
    return <div className={styles.noDataPlaceholder}>{t.analytics.noData}</div>;
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

  const pathD = points.reduce((acc, pt, idx) => (
    idx === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`
  ), '');

  const lastPoint = points[points.length - 1] || { x: chartWidth, y: chartHeight };
  const firstPoint = points[0] || { x: 0, y: chartHeight };
  const areaD = `${pathD} L ${lastPoint.x.toFixed(1)} ${chartHeight} L ${firstPoint.x.toFixed(1)} ${chartHeight} Z`;

  const topTick = maxVal >= 1000 ? `${(maxVal / 1000).toFixed(1)}k` : maxVal;
  const midTick = Math.round(maxVal / 2) >= 1000 ? `${(Math.round(maxVal / 2) / 1000).toFixed(1)}k` : Math.round(maxVal / 2);

  function handlePointerMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const chartPixelWidth = (chartWidth / 380) * rect.width;
    const ratio = Math.min(Math.max(mouseX / chartPixelWidth, 0), 1);
    const idx = Math.min(Math.max(Math.round(ratio * (series.length - 1)), 0), series.length - 1);

    setHoveredIdx(idx);
    setTooltipPos({ x: (points[idx].x / 380) * rect.width, y: (points[idx].y / 95) * rect.height });
  }

  function handlePointerLeave() {
    setHoveredIdx(null);
  }

  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : null;
  const activeLabel = hoveredIdx !== null && labels && labels[hoveredIdx] ? labels[hoveredIdx] : '';

  return (
    <div
      className={styles.sparklineContainer}
      onMouseMove={handlePointerMove}
      onMouseLeave={handlePointerLeave}
      onTouchMove={(e) => {
        if (e.touches && e.touches[0]) handlePointerMove(e.touches[0]);
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
            {formatCount(activePoint.val)} {unit}
          </span>
          {activeLabel && <span className={styles.sparklineTooltipLabel}>{activeLabel}</span>}
        </div>
      )}

      <svg className={styles.sparklineSvg} viewBox="0 0 380 95" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        <line x1="0" y1={topPadding} x2={chartWidth} y2={topPadding} stroke="var(--border-subtle)" strokeDasharray="3 3" strokeWidth="1" />
        <line x1="0" y1={topPadding + usableHeight / 2} x2={chartWidth} y2={topPadding + usableHeight / 2} stroke="var(--border-subtle)" strokeDasharray="3 3" strokeWidth="1" />
        <line x1="0" y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="var(--border-subtle)" strokeWidth="1" />

        <text x="332" y={topPadding + 4} fill="var(--text-tertiary)" fontSize="10" fontFamily="var(--font-sans)">{topTick}</text>
        <text x="332" y={topPadding + usableHeight / 2 + 3} fill="var(--text-tertiary)" fontSize="10" fontFamily="var(--font-sans)">{midTick}</text>
        <text x="332" y={chartHeight + 1} fill="var(--text-tertiary)" fontSize="10" fontFamily="var(--font-sans)">0</text>

        <path d={areaD} fill={`url(#${fillId})`} />
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />

        {activePoint && (
          <g>
            <line x1={activePoint.x} y1={topPadding} x2={activePoint.x} y2={chartHeight} stroke="#64748b" strokeDasharray="2 2" strokeWidth="1.2" />
            <circle cx={activePoint.x} cy={activePoint.y} r="4.5" fill="#ffffff" stroke={strokeColor} strokeWidth="2.5" />
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
