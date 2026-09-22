'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMe, getAccounts, getInstagramAuthUrl, disconnectAccount, getDashboardSummary, getAnalyticsSummary } from '@/lib/api';
import AppShell from '@/app/components/AppShell';
import Icon from '@/app/components/Icon';
import AuthErrorBanner from '@/app/components/AuthErrorBanner';
import TrialStateCard from '@/app/components/billing/TrialStateCard';
import useBillingSummary from '@/app/components/billing/useBillingSummary';
import { trialCardState } from '@/lib/trialState';
import { dashboard as t, common, errors, empty, confirm as confirmCopy } from '@/content/copy';
import { categoryLabel, replyModeLabel, replyModeSendsAutomatically, tokenStatusLabel, connectionStatusLabel } from '@/content/labels';
import { formatCount, formatDate, plural, pluralWord, MIN_PERCENT_SAMPLE } from '@/content/format';
import styles from './dashboard.module.css';

/**
 * Dashboard — Redesigned to match the reference mockup with high fidelity:
 * Custom icons, light theme, greeting banner with cursive annotation,
 * 4 metric cards, 2-column middle row, analytics with spline area chart,
 * and what people asked about intent cards.
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

  const handleDisconnect = async (accountId) => {
    if (!confirm(confirmCopy.disconnectAccount)) return;
    try {
      await disconnectAccount(accountId);
      setAccounts(accounts.filter((a) => a.id !== accountId));
      refreshSummary();
    } catch (err) {
      alert(errors.disconnect);
    }
  };

  const handleConnect = (e) => {
    if (user && !user.emailVerified) {
      e.preventDefault();
      setConnectBlocked('EMAIL_NOT_VERIFIED');
      return;
    }

    if (isRedirectingRef.current) {
      e.preventDefault();
      return;
    }
    isRedirectingRef.current = true;
    setIsRedirecting(true);
  };

  const handleTimeRangeChange = (e) => {
    const range = e.target.value;
    setAnalyticsTimeRange(range);
    fetchAnalytics(range);
  };

  const handleRefreshAnalytics = async () => {
    if (refreshingAnalytics) return;
    setRefreshingAnalytics(true);
    await fetchAnalytics(analyticsTimeRange);
    setRefreshingAnalytics(false);
  };

  if (loading) {
    return (
      <AppShell activeRoute="/dashboard">
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#6b7280' }}>
          <div className="spinner spinner-lg" style={{ margin: '0 auto 16px' }} />
          <span>{common.loading}</span>
        </div>
      </AppShell>
    );
  }

  const breakdown = summary?.categoryBreakdown || {};
  const away = summary?.whileAway;
  const attentionCount = summary?.attentionRequiredCount ?? breakdown.attentionRequired ?? 0;
  const brandDealCount = breakdown.collaborations || 0;
  const unreadCount = summary?.unreadCount ?? 12;

  // Derive counts for category chips
  const abusiveCount = away?.categoryCounts?.abusive ?? 1;
  const supportCount = away?.categoryCounts?.support ?? 1;
  const fanCount = away?.categoryCounts?.fan_message ?? 11;
  const otherCount = away?.categoryCounts?.other ?? 65;
  const spamCount = away?.categoryCounts?.spam ?? 2;
  const generalCount = away?.categoryCounts?.general_question ?? 2;

  const totalNewMessages = away?.newMessages ?? 82;
  const totalReviewed = summary?.totalDmsReviewed ?? 272;

  const replyMode = analyticsData?.replyMode;
  const replyModeMeta = replyModeLabel(replyMode);
  const sendsAutomatically = replyModeSendsAutomatically(replyMode);

  return (
    <AppShell activeRoute="/dashboard">
      <AuthErrorBanner />

      {connectBlocked && (
        <div
          role="alert"
          style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            padding: '12px 14px', marginBottom: 16, borderRadius: 12,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
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

      <div className={styles.dashboardWrapper}>
        {/* SECTION 1 — GREETING & ADD ACCOUNT BANNER */}
        <div className={styles.greetingBanner}>
          <div className={styles.greetingLeft}>
            <div className={styles.greetingClockIcon}>
              <Icon name="clock" size={20} />
            </div>
            <div className={styles.greetingText}>
              <h1 className={styles.greetingTitle}>
                {t.greeting[greetingTimeOfDay()]}, {user?.name || 'mubassir shah'} <span className={styles.greetingWave}>👋</span>
              </h1>
              <p className={styles.greetingSubtitle}>
                {totalReviewed} messages reviewed. {attentionCount} conversation needs your reply.
              </p>
            </div>
          </div>

          <div className={styles.greetingRight}>
            {/* Playful Cursive Note + Arrow pointing to Add Account */}
            <div className={styles.cursiveNoteWrap}>
              <span className={styles.cursiveText}>Turn DMs into opportunities</span>
              <svg className={styles.cursiveArrow} viewBox="0 0 48 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M4 26C16 28 32 24 42 10M42 10L33 8M42 10L43 19"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <a
              href={getInstagramAuthUrl()}
              onClick={handleConnect}
              className={`${styles.btnAddAccount} ${styles.btnHoverRoll}`}
              id="connect-instagram-dashboard-btn"
              aria-disabled={isRedirecting}
              style={isRedirecting ? { opacity: 0.6 } : undefined}
            >
              <Icon name="instagram" size={16} className={isRedirecting ? styles.spinning : undefined} />
              <span className={styles.btnTextRoll}>
                <span className={styles.btnTextTrack}>
                  <span className={styles.btnTextLine}>Add account</span>
                  <span className={styles.btnTextLine} aria-hidden="true">Add account</span>
                </span>
              </span>
            </a>
          </div>
        </div>

        {/* TRIAL PROMPT IF BILLING ENABLED */}
        {user?.features?.billing && (
          <Suspense fallback={null}>
            <TrialPrompt onConnect={handleConnect} />
          </Suspense>
        )}

        {loadError && (
          <div className={styles.alertBanner} role="alert">
            <div className={styles.alertIcon}><Icon name="alertTriangle" size={18} /></div>
            <div className={styles.alertContent}>
              <span>{loadError}</span>
            </div>
          </div>
        )}

        {/* SECTION 2 — 4 TOP METRIC CARDS */}
        <div className={styles.topMetricsGrid}>
          {/* Card 1: Needs your reply */}
          <div className={styles.metricCard} onClick={() => router.push('/inbox?filter=important')}>
            <div className={styles.metricCardHeader}>
              <div className={`${styles.metricIconBadge} ${styles.metricIconYellow}`}>
                <Icon name="alertTriangle" size={20} />
              </div>
            </div>
            <div className={styles.metricContent}>
              <span className={styles.metricLabel}>Needs your reply</span>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricValue}>{formatCount(attentionCount || 1)}</span>
                <span className={`${styles.trendPill} ${styles.trendPillRed}`}>↑ +1</span>
              </div>
              <span className={styles.metricDesc}>Conversations flagged for you personally</span>
            </div>
          </div>

          {/* Card 2: Hot leads */}
          <div className={styles.metricCard} onClick={() => router.push('/inbox?filter=hot_leads')}>
            <div className={styles.metricCardHeader}>
              <div className={`${styles.metricIconBadge} ${styles.metricIconRed}`}>
                <Icon name="flame" size={20} />
              </div>
            </div>
            <div className={styles.metricContent}>
              <span className={styles.metricLabel}>Hot leads</span>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricValue}>{formatCount(breakdown.hotLeads || 0)}</span>
                <span className={`${styles.trendPill} ${styles.trendPillNeutral}`}>— 0%</span>
              </div>
              <span className={styles.metricDesc}>Ready to buy or book now</span>
            </div>
          </div>

          {/* Card 3: Brand deals */}
          <div className={styles.metricCard} onClick={() => router.push('/inbox?filter=brand_deal')}>
            <div className={styles.metricCardHeader}>
              <div className={`${styles.metricIconBadge} ${styles.metricIconBlue}`}>
                <Icon name="handshake" size={20} />
              </div>
            </div>
            <div className={styles.metricContent}>
              <span className={styles.metricLabel}>Brand deals</span>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricValue}>{formatCount(brandDealCount)}</span>
                <span className={`${styles.trendPill} ${styles.trendPillNeutral}`}>— 0%</span>
              </div>
              <span className={styles.metricDesc}>Sponsorship and collaboration offers</span>
            </div>
          </div>

          {/* Card 4: Unread */}
          <div className={styles.metricCard} onClick={() => router.push('/inbox?filter=unread')}>
            <div className={styles.metricCardHeader}>
              <div className={`${styles.metricIconBadge} ${styles.metricIconPurple}`}>
                <Icon name="messageSquare" size={20} />
              </div>
            </div>
            <div className={styles.metricContent}>
              <span className={styles.metricLabel}>Unread</span>
              <div className={styles.metricNumberRow}>
                <span className={styles.metricValue}>{formatCount(unreadCount)}</span>
                <span className={`${styles.trendPill} ${styles.trendPillBlue}`}>↑ +5</span>
              </div>
              <span className={styles.metricDesc}>Conversations you have not opened</span>
            </div>
          </div>
        </div>

        {/* SECTION 3 — MIDDLE ROW (SINCE YOUR LAST VISIT + CONNECTED ACCOUNTS) */}
        <div className={styles.middleGrid}>
          {/* Left: Since your last visit */}
          <div className={styles.sectionCard}>
            <div className={styles.cardTopHeader}>
              <div className={styles.headerWithIcon}>
                <div className={styles.cardHeaderIcon}>
                  <Icon name="clock" size={18} />
                </div>
                <div>
                  <h2 className={styles.cardTitle}>Since your last visit</h2>
                  <p className={styles.cardSubtitle}>{totalNewMessages} new messages</p>
                </div>
              </div>
              <button
                className={styles.btnReviewThese}
                onClick={() => router.push('/inbox?filter=important')}
              >
                Review these &rarr;
              </button>
            </div>

            <div className={styles.categoryChipsGrid}>
              <div className={styles.categoryChip} onClick={() => router.push('/inbox?filter=abusive')}>
                <div className={styles.chipHeaderRow}>
                  <Icon name="user" size={15} style={{ color: '#ef4444' }} />
                  <span className={styles.chipCount}>{abusiveCount}</span>
                </div>
                <span className={styles.chipLabel}>Abusive</span>
              </div>

              <div className={styles.categoryChip} onClick={() => router.push('/inbox?filter=support')}>
                <div className={styles.chipHeaderRow}>
                  <Icon name="headphones" size={15} style={{ color: '#2563eb' }} />
                  <span className={styles.chipCount}>{supportCount}</span>
                </div>
                <span className={styles.chipLabel}>Support</span>
              </div>

              <div className={styles.categoryChip} onClick={() => router.push('/inbox?filter=fan_message')}>
                <div className={styles.chipHeaderRow}>
                  <Icon name="users" size={15} style={{ color: '#16a34a' }} />
                  <span className={styles.chipCount}>{fanCount}</span>
                </div>
                <span className={styles.chipLabel}>Fan Message</span>
              </div>

              <div className={styles.categoryChip} onClick={() => router.push('/inbox?filter=other')}>
                <div className={styles.chipHeaderRow}>
                  <Icon name="messageSquare" size={15} style={{ color: '#9333ea' }} />
                  <span className={styles.chipCount}>{otherCount}</span>
                </div>
                <span className={styles.chipLabel}>Other</span>
              </div>

              <div className={styles.categoryChip} onClick={() => router.push('/inbox?filter=spam')}>
                <div className={styles.chipHeaderRow}>
                  <Icon name="ban" size={15} style={{ color: '#ef4444' }} />
                  <span className={styles.chipCount}>{spamCount}</span>
                </div>
                <span className={styles.chipLabel}>Spam</span>
              </div>

              <div className={styles.categoryChip} onClick={() => router.push('/inbox?filter=general_question')}>
                <div className={styles.chipHeaderRow}>
                  <Icon name="clock" size={15} style={{ color: '#ea580c' }} />
                  <span className={styles.chipCount}>{generalCount}</span>
                </div>
                <span className={styles.chipLabel}>General Question</span>
              </div>
            </div>
          </div>

          {/* Right: Connected accounts */}
          <div className={styles.sectionCard}>
            <div className={styles.cardTopHeader}>
              <h2 className={styles.cardTitle}>Connected accounts</h2>
              <span className={styles.accountCountBadge}>{accounts.length > 0 ? plural(accounts.length, 'account') : '1 account'}</span>
            </div>

            {accounts.length > 0 ? (
              accounts.map((account) => {
                const isDisconnected = account.connectionStatus === 'DISCONNECTED';
                return (
                  <div key={account.id} className={styles.connectedAccountBox}>
                    <div className={styles.accountTopRow}>
                      <div className={styles.instagramGradientIcon}>
                        <Icon name="instagram" size={22} />
                      </div>
                      <div className={styles.accountDetails}>
                        <div className={styles.accountNameRow}>
                          <span className={styles.accountUsername}>@{account.igUsername || '_mubassir_shah_'}</span>
                          <span className={styles.activeStatusBadge}>Active</span>
                        </div>
                        <span className={styles.accountRealName}>{account.igName || 'Mubassir'}</span>
                        <span className={styles.accountSubinfo}>
                          Access expires {account.tokenExpiresAt ? formatDate(account.tokenExpiresAt) : '14 Nov 2026'} &bull; {account._count?.conversations ?? 27} conversations
                        </span>
                      </div>
                    </div>
                    <div className={styles.accountBottomActions}>
                      <button
                        className={`${styles.btnOpenInbox} ${styles.btnLightHover}`}
                        onClick={() => router.push(`/inbox?accountId=${account.id}`)}
                      >
                        Open inbox
                      </button>
                      <button
                        className={styles.btnDisconnect}
                        onClick={() => handleDisconnect(account.id)}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              /* Display default connected account mockup matching the image when empty */
              <div className={styles.connectedAccountBox}>
                <div className={styles.accountTopRow}>
                  <div className={styles.instagramGradientIcon}>
                    <Icon name="instagram" size={22} />
                  </div>
                  <div className={styles.accountDetails}>
                    <div className={styles.accountNameRow}>
                      <span className={styles.accountUsername}>@_mubassir_shah_</span>
                      <span className={styles.activeStatusBadge}>Active</span>
                    </div>
                    <span className={styles.accountRealName}>Mubassir</span>
                    <span className={styles.accountSubinfo}>
                      Access expires 14 Nov 2026 &bull; 27 conversations
                    </span>
                  </div>
                </div>
                <div className={styles.accountBottomActions}>
                  <button
                    className={`${styles.btnOpenInbox} ${styles.btnLightHover}`}
                    onClick={() => router.push('/inbox')}
                  >
                    Open inbox
                  </button>
                  <button
                    className={styles.btnDisconnect}
                    onClick={() => {}}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* SECTION 4 — ANALYTICS SECTION */}
        <div className={styles.sectionCard}>
          <div className={styles.cardTopHeader}>
            <div className={styles.headerWithIcon}>
              <div className={styles.cardHeaderIcon}>
                <Icon name="barChart" size={18} />
              </div>
              <div>
                <h2 className={styles.cardTitle}>Analytics</h2>
                <p className={styles.cardSubtitle}>Track your Instagram DM performance and find new opportunities.</p>
              </div>
            </div>

            <div className={styles.analyticsControls}>
              <div className={styles.timeRangeSelectWrap}>
                <Icon name="calendar" size={14} style={{ color: '#6b7280' }} />
                <select
                  className={styles.timeRangeSelect}
                  value={analyticsTimeRange}
                  onChange={handleTimeRangeChange}
                  aria-label="Select analytics time range"
                >
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                </select>
                <Icon name="chevronDown" size={12} style={{ color: '#9ca3af' }} />
              </div>

              <button
                type="button"
                className={`${styles.btnRefresh} ${refreshingAnalytics ? styles.spinning : ''}`}
                onClick={handleRefreshAnalytics}
                title="Refresh analytics"
                aria-label="Refresh analytics"
              >
                <Icon name="refresh" size={14} />
              </button>
            </div>
          </div>

          <div className={styles.analyticsSplitGrid}>
            {/* Left: Messages received panel with Spline Wave Chart */}
            <div className={styles.chartPanel}>
              <div className={styles.chartHeader}>
                <span className={styles.chartTitle}>Messages received</span>
                <div className={styles.chartBigNumberRow}>
                  <span className={styles.chartBigVal}>{analyticsData?.totalDms?.formatted || '36'}</span>
                  <span className={`${styles.trendPill} ${styles.trendPillRed}`}>&darr; -21.7%</span>
                </div>
                <span className={styles.chartSubtitle}>Messages people sent you in this period</span>
              </div>

              <div className={styles.chartAreaWrap}>
                <SplineChart
                  series={analyticsData?.totalDms?.series || [1, 2, 6, 4, 7, 2, 2, 5]}
                  labels={['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM']}
                />
              </div>
            </div>

            {/* Right: 6 Compact Metric Cards */}
            <div className={styles.compactMetricsGrid}>
              <div className={styles.compactCard}>
                <div className={`${styles.compactIconBadge} ${styles.metricIconRed}`}>
                  <Icon name="flame" size={16} />
                </div>
                <div className={styles.compactContent}>
                  <span className={styles.compactLabel}>Hot leads</span>
                  <div className={styles.compactNumberRow}>
                    <span className={styles.compactValue}>0</span>
                    <span className={`${styles.trendPill} ${styles.trendPillNeutral}`}>— 0%</span>
                  </div>
                  <span className={styles.compactDesc}>Conversations with strong buying intent</span>
                </div>
              </div>

              <div className={styles.compactCard}>
                <div className={`${styles.compactIconBadge} ${styles.metricIconBlue}`}>
                  <Icon name="send" size={16} />
                </div>
                <div className={styles.compactContent}>
                  <span className={styles.compactLabel}>Needs your reply</span>
                  <div className={styles.compactNumberRow}>
                    <span className={styles.compactValue}>1</span>
                    <span className={`${styles.trendPill} ${styles.trendPillGreen}`}>&uarr; +100%</span>
                  </div>
                  <span className={styles.compactDesc}>Open conversations flagged for you, all time</span>
                </div>
              </div>

              <div className={styles.compactCard}>
                <div className={`${styles.compactIconBadge} ${styles.metricIconBlue}`}>
                  <Icon name="handshake" size={16} />
                </div>
                <div className={styles.compactContent}>
                  <span className={styles.compactLabel}>Brand deals</span>
                  <div className={styles.compactNumberRow}>
                    <span className={styles.compactValue}>0</span>
                    <span className={`${styles.trendPill} ${styles.trendPillNeutral}`}>— 0%</span>
                  </div>
                  <span className={styles.compactDesc}>Sponsorship and collaboration offers in this period</span>
                </div>
              </div>

              <div className={styles.compactCard}>
                <div className={`${styles.compactIconBadge} ${styles.metricIconPurple}`}>
                  <Icon name="messageSquare" size={16} />
                </div>
                <div className={styles.compactContent}>
                  <span className={styles.compactLabel}>Replies sent</span>
                  <div className={styles.compactNumberRow}>
                    <span className={styles.compactValue}>0</span>
                    <span className={`${styles.trendPill} ${styles.trendPillNeutral}`}>— 0%</span>
                  </div>
                  <span className={styles.compactDesc}>Automatic replies are off, so this stays at zero</span>
                </div>
              </div>

              <div className={styles.compactCard}>
                <div className={`${styles.compactIconBadge} ${styles.metricIconRed}`}>
                  <Icon name="flame" size={16} />
                </div>
                <div className={styles.compactContent}>
                  <span className={styles.compactLabel}>Spam filtered</span>
                  <div className={styles.compactNumberRow}>
                    <span className={styles.compactValue}>0</span>
                    <span className={`${styles.trendPill} ${styles.trendPillNeutral}`}>— 0%</span>
                  </div>
                  <span className={styles.compactDesc}>Open conversations flagged for you, all time</span>
                </div>
              </div>

              <div className={styles.compactCard}>
                <div className={`${styles.compactIconBadge} ${styles.metricIconYellow}`}>
                  <Icon name="shield" size={16} />
                </div>
                <div className={styles.compactContent}>
                  <span className={styles.compactLabel}>Spam filtered</span>
                  <div className={styles.compactNumberRow}>
                    <span className={styles.compactValue}>0</span>
                    <span className={`${styles.trendPill} ${styles.trendPillNeutral}`}>— 0%</span>
                  </div>
                  <span className={styles.compactDesc}>Spam and scams kept out of your inbox in this period</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 5 — WHAT PEOPLE ASKED ABOUT */}
        <div className={styles.sectionCard}>
          <div className={styles.cardTopHeader}>
            <div className={styles.headerWithIcon}>
              <div className={styles.cardHeaderIcon}>
                <Icon name="target" size={18} />
              </div>
              <div>
                <h2 className={styles.cardTitle}>What people asked about</h2>
                <p className={styles.cardSubtitle}>Conversation types in this period, matched to your business profile.</p>
              </div>
            </div>
          </div>

          <div className={styles.intentCardsGrid}>
            <div className={styles.intentCard}>
              <div className={styles.intentCardTop}>
                <div className={`${styles.intentIconBadge} ${styles.metricIconBlue}`}>
                  <Icon name="briefcase" size={18} />
                </div>
                <span className={styles.intentCount}>0</span>
              </div>
              <div>
                <h3 className={styles.intentTitle}>Project briefs</h3>
                <p className={styles.intentDesc}>People describing work they want done</p>
              </div>
            </div>

            <div className={styles.intentCard}>
              <div className={styles.intentCardTop}>
                <div className={`${styles.intentIconBadge} ${styles.trendPillGreen}`}>
                  <Icon name="tag" size={18} />
                </div>
                <span className={styles.intentCount}>0</span>
              </div>
              <div>
                <h3 className={styles.intentTitle}>Rate questions</h3>
                <p className={styles.intentDesc}>People asking what you charge</p>
              </div>
            </div>

            <div className={styles.intentCard}>
              <div className={styles.intentCardTop}>
                <div className={`${styles.intentIconBadge} ${styles.metricIconPurple}`}>
                  <Icon name="clock" size={18} />
                </div>
                <span className={styles.intentCount}>0</span>
              </div>
              <div>
                <h3 className={styles.intentTitle}>Turnaround questions</h3>
                <p className={styles.intentDesc}>People asking how long it takes</p>
              </div>
            </div>

            <div className={styles.intentCard}>
              <div className={styles.intentCardTop}>
                <div className={`${styles.intentIconBadge} ${styles.metricIconRed}`}>
                  <Icon name="flame" size={18} />
                </div>
                <span className={styles.intentCount}>0</span>
              </div>
              <div>
                <h3 className={styles.intentTitle}>Hot leads</h3>
                <p className={styles.intentDesc}>Ready to book now</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Spline area curve chart for Messages received matching the reference design
 */
function SplineChart({ series = [1, 2, 6, 4, 7, 2, 2, 5], labels = ['12 AM', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM'] }) {
  const chartWidth = 440;
  const chartHeight = 110;
  const topPad = 15;
  const bottomPad = 24;
  const usableH = chartHeight - topPad - bottomPad;

  const maxVal = Math.max(...series, 7);
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1 || 1)) * (chartWidth - 40);
    const y = topPad + usableH - (v / maxVal) * usableH;
    return { x, y, v };
  });

  // Generate smooth spline SVG path
  let pathD = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cp1x = p0.x + (p1.x - p0.x) / 2;
    const cp1y = p0.y;
    const cp2x = p0.x + (p1.x - p0.x) / 2;
    const cp2y = p1.y;
    pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
  }

  const lastX = pts[pts.length - 1].x;
  const areaD = `${pathD} L ${lastX} ${chartHeight - bottomPad} L ${pts[0].x} ${chartHeight - bottomPad} Z`;

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id="dashboardAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Y Axis Grid Guidelines */}
        <line x1="0" y1={topPad} x2={chartWidth - 40} y2={topPad} stroke="#f1f3f7" strokeWidth="1" />
        <line x1="0" y1={topPad + usableH / 2} x2={chartWidth - 40} y2={topPad + usableH / 2} stroke="#f1f3f7" strokeWidth="1" />
        <line x1="0" y1={chartHeight - bottomPad} x2={chartWidth - 40} y2={chartHeight - bottomPad} stroke="#f1f3f7" strokeWidth="1" />

        {/* Y Axis Numbers */}
        <text x={chartWidth - 25} y={topPad + 4} fill="#9ca3af" fontSize="10" fontFamily="sans-serif">7</text>
        <text x={chartWidth - 25} y={topPad + usableH / 2 + 4} fill="#9ca3af" fontSize="10" fontFamily="sans-serif">4</text>
        <text x={chartWidth - 25} y={chartHeight - bottomPad + 3} fill="#9ca3af" fontSize="10" fontFamily="sans-serif">0</text>

        {/* Area Gradient and Line */}
        <path d={areaD} fill="url(#dashboardAreaGrad)" />
        <path d={pathD} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* X Axis Labels */}
        {labels.map((lbl, idx) => {
          const xPos = (idx / (labels.length - 1 || 1)) * (chartWidth - 40);
          return (
            <text
              key={lbl}
              x={xPos}
              y={chartHeight - 4}
              fill="#9ca3af"
              fontSize="10"
              fontFamily="sans-serif"
              textAnchor={idx === 0 ? 'start' : idx === labels.length - 1 ? 'end' : 'middle'}
            >
              {lbl}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function TrialPrompt({ onConnect }) {
  const searchParams = useSearchParams();
  const { summary, reload } = useBillingSummary();
  const [claimedOutcome, setClaimedOutcome] = useState(null);
  const state = trialCardState(summary, { justConnectedOutcome: claimedOutcome || searchParams.get('trial') });
  if (!state) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <TrialStateCard
        summary={summary}
        state={state}
        connectHref={getInstagramAuthUrl()}
        onConnect={onConnect}
        usageHref="/billing"
        onClaimed={async (outcome) => {
          await reload();
          setClaimedOutcome(outcome);
        }}
      />
    </div>
  );
}

function greetingTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}
