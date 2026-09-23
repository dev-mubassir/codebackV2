'use client';

/**
 * Dashboard — what is waiting for you now, what arrived since you last looked,
 * how the selected period went, and which accounts are connected.
 *
 * The DATA LAYER is master's: the same five endpoints, the same six socket
 * events, the same refresh-on-focus, the same connect-before-redirect guard for
 * an unverified email, the same trial card behind the billing flag.
 *
 * WHAT CHANGED, AND WHY — three of master's numbers were the same number twice.
 *
 *   1. "Needs your reply" appeared in the top cards AND as an analytics metric
 *      under the date-range selector. The two queries are byte-identical
 *      (dashboard.js:54-63 vs analytics.js:181-189), so it was one figure shown
 *      twice, and the copy under the selector never moved when the range
 *      changed. It now appears once, in "Right now".
 *   2. `categoryMetrics` and `intentDistribution` are the SAME counts from the
 *      same source, rendered as chips and again as a bar with shares. They are
 *      now one list: the chips carry the share.
 *   3. Those chips are NOT scoped to the selected range — analytics.js counts
 *      them across every current conversation — while everything else in that
 *      section is. Both bases are now stated.
 *
 * So the page says, once per section, what its numbers are counting: "Right
 * now" is the live queue, the analytics block carries the selected range on
 * every figure, and the breakdown says it is all-time.
 *
 * Connected accounts moved to the bottom. It is reference, not news.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { io } from 'socket.io-client';
import {
  getMe, getAccounts, getInstagramAuthUrl, disconnectAccount,
  getDashboardSummary, getAnalyticsSummary,
} from '@/lib/api';
import AppShell from '@/app/components/ui/AppShell';
import Icon from '@/app/components/Icon';
import AuthErrorBanner from '@/app/components/AuthErrorBanner';
import TrialStateCard from '@/app/components/billing/TrialStateCard';
import useBillingSummary from '@/app/components/billing/useBillingSummary';
import { trialCardState } from '@/lib/trialState';
import {
  Avatar, Badge, Button, Card, EmptyState, IconTile, Modal, Select, Skeleton,
} from '@/app/components/ui';
import { dashboard as t, common, errors, empty, confirm as confirmCopy } from '@/content/copy';
import {
  categoryLabel, replyModeLabel, replyModeSendsAutomatically,
  tokenStatusLabel, connectionStatusLabel,
} from '@/content/labels';
import { formatCount, formatDate, plural, pluralWord, MIN_PERCENT_SAMPLE } from '@/content/format';
import { BACKEND_URL } from '@/lib/backendUrl';
import { rememberDestination } from '@/lib/pendingDestination';
import styles from './dashboard.module.css';

/**
 * Tile tone per metric. Same rule as the inbox folders: the colour is a claim,
 * and `warning` is spent on the one card that is a task rather than a statistic.
 */
const METRIC_TONE = {
  needsReply: 'warning',
  hotLeads: 'accent',
  brandDeals: 'accent',
  unread: 'neutral',
};

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsError, setAnalyticsError] = useState('');
  const [timeRange, setTimeRange] = useState('24h');
  const [refreshing, setRefreshing] = useState(false);

  const [isRedirecting, setIsRedirecting] = useState(false);
  const isRedirectingRef = useRef(false);
  // Why the connect button refused, if it did. Shown in place rather than
  // after a round trip through Instagram's consent screen.
  const [connectBlocked, setConnectBlocked] = useState(null);
  const [disconnectTarget, setDisconnectTarget] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchAnalytics = useCallback(async (range) => {
    try {
      setAnalyticsData(await getAnalyticsSummary(range));
      setAnalyticsError('');
    } catch {
      setAnalyticsError(errors.analytics);
    }
  }, []);

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await getDashboardSummary());
      setLoadError('');
    } catch {
      setLoadError(errors.dashboard);
    }
  }, []);

  const refreshAll = useCallback(() => {
    refreshSummary();
    fetchAnalytics(timeRange);
  }, [refreshSummary, fetchAnalytics, timeRange]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const userData = await getMe();
        if (cancelled) return;
        if (!userData?.onboardingCompleted) {
          rememberDestination();
          router.replace('/onboarding');
          return;
        }
        setUser(userData);
        setAccounts(await getAccounts());
        refreshSummary();
        fetchAnalytics('24h');
      } catch {
        if (!cancelled) router.push('/login');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // Deliberately once: refreshAll re-runs on focus and on socket events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Coming back from the inbox or another tab should not show a stale queue.
  useEffect(() => {
    const onFocus = () => refreshAll();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAll(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshAll]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const socket = io(BACKEND_URL, { withCredentials: true });
    socket.on('connect', () => socket.emit('join', { userId: user.id }));

    const update = () => refreshAll();
    socket.on('conversation_read', update);
    socket.on('conversation_updated', update);
    socket.on('new_message', update);
    socket.on('chat_cleared', update);
    socket.on('analysis_completed', update);
    socket.on('conversation_deleted', update);

    return () => socket.disconnect();
  }, [user, refreshAll]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchAnalytics(timeRange);
    setRefreshing(false);
  }

  function handleRangeChange(e) {
    const next = e.target.value;
    setTimeRange(next);
    fetchAnalytics(next);
  }

  function handleConnect(e) {
    if (e) e.preventDefault();

    // CATCH IT BEFORE THE REDIRECT. The backend refuses to start a connect for
    // an unverified address and bounces to /profile?error=email_unverified.
    // That is correct, but sending someone through Instagram's consent screen
    // only to reject them on the way back is a bad way to deliver the news.
    if (user?.needsEmail) return setConnectBlocked('email_required');
    if (user?.emailVerified === false) return setConnectBlocked('email_unverified');

    if (isRedirectingRef.current) return undefined;
    isRedirectingRef.current = true;
    setIsRedirecting(true);
    // Programmatic navigation stops mobile intercepting the link into the
    // native Instagram app.
    window.location.href = getInstagramAuthUrl();
    return undefined;
  }

  async function handleDisconnect() {
    if (!disconnectTarget || disconnecting) return;
    setDisconnecting(true);
    try {
      await disconnectAccount(disconnectTarget.id);
      setAccounts((prev) => prev.map((a) => (
        a.id === disconnectTarget.id ? { ...a, connectionStatus: 'DISCONNECTED' } : a
      )));
    } catch {
      setLoadError(errors.disconnectAccount);
    } finally {
      setDisconnecting(false);
      setDisconnectTarget(null);
    }
  }

  const rangeLabel = t.analytics.ranges[timeRange];
  const breakdown = summary?.breakdown || {};
  const away = summary?.whileYouWereAway;
  const attentionCount = summary?.attentionQueueCount || 0;
  // `collaborations` is brand_deal + collaboration. Sponsorships and collabs
  // are one concept in the UI, and the narrower `brandDeals` key would
  // undercount the folder this card links to.
  const brandDealCount = breakdown.collaborations || 0;

  const replyMode = analyticsData?.replyMode;
  const replyModeMeta = replyModeLabel(replyMode);
  const sendsAutomatically = replyModeSendsAutomatically(replyMode);

  const metrics = summary ? [
    { key: 'needsReply', icon: 'alertTriangle', value: attentionCount, filter: 'important' },
    { key: 'hotLeads', icon: 'flame', value: breakdown.hotLeads, filter: 'hot_leads' },
    { key: 'brandDeals', icon: 'handshake', value: brandDealCount, filter: 'brand_deal' },
    { key: 'unread', icon: 'messageSquare', value: summary.unreadCount, filter: 'unread' },
  ] : [];

  return (
    <AppShell
      user={user}
      title={common.productName}
      activeRoute="/dashboard"
      actions={(
        <Button
          variant="primary"
          size="sm"
          onClick={handleConnect}
          disabled={isRedirecting}
        >
          <Icon name="instagram" size={15} />
          {accounts.length > 0 ? t.addAccount : t.connectInstagram}
        </Button>
      )}
    >
      <AuthErrorBanner />

      {connectBlocked && (
        <div className={styles.alert} role="alert">
          <IconTile name="alertTriangle" tone="danger" />
          <div className={styles.alertBody}>
            <p className={styles.alertText}>
              {errors.oauthCallback[connectBlocked] || errors.oauthCallback.generic}
            </p>
            <Link href="/profile" className={styles.alertLink}>{t.accounts.goToProfile}</Link>
          </div>
        </div>
      )}

      <header className={styles.pageHead}>
        <h1 className={styles.greeting}>
          {t.greeting[greetingTimeOfDay()]}{user?.name ? `, ${user.name}` : ''}
        </h1>
        <p className={styles.greetingSub}>
          {summary
            ? `${plural(summary.totalDmsReviewed, 'message')} reviewed. ${plural(attentionCount, 'conversation')} ${pluralWord(attentionCount, 'needs', 'need')} your reply.`
            : t.subtitleFallback}
        </p>
      </header>

      {/* Mounted only with billing on, so pre-launch the dashboard never calls
          the billing summary at all. */}
      {user?.features?.billing && (
        <Suspense fallback={null}>
          <TrialPrompt onConnect={handleConnect} />
        </Suspense>
      )}

      {loadError && (
        <div className={styles.alert} role="alert">
          <IconTile name="alertTriangle" tone="danger" />
          <p className={styles.alertText}>{loadError}</p>
        </div>
      )}

      {summary?.connectionProblems?.length > 0 && (
        <div className={styles.alert} role="alert">
          <IconTile name="alertTriangle" tone="warning" />
          <div className={styles.alertBody}>
            <p className={styles.alertTitle}>{t.connectionAlert.title}</p>
            <p className={styles.alertText}>
              {summary.connectionProblems.map((a) => `@${a.igUsername || 'account'}`).join(', ')}
              {' — '}{t.connectionAlert.body}
            </p>
          </div>
        </div>
      )}

      {/* ---------- Right now: the live queue, no date range ---------- */}
      <section className={styles.section} aria-labelledby="now-heading">
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle} id="now-heading">{t.now.title}</h2>
            <p className={styles.sectionHint}>{t.now.hint}</p>
          </div>
        </div>

        {loading ? (
          <div className={styles.metricGrid}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} lines={1} height={96} />)}
          </div>
        ) : (
          <div className={styles.metricGrid}>
            {metrics.map((m) => (
              <button
                key={m.key}
                type="button"
                className={styles.metricCard}
                onClick={() => router.push(`/inbox?filter=${m.filter}`)}
              >
                <IconTile name={m.icon} tone={METRIC_TONE[m.key]} />
                <span className={styles.metricValue}>{formatCount(m.value)}</span>
                <span className={styles.metricLabel}>{t.metrics[m.key].label}</span>
                <span className={styles.metricHint}>{t.metrics[m.key].hint}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ---------- Since your last visit ---------- */}
      {away && (
        <section className={styles.section} aria-labelledby="away-heading">
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle} id="away-heading">{t.away.title}</h2>
              <p className={styles.sectionHint}>
                {plural(away.newMessages, 'new message')}
                {away.since ? ` ${t.away.sincePrefix} ${formatDate(away.since)}` : ''}
              </p>
            </div>
            {away.needsAttention > 0 && (
              <Button size="sm" onClick={() => router.push('/inbox?filter=important')}>
                {t.away.reviewAction}
                <Icon name="arrowRight" size={13} />
              </Button>
            )}
          </div>

          <div className={styles.chipRow}>
            {Object.entries(away.categoryCounts || {}).map(([category, count]) => (
              <button
                key={category}
                type="button"
                className={styles.chip}
                onClick={() => router.push(`/inbox?filter=${category}`)}
              >
                <span className={styles.chipCount}>{formatCount(count)}</span>
                <span className={styles.chipLabel}>{categoryLabel(category).label}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Analytics: everything here carries its range ---------- */}
      <section className={styles.section} aria-labelledby="analytics-heading">
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle} id="analytics-heading">{t.analytics.title}</h2>
            <p className={styles.sectionHint}>{t.analytics.inRange(rangeLabel)}</p>
          </div>
          <div className={styles.sectionActions}>
            <Select
              value={timeRange}
              onChange={handleRangeChange}
              aria-label={t.analytics.rangeLabel}
            >
              {Object.entries(t.analytics.ranges).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={handleRefresh}
              loading={refreshing}
              aria-label={t.analytics.refresh}
              title={t.analytics.refresh}
            >
              <Icon name="refresh" size={14} />
            </Button>
          </div>
        </div>

        {analyticsError && (
          <div className={styles.alert} role="alert">
            <IconTile name="alertTriangle" tone="danger" />
            <p className={styles.alertText}>{analyticsError}</p>
          </div>
        )}

        {/* Stated plainly, so no number on this page can imply replies are
            going out when the account is set to manual. */}
        {replyMode && (
          <div className={styles.replyMode}>
            <IconTile name={sendsAutomatically ? 'zap' : 'user'} tone={sendsAutomatically ? 'accent' : 'neutral'} />
            <div className={styles.replyModeBody}>
              <p className={styles.replyModeTitle}>
                {t.analytics.replyModeBanner.title}: {replyModeMeta.label}
              </p>
              <p className={styles.replyModeHint}>{replyModeMeta.description}</p>
            </div>
            <Button size="sm" onClick={() => router.push('/settings?tab=replies')}>
              {t.analytics.replyModeBanner.manageAction}
            </Button>
          </div>
        )}

        <div className={styles.chartRow}>
          <Card className={styles.chartCard}>
            <div className={styles.chartHead}>
              <span className={styles.cardLabel}>{t.analytics.totalMessages.label}</span>
              <span className={styles.rangeTag}>{rangeLabel}</span>
            </div>
            <div className={styles.bigNumberRow}>
              <span className={styles.bigNumber}>{analyticsData?.totalDms?.formatted ?? '—'}</span>
              <Delta changePercent={analyticsData?.totalDms?.changePercent} />
            </div>
            <Sparkline
              series={analyticsData?.totalDms?.series}
              labels={analyticsData?.totalDms?.labels}
              unit={t.analytics.totalMessages.unit}
            />
          </Card>

          <Card className={styles.chartCard}>
            <div className={styles.chartHead}>
              <span className={styles.cardLabel}>{t.analytics.hotLeads.label}</span>
              <span className={styles.rangeTag}>{rangeLabel}</span>
            </div>
            <div className={styles.bigNumberRow}>
              <span className={styles.bigNumber}>{analyticsData?.hotLeads?.formatted ?? '—'}</span>
              <Delta changePercent={analyticsData?.hotLeads?.changePercent} />
            </div>
            <Sparkline
              series={analyticsData?.hotLeads?.series}
              labels={analyticsData?.hotLeads?.labels}
              unit={t.analytics.hotLeads.unit}
            />
          </Card>
        </div>

        {/* "Needs your reply" is deliberately absent here: its query is
            byte-identical to the one behind the card in "Right now", so it was
            the same number under a range selector that never moved it. */}
        <div className={styles.compactRow}>
          <Compact
            label={t.analytics.brandDeals.label}
            value={analyticsData?.brandDeals?.formatted}
            hint={t.analytics.brandDeals.hint}
            range={rangeLabel}
          />
          <Compact
            label={t.analytics.autoReplies.label}
            value={analyticsData?.autoRepliesSent?.formatted}
            hint={sendsAutomatically ? t.analytics.autoReplies.hintOn : t.analytics.autoReplies.hintOff}
            range={rangeLabel}
          />
          <Compact
            label={t.analytics.spamBlocked.label}
            value={analyticsData?.spamBlocked?.formatted}
            hint={t.analytics.spamBlocked.hint}
            range={rangeLabel}
          />
        </div>

        <Breakdown
          metrics={analyticsData?.categoryMetrics}
          distribution={analyticsData?.intentDistribution}
          total={analyticsData?.distributionTotal || 0}
        />
      </section>

      {/* ---------- Connected accounts: reference, so it sits last ---------- */}
      <section className={styles.section} aria-labelledby="accounts-heading">
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle} id="accounts-heading">{t.accounts.title}</h2>
            <p className={styles.sectionHint}>{plural(accounts.length, 'account')}</p>
          </div>
        </div>

        {accounts.length === 0 ? (
          <EmptyState
            icon="instagram"
            title={empty.accounts.title}
            body={empty.accounts.body}
            action={<Button variant="primary" onClick={handleConnect} disabled={isRedirecting}>{empty.accounts.action}</Button>}
          />
        ) : (
          <div className={styles.accountList}>
            {accounts.map((account) => {
              const isDisconnected = account.connectionStatus === 'DISCONNECTED';
              const needsReconnect = account.tokenStatus === 'NEEDS_RECONNECT' || isDisconnected;
              const status = isDisconnected
                ? connectionStatusLabel(account.connectionStatus)
                : tokenStatusLabel(account.tokenStatus);
              return (
                <div key={account.id} className={styles.accountRow}>
                  <Avatar
                    src={account.igProfilePic}
                    name={account.igUsername || account.igName}
                    size={36}
                    decorative
                  />
                  <div className={styles.accountInfo}>
                    <span className={styles.accountName}>@{account.igUsername || 'account'}</span>
                    {account.igName && <span className={styles.accountSub}>{account.igName}</span>}
                  </div>

                  <div className={styles.accountMeta}>
                    <Badge tone={status.tone === 'positive' ? 'positive' : 'warning'}>{status.label}</Badge>
                    {account.tokenExpiresAt && (
                      <span className={styles.accountMetaItem}>
                        {t.accounts.tokenExpires} {formatDate(account.tokenExpiresAt)}
                      </span>
                    )}
                    {typeof account._count?.conversations === 'number' && (
                      <span className={styles.accountMetaItem}>
                        {plural(account._count.conversations, 'conversation')}
                      </span>
                    )}
                  </div>

                  <div className={styles.accountActions}>
                    {needsReconnect ? (
                      <Button variant="primary" size="sm" onClick={handleConnect} disabled={isRedirecting}>
                        {t.accounts.reconnect}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => router.push(`/inbox?accountId=${account.id}`)}>
                        {t.accounts.openInbox}
                      </Button>
                    )}
                    {!isDisconnected && (
                      <Button variant="danger" size="sm" onClick={() => setDisconnectTarget(account)}>
                        {t.accounts.disconnect}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* master used window.confirm(), which cannot be styled, cannot be
          dismissed with the keyboard consistently, and is blocked outright in
          some embedded browsers. */}
      {disconnectTarget && (
        <Modal
          title={confirmCopy.disconnectAccount.title}
          onClose={() => setDisconnectTarget(null)}
          actions={(
            <>
              <Button onClick={() => setDisconnectTarget(null)} disabled={disconnecting}>
                {common.cancel}
              </Button>
              <Button variant="danger" onClick={handleDisconnect} loading={disconnecting}>
                {t.accounts.disconnect}
              </Button>
            </>
          )}
        >
          {confirmCopy.disconnectAccount.body}
        </Modal>
      )}
    </AppShell>
  );
}

/* ============================== Pieces ============================== */

function Compact({ label, value, hint, range }) {
  return (
    <Card className={styles.compactCard}>
      <div className={styles.chartHead}>
        <span className={styles.cardLabel}>{label}</span>
        <span className={styles.rangeTag}>{range}</span>
      </div>
      <span className={styles.bigNumber}>{value ?? '—'}</span>
      <span className={styles.cardHint}>{hint}</span>
    </Card>
  );
}

/**
 * One breakdown, not two.
 *
 * master rendered `categoryMetrics` as a chip grid AND `intentDistribution` as
 * a segmented bar with a legend — the same counts from the same source, twice.
 * The share lives on the chip now, and the bar is gone.
 *
 * Percentages appear only once the sample is big enough to mean anything. Below
 * that the counts still show, because they are honest; only the shares are
 * withheld, with a line saying why.
 */
/**
 * Keys that already have a card of their own further up the page. The API
 * returns them inside `categoryMetrics` too, so without this filter "Hot
 * leads" appeared three times on one screen — the live queue, the selected
 * range, and here — each counting something different, none of them wrong,
 * and no reader able to tell them apart.
 */
const BREAKDOWN_SHOWN_ABOVE = new Set(['hot_leads', 'deals', 'spam']);

function Breakdown({ metrics, distribution, total }) {
  const items = (metrics || []).filter((m) => !BREAKDOWN_SHOWN_ABOVE.has(m.key));
  if (items.length === 0) return null;

  const showShare = total >= MIN_PERCENT_SAMPLE;
  const shareByKey = new Map((distribution || []).map((d) => [d.key, d.pct]));

  return (
    <section className={styles.breakdown} aria-labelledby="breakdown-heading">
      <div className={styles.sectionHead}>
        <div>
          <h3 className={styles.sectionTitle} id="breakdown-heading">{t.analytics.breakdown.title}</h3>
          {/* These are all-time, unlike everything above. Said, not implied. */}
          <p className={styles.sectionHint}>{t.analytics.breakdown.subtitle}</p>
        </div>
      </div>

      <div className={styles.breakdownGrid}>
        {items.map((m) => {
          const pct = shareByKey.get(m.key);
          return (
            <div key={m.key || m.label} className={styles.breakdownCard}>
              <IconTile name={m.icon} tone="neutral" />
              <span className={styles.breakdownValue}>
                {formatCount(m.value)}
                {showShare && typeof pct === 'number' && (
                  <span className={styles.breakdownPct}>{pct}%</span>
                )}
              </span>
              <span className={styles.breakdownLabel}>{m.label}</span>
              {m.hint && <span className={styles.breakdownHint}>{m.hint}</span>}
            </div>
          );
        })}
      </div>

      {!showShare && total > 0 && (
        <p className={styles.sampleNote}>{t.analytics.breakdown.sampleTooSmall}</p>
      )}
    </section>
  );
}

/** Renders nothing when there is no previous period to compare against. */
function Delta({ changePercent }) {
  if (typeof changePercent !== 'number' || !Number.isFinite(changePercent) || changePercent === 0) {
    return null;
  }
  const up = changePercent > 0;
  return (
    <span className={up ? styles.deltaUp : styles.deltaDown}>
      {up ? '+' : ''}{changePercent}%
    </span>
  );
}

/**
 * A line, its area, and a hover readout. One accent colour, no gradient stack
 * and no second "AI" hue — master drew the hot-leads line in amber purely to
 * differentiate two cards that already have different headings.
 */
function Sparkline({ series, labels, unit }) {
  const [hovered, setHovered] = useState(null);

  if (!series || series.length === 0 || series.every((v) => v === 0)) {
    return <p className={styles.noData}>{t.analytics.noData}</p>;
  }

  const W = 320;
  const H = 72;
  const PAD_TOP = 8;
  const PAD_BOTTOM = 8;
  const usable = H - PAD_TOP - PAD_BOTTOM;
  const max = Math.max(...series, 1);

  const points = series.map((val, i) => ({
    x: (i / (series.length - 1 || 1)) * W,
    y: PAD_TOP + usable - (val / max) * usable,
    val,
  }));

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    setHovered(Math.round(ratio * (series.length - 1)));
  }

  const active = hovered !== null ? points[hovered] : null;
  const activeLabel = hovered !== null ? labels?.[hovered] : null;

  return (
    <div
      className={styles.spark}
      onMouseMove={onMove}
      onMouseLeave={() => setHovered(null)}
      onTouchMove={(e) => e.touches?.[0] && onMove(e.touches[0])}
      onTouchEnd={() => setHovered(null)}
    >
      {active && (
        <p className={styles.sparkReadout} aria-live="polite">
          <strong>{formatCount(active.val)}</strong> {unit}
          {activeLabel ? ` · ${activeLabel}` : ''}
        </p>
      )}
      <svg className={styles.sparkSvg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path className={styles.sparkArea} d={area} />
        <path className={styles.sparkLine} d={line} />
        {active && <circle className={styles.sparkDot} cx={active.x} cy={active.y} r="3.5" />}
      </svg>
      <div className={styles.sparkAxis}>
        <span>{labels?.[0]}</span>
        <span>{labels?.[labels.length - 1]}</span>
      </div>
    </div>
  );
}

/**
 * The trial card, where the connect flow lands. Unchanged from master: billing
 * is restyle-only and comes last in this rebuild.
 */
function TrialPrompt({ onConnect }) {
  const searchParams = useSearchParams();
  const { summary, reload } = useBillingSummary();
  const [claimedOutcome, setClaimedOutcome] = useState(null);
  const state = trialCardState(summary, {
    justConnectedOutcome: claimedOutcome || searchParams.get('trial'),
  });
  if (!state) return null;
  return (
    <div className={styles.trialSlot}>
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
