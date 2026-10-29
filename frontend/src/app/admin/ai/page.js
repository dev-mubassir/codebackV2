'use client';

/**
 * Super Admin — AI Provider Controls & Usage Dashboard.
 *
 * Siffty Theme:
 * - White background, royal blue #4169E1 accent
 * - Flat surfaces with 1px borders
 * - No gradients, no emoji, no fake data
 *
 * Includes:
 * 1. DM Classification (Cloudflare Clef Flash -> Gemini fallback)
 * 2. Text Generation (Groq Cloud gpt-oss-20b -> Gemini fallback)
 * 3. AI Usage Tracking Dashboard (tokens, cost, latency, users, traces, CSV export)
 * 4. General Provider Allowlist Testing & Activation
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  activateAdminAiModel,
  getAdminAiConfig,
  rollbackAdminAiModel,
  testAdminAiModel,
  getAdminClassificationStatus,
  setAdminClassificationProvider,
  testAdminClassification,
  resetAdminClassificationBreaker,
  getAdminTextGenStatus,
  setAdminTextGenProvider,
  resetAdminTextGenBreaker,
  testAdminTextGen,
  getAdminAiUsageSummary,
  getAdminAiUsageBreakdown,
  getAdminAiUsageUsers,
  getAdminAiUsageTraces,
  getAdminAiUsageExportUrl,
} from '@/lib/api';
import { Badge, Button, Select, Skeleton, Input } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import { formatDateTime } from '@/content/format';
import ReasonDialog from '../_components/ReasonDialog';
import { StepUpCancelled, useStepUp } from '../_components/StepUp';
import styles from '../admin.module.css';

const c = t.ai;
const usd = (x) => (typeof x === 'number' && Number.isFinite(x) ? `$${x.toFixed(4)}` : '—');
const inr = (x) => (typeof x === 'number' && Number.isFinite(x) ? `₹${x.toFixed(2)}` : '—');

const label = (catalogue, target) => {
  if (!target) return '—';
  const p = catalogue.find((x) => x.id === target.provider);
  const m = p?.models.find((x) => x.id === target.model);
  return `${p?.name || target.provider} · ${m?.label || target.model}`;
};

export default function AdminAiPage() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [tests, setTests] = useState({}); // "provider/model" -> test result
  const [fallbackOn, setFallbackOn] = useState(false);
  const [fallbackKey, setFallbackKey] = useState('');
  const [dialog, setDialog] = useState(null); // 'activate' | 'rollback'
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const { withStepUp } = useStepUp();

  // Classification state & controls
  const [classStatus, setClassStatus] = useState(null);
  const [classLoading, setClassLoading] = useState(true);
  const [classError, setClassError] = useState('');
  const [classSwitchDialog, setClassSwitchDialog] = useState(null); // 'clef' | 'gemini' | null
  const [classSwitchBusy, setClassSwitchBusy] = useState(false);
  const [classSwitchError, setClassSwitchError] = useState('');
  const [classTesting, setClassTesting] = useState(false);
  const [classTestResult, setClassTestResult] = useState(null);
  const [classResetting, setClassResetting] = useState(false);

  // Text generation state & controls (Groq Cloud)
  const [textStatus, setTextStatus] = useState(null);
  const [textLoading, setTextLoading] = useState(true);
  const [textError, setTextError] = useState('');
  const [textSwitchDialog, setTextSwitchDialog] = useState(null); // 'groq' | 'gemini' | null
  const [textSwitchBusy, setTextSwitchBusy] = useState(false);
  const [textSwitchError, setTextSwitchError] = useState('');
  const [textTesting, setTextTesting] = useState(false);
  const [textTestResult, setTextTestResult] = useState(null);
  const [textResetting, setTextResetting] = useState(false);

  // Usage dashboard state
  const [usageRange, setUsageRange] = useState('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [usageFilterFeature, setUsageFilterFeature] = useState('all');
  const [usageFilterProvider, setUsageFilterProvider] = useState('all');
  const [usageFilterStatus, setUsageFilterStatus] = useState('all');
  const [usageFilterFallback, setUsageFilterFallback] = useState('all');
  const [usageSummary, setUsageSummary] = useState(null);
  const [usageBreakdown, setUsageBreakdown] = useState(null);
  const [usageUsers, setUsageUsers] = useState([]);
  const [userSort, setUserSort] = useState('cost');
  const [usageTraces, setUsageTraces] = useState([]);
  const [tracesPagination, setTracesPagination] = useState({ page: 1, limit: 25, total: 0, pages: 1 });
  const [tracesPage, setTracesPage] = useState(1);
  const [usageLoading, setUsageLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await getAdminAiConfig());
    } catch {
      setError(errors.admin.settings);
    }
  }, []);

  const loadClassification = useCallback(async () => {
    try {
      const data = await getAdminClassificationStatus();
      setClassStatus(data);
      setClassError('');
    } catch {
      setClassError('Could not load classification status.');
    } finally {
      setClassLoading(false);
    }
  }, []);

  const loadTextGen = useCallback(async () => {
    try {
      const data = await getAdminTextGenStatus();
      setTextStatus(data);
      setTextError('');
    } catch {
      setTextError('Could not load text generation status.');
    } finally {
      setTextLoading(false);
    }
  }, []);

  const loadUsageDashboard = useCallback(async () => {
    setUsageLoading(true);
    const queryParams = {
      range: usageRange,
      from: usageRange === 'custom' ? customFrom : undefined,
      to: usageRange === 'custom' ? customTo : undefined,
      feature: usageFilterFeature !== 'all' ? usageFilterFeature : undefined,
      provider: usageFilterProvider !== 'all' ? usageFilterProvider : undefined,
      status: usageFilterStatus !== 'all' ? usageFilterStatus : undefined,
      fallback: usageFilterFallback !== 'all' ? usageFilterFallback : undefined,
    };

    try {
      const [sum, bkd, usr, trc] = await Promise.all([
        getAdminAiUsageSummary(queryParams),
        getAdminAiUsageBreakdown(queryParams),
        getAdminAiUsageUsers({ ...queryParams, sort: userSort, limit: 15 }),
        getAdminAiUsageTraces({ ...queryParams, page: tracesPage, limit: 25 }),
      ]);
      setUsageSummary(sum);
      setUsageBreakdown(bkd);
      setUsageUsers(usr.users || []);
      setUsageTraces(trc.traces || []);
      setTracesPagination(trc.pagination || { page: 1, limit: 25, total: 0, pages: 1 });
    } catch (err) {
      console.error('Failed to load AI usage dashboard:', err);
    } finally {
      setUsageLoading(false);
    }
  }, [
    usageRange,
    customFrom,
    customTo,
    usageFilterFeature,
    usageFilterProvider,
    usageFilterStatus,
    usageFilterFallback,
    userSort,
    tracesPage,
  ]);

  useEffect(() => {
    let cancelled = false;
    getAdminAiConfig()
      .then((data) => { if (!cancelled) setConfig(data); })
      .catch(() => { if (!cancelled) setError(errors.admin.settings); });

    getAdminClassificationStatus()
      .then((data) => {
        if (!cancelled) {
          setClassStatus(data);
          setClassError('');
          setClassLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setClassError('Could not load classification status.');
          setClassLoading(false);
        }
      });

    getAdminTextGenStatus()
      .then((data) => {
        if (!cancelled) {
          setTextStatus(data);
          setTextError('');
          setTextLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTextError('Could not load text generation status.');
          setTextLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const queryParams = {
      range: usageRange,
      from: usageRange === 'custom' ? customFrom : undefined,
      to: usageRange === 'custom' ? customTo : undefined,
      feature: usageFilterFeature !== 'all' ? usageFilterFeature : undefined,
      provider: usageFilterProvider !== 'all' ? usageFilterProvider : undefined,
      status: usageFilterStatus !== 'all' ? usageFilterStatus : undefined,
      fallback: usageFilterFallback !== 'all' ? usageFilterFallback : undefined,
    };

    Promise.all([
      getAdminAiUsageSummary(queryParams),
      getAdminAiUsageBreakdown(queryParams),
      getAdminAiUsageUsers({ ...queryParams, sort: userSort, limit: 15 }),
      getAdminAiUsageTraces({ ...queryParams, page: tracesPage, limit: 25 }),
    ]).then(([sum, bkd, usr, trc]) => {
      if (cancelled) return;
      setUsageSummary(sum);
      setUsageBreakdown(bkd);
      setUsageUsers(usr.users || []);
      setUsageTraces(trc.traces || []);
      setTracesPagination(trc.pagination || { page: 1, limit: 25, total: 0, pages: 1 });
      setUsageLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      console.error('Failed to load AI usage dashboard:', err);
      setUsageLoading(false);
    });

    return () => { cancelled = true; };
  }, [
    usageRange,
    customFrom,
    customTo,
    usageFilterFeature,
    usageFilterProvider,
    usageFilterStatus,
    usageFilterFallback,
    userSort,
    tracesPage,
  ]);

  // Polling for operational status
  useEffect(() => {
    let timer = null;
    let active = true;

    async function poll() {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const [cData, tData] = await Promise.all([
          getAdminClassificationStatus().catch(() => null),
          getAdminTextGenStatus().catch(() => null),
        ]);
        if (active) {
          if (cData) setClassStatus(cData);
          if (tData) setTextStatus(tData);
        }
      } catch {
        // ignore polling errors
      }
    }

    timer = setInterval(poll, 10000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  async function handleConfirmSwitchClassification(reason) {
    if (!classSwitchDialog) return;
    setClassSwitchBusy(true);
    setClassSwitchError('');
    try {
      const result = await setAdminClassificationProvider({
        provider: classSwitchDialog,
        reason,
      });
      setClassStatus(result.stats);
      setNotice({ tone: 'success', text: `Classification provider switched to ${classSwitchDialog}.` });
      setClassSwitchDialog(null);
    } catch (err) {
      setClassSwitchError(err?.response?.data?.error || 'Could not switch classification provider.');
    } finally {
      setClassSwitchBusy(false);
    }
  }

  async function handleConfirmSwitchTextGen(reason) {
    if (!textSwitchDialog) return;
    setTextSwitchBusy(true);
    setTextSwitchError('');
    try {
      const result = await setAdminTextGenProvider({
        provider: textSwitchDialog,
        reason,
      });
      setTextStatus(result.stats);
      setNotice({ tone: 'success', text: `Text generation primary provider switched to ${textSwitchDialog}.` });
      setTextSwitchDialog(null);
      await loadTextGen();
      await loadUsageDashboard();
    } catch (err) {
      setTextSwitchError(err?.response?.data?.error || 'Could not switch text generation provider.');
    } finally {
      setTextSwitchBusy(false);
    }
  }

  async function handleRunClassificationTest() {
    setClassTesting(true);
    setClassTestResult(null);
    try {
      const res = await testAdminClassification();
      setClassTestResult(res);
      setNotice({
        tone: 'success',
        text: `Classification test via ${res.provider}: ${res.category} (${res.latencyMs} ms).`,
      });
      await loadClassification();
      await loadUsageDashboard();
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.error || 'Classification test failed.' });
    } finally {
      setClassTesting(false);
    }
  }

  async function handleResetClassificationBreaker() {
    setClassResetting(true);
    try {
      const res = await resetAdminClassificationBreaker('Admin manual reset');
      setClassStatus(res.stats);
      setNotice({ tone: 'success', text: 'Classification circuit breaker reset successfully.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.error || 'Could not reset circuit breaker.' });
    } finally {
      setClassResetting(false);
    }
  }

  async function handleRunTextGenTest() {
    setTextTesting(true);
    setTextTestResult(null);
    try {
      const res = await testAdminTextGen();
      setTextTestResult(res);
      setNotice({
        tone: 'success',
        text: `Text generation probe completed via ${res.provider} (${res.model}) in ${res.latencyMs} ms.`,
      });
      await loadTextGen();
      await loadUsageDashboard();
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.error || 'Text generation test failed.' });
    } finally {
      setTextTesting(false);
    }
  }

  async function handleResetTextGenBreaker() {
    setTextResetting(true);
    try {
      const res = await resetAdminTextGenBreaker('Admin manual reset');
      setTextStatus(res.stats);
      setNotice({ tone: 'success', text: 'Groq circuit breaker reset successfully.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.error || 'Could not reset Groq circuit breaker.' });
    } finally {
      setTextResetting(false);
    }
  }

  const catalogue = useMemo(() => config?.providers || [], [config]);
  const usable = catalogue.filter((p) => p.keyConfigured);
  const models = catalogue.find((p) => p.id === provider)?.models || [];
  const key = provider && model ? `${provider}/${model}` : '';
  const result = key ? tests[key] : null;
  const passingFallbacks = Object.values(tests).filter((r) => r.allSchemaValid && `${r.provider}/${r.model}` !== key);

  async function runTest() {
    setTesting(true);
    setNotice(null);
    try {
      const r = await testAdminAiModel(provider, model);
      setTests((prev) => ({ ...prev, [`${r.provider}/${r.model}`]: r }));
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.error || errors.generic });
    } finally {
      setTesting(false);
    }
  }

  async function confirm(reason) {
    setBusy(true);
    setDialogError('');
    try {
      if (dialog === 'activate') {
        const fb = fallbackOn ? tests[fallbackKey] : null;
        await withStepUp(() =>
          activateAdminAiModel({
            provider,
            model,
            testRunId: result.testRunId,
            reason,
            fallbackEnabled: Boolean(fb),
            ...(fb ? { fallbackProvider: fb.provider, fallbackModel: fb.model, fallbackTestRunId: fb.testRunId } : {}),
          })
        );
        setNotice({ tone: 'success', text: c.done });
      } else {
        await withStepUp(() => rollbackAdminAiModel(reason));
        setNotice({ tone: 'success', text: c.rolledBack });
      }
      setDialog(null);
      await loadConfig();
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setDialogError(err?.response?.data?.error || errors.generic);
    } finally {
      setBusy(false);
    }
  }

  if (!config && !error) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;
  if (error) {
    return <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{error}</span></div>;
  }

  const exportUrl = getAdminAiUsageExportUrl({
    range: usageRange,
    from: usageRange === 'custom' ? customFrom : undefined,
    to: usageRange === 'custom' ? customTo : undefined,
    feature: usageFilterFeature !== 'all' ? usageFilterFeature : undefined,
    provider: usageFilterProvider !== 'all' ? usageFilterProvider : undefined,
    status: usageFilterStatus !== 'all' ? usageFilterStatus : undefined,
    fallback: usageFilterFallback !== 'all' ? usageFilterFallback : undefined,
  });

  return (
    <div className={styles.stack}>
      {notice && (
        <p className={`${styles.notice} ${notice.tone === 'error' ? styles.noticeError : styles.noticeSuccess}`} role="status">{notice.text}</p>
      )}

      {/* ========================================================= */}
      {/* 1. Text Generation Controls (Groq Cloud + Gemini Fallback) */}
      {/* ========================================================= */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Text Generation</h2>
            <p className={styles.panelSubtitle}>
              Primary provider:{' '}
              <strong className={styles.cellMono}>{textStatus?.effectiveProvider?.toUpperCase() || 'GROQ'}</strong>
              {' '}(model: <code>{textStatus?.model || 'openai/gpt-oss-20b'}</code>)
              {' · '}
              <span>Fallback: <strong>Google Gemini</strong> (automatic, customer sees zero error)</span>
              {textStatus?.killSwitchActive && (
                <span className={styles.cellSub}> · Kill switch active (<code>TEXT_PROVIDER_FORCE=gemini</code>)</span>
              )}
            </p>
          </div>
          {textStatus && (
            <Badge tone={
              textStatus.circuitBreaker?.isOpen || (textStatus.errorRate > 20)
                ? 'danger'
                : textStatus.effectiveProvider === 'gemini'
                  ? 'neutral'
                  : 'positive'
            }>
              {textStatus.circuitBreaker?.isOpen || textStatus.errorRate > 20
                ? 'Degraded'
                : textStatus.killSwitchActive
                  ? 'Kill Switch: Gemini'
                  : textStatus.effectiveProvider === 'gemini'
                    ? 'Gemini Primary'
                    : 'Groq Active'}
            </Badge>
          )}
        </div>

        {textLoading && !textStatus && (
          <div className={styles.loading}><Skeleton lines={4} height={36} /></div>
        )}

        {textError && !textStatus && (
          <p className={`${styles.notice} ${styles.noticeError}`}>{textError}</p>
        )}

        {textStatus && (
          <>
            <div className={styles.filters} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 'var(--ui-space-2)', alignItems: 'center' }}>
                <span className={styles.metricLabel}>Provider Override:</span>
                <Button
                  size="sm"
                  variant={textStatus.effectiveProvider === 'groq' ? 'primary' : 'secondary'}
                  disabled={textStatus.effectiveProvider === 'groq' || textStatus.killSwitchActive}
                  onClick={() => { setTextSwitchError(''); setTextSwitchDialog('groq'); }}
                >
                  Use Groq First
                </Button>
                <Button
                  size="sm"
                  variant={textStatus.effectiveProvider === 'gemini' ? 'primary' : 'secondary'}
                  disabled={textStatus.effectiveProvider === 'gemini'}
                  onClick={() => { setTextSwitchError(''); setTextSwitchDialog('gemini'); }}
                >
                  Use Gemini Only
                </Button>
              </div>

              <div style={{ display: 'flex', gap: 'var(--ui-space-2)' }}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleRunTextGenTest}
                  loading={textTesting}
                >
                  Test Groq now
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleResetTextGenBreaker}
                  disabled={!textStatus.circuitBreaker?.isOpen}
                  loading={textResetting}
                >
                  Reset breaker
                </Button>
              </div>
            </div>

            {textTestResult && (
              <p className={`${styles.notice} ${styles.noticeSuccess}`}>
                Live probe result: Provider <strong>{textTestResult.provider}</strong> ({textTestResult.model}) in {textTestResult.latencyMs} ms. Output: &quot;{textTestResult.text}&quot; {textTestResult.isFallback ? `(Fallback: ${textTestResult.fallbackReason})` : ''}
              </p>
            )}

            <div className={styles.metricGrid}>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Groq API Key</span>
                <span className={styles.metricValue}>
                  {textStatus.isConfigured ? 'Configured' : 'Not configured'}
                </span>
                <span className={styles.metricHint}>Env variable: GROQ_API_KEY</span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Circuit Breaker</span>
                <span className={`${styles.metricValue} ${textStatus.circuitBreaker?.isOpen ? styles.valueDanger : ''}`}>
                  {textStatus.circuitBreaker?.state || 'CLOSED'}
                </span>
                <span className={styles.metricHint}>
                  {textStatus.circuitBreaker?.isOpen
                    ? `Tripped · Retry in ${textStatus.circuitBreaker?.secondsUntilRetry}s`
                    : `Healthy (${textStatus.circuitBreaker?.consecutiveFailures || 0}/5 fails)`}
                </span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Fallback Rate</span>
                <span className={`${styles.metricValue} ${textStatus.errorRate > 20 ? styles.valueDanger : ''}`}>
                  {textStatus.errorRate}%
                </span>
                <span className={styles.metricHint}>{textStatus.fallbackCalls} fallback calls in window</span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Groq Latency (p50 / p95)</span>
                <span className={styles.metricValue}>
                  {textStatus.latency?.p50 !== null ? `${textStatus.latency.p50} ms` : '—'}
                </span>
                <span className={styles.metricHint}>
                  p95: {textStatus.latency?.p95 !== null ? `${textStatus.latency.p95} ms` : '—'}
                </span>
              </div>
            </div>

            <div className={styles.passwordForm}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--ui-space-3)' }}>
                <div>
                  <span className={styles.metricLabel}>Rate Limit Remaining (Requests)</span>
                  <div style={{ fontSize: 'var(--ui-text-base)', fontWeight: 600, color: 'var(--ui-ink)' }}>
                    {textStatus.rateLimits?.remainingRequests !== null ? textStatus.rateLimits.remainingRequests : '—'}
                  </div>
                  <span className={styles.cellSub}>Reset: {textStatus.rateLimits?.resetRequests || '—'}</span>
                </div>
                <div>
                  <span className={styles.metricLabel}>Rate Limit Remaining (Tokens)</span>
                  <div style={{ fontSize: 'var(--ui-text-base)', fontWeight: 600, color: 'var(--ui-ink)' }}>
                    {textStatus.rateLimits?.remainingTokens !== null ? textStatus.rateLimits.remainingTokens : '—'}
                  </div>
                  <span className={styles.cellSub}>Reset: {textStatus.rateLimits?.resetTokens || '—'}</span>
                </div>
                <div>
                  <span className={styles.metricLabel}>Last Groq Success</span>
                  <div className={styles.cellSub}>
                    {textStatus.lastSuccessAt ? formatDateTime(textStatus.lastSuccessAt) : 'None recorded'}
                  </div>
                </div>
                <div>
                  <span className={styles.metricLabel}>Reasoning Effort</span>
                  <div style={{ fontSize: 'var(--ui-text-base)', fontWeight: 600, color: 'var(--ui-ink)' }}>
                    low
                  </div>
                  <span className={styles.cellSub}>Kept out of customer output</span>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Confirmation Dialog for Text Gen Provider Switch */}
      {textSwitchDialog && (
        <ReasonDialog
          title="Switch Text Generation Primary Provider"
          who={textSwitchDialog === 'groq' ? 'Groq Cloud (openai/gpt-oss-20b)' : 'Google Gemini (Standard)'}
          body={`Are you sure you want to switch the text generation primary provider to ${textSwitchDialog}? In Groq mode, Gemini remains the automatic fallback if any error occurs.`}
          actionLabel={`Switch to ${textSwitchDialog}`}
          variant="primary"
          busy={textSwitchBusy}
          error={textSwitchError}
          onConfirm={handleConfirmSwitchTextGen}
          onClose={() => { if (!textSwitchBusy) setTextSwitchDialog(null); }}
        />
      )}

      {/* ========================================================= */}
      {/* 2. AI Usage Tracking Dashboard                            */}
      {/* ========================================================= */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>AI Usage & Cost Tracking</h2>
            <p className={styles.panelSubtitle}>
              Live token counts, real USD & INR cost aggregates, fallback traces, and per-user consumption.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--ui-space-2)' }}>
            <a
              href={exportUrl}
              download
              className="ui-btn ui-btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                textDecoration: 'none',
                height: '32px',
                padding: '0 12px',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--ui-ink)',
                border: '1px solid var(--ui-line)',
                background: '#ffffff',
                cursor: 'pointer',
              }}
            >
              Export CSV
            </a>
          </div>
        </div>

        {/* Date Range Selector & Filters */}
        <div className={styles.filters} style={{ flexWrap: 'wrap', gap: 'var(--ui-space-2)' }}>
          <div style={{ display: 'flex', gap: 'var(--ui-space-1)' }}>
            {['today', '7d', '30d', 'custom'].map((r) => (
              <Button
                key={r}
                size="sm"
                variant={usageRange === r ? 'primary' : 'secondary'}
                onClick={() => setUsageRange(r)}
              >
                {r === 'today' ? 'Today' : r === '7d' ? 'Last 7 Days' : r === '30d' ? 'Last 30 Days' : 'Custom'}
              </Button>
            ))}
          </div>

          {usageRange === 'custom' && (
            <div style={{ display: 'flex', gap: 'var(--ui-space-2)', alignItems: 'center' }}>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ padding: '4px 8px', border: '1px solid var(--ui-line)', background: '#ffffff', fontSize: '12px' }}
              />
              <span className={styles.cellSub}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ padding: '4px 8px', border: '1px solid var(--ui-line)', background: '#ffffff', fontSize: '12px' }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--ui-space-2)', marginLeft: 'auto' }}>
            <Select
              aria-label="Feature filter"
              value={usageFilterFeature}
              onChange={(e) => { setUsageFilterFeature(e.target.value); setTracesPage(1); }}
            >
              <option value="all">All Features</option>
              <option value="auto_reply">Auto Reply</option>
              <option value="draft_reply">Draft Reply</option>
              <option value="summary">Summary</option>
              <option value="classification">Classification</option>
              <option value="other">Other / Admin Test</option>
            </Select>

            <Select
              aria-label="Provider filter"
              value={usageFilterProvider}
              onChange={(e) => { setUsageFilterProvider(e.target.value); setTracesPage(1); }}
            >
              <option value="all">All Providers</option>
              <option value="groq">Groq</option>
              <option value="gemini">Gemini</option>
              <option value="cloudflare">Cloudflare Clef</option>
            </Select>

            <Select
              aria-label="Status filter"
              value={usageFilterStatus}
              onChange={(e) => { setUsageFilterStatus(e.target.value); setTracesPage(1); }}
            >
              <option value="all">All Statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="rate_limited">Rate Limited</option>
              <option value="timeout">Timeout</option>
              <option value="empty">Empty</option>
            </Select>
          </div>
        </div>

        {usageLoading && !usageSummary ? (
          <div className={styles.loading}><Skeleton lines={5} height={36} /></div>
        ) : (
          <>
            {/* Top Summary Cards */}
            <div className={styles.metricGrid}>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Total Requests</span>
                <span className={styles.metricValue}>
                  {usageSummary?.requests?.toLocaleString() || 0}
                </span>
                <span className={styles.metricHint}>
                  {usageSummary?.fallbacks?.count || 0} fallbacks ({usageSummary?.fallbacks?.rate || 0}%)
                </span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Total Tokens</span>
                <span className={styles.metricValue}>
                  {usageSummary?.tokens?.total?.toLocaleString() || 0}
                </span>
                <span className={styles.metricHint}>
                  In: {usageSummary?.tokens?.prompt?.toLocaleString() || 0} · Out: {usageSummary?.tokens?.completion?.toLocaleString() || 0} · Reasoning: {usageSummary?.tokens?.reasoning?.toLocaleString() || 0}
                </span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Estimated Cost</span>
                <span className={styles.metricValue}>
                  {usd(usageSummary?.cost?.usd)}
                </span>
                <span className={styles.metricHint}>
                  {inr(usageSummary?.cost?.inr)} (USD/INR @ {usageSummary?.cost?.usdInrRate || 84})
                </span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Avg & p95 Latency</span>
                <span className={styles.metricValue}>
                  {usageSummary?.latency?.avg != null ? `${usageSummary.latency.avg} ms` : '—'}
                </span>
                <span className={styles.metricHint}>
                  p95: {usageSummary?.latency?.p95 != null ? `${usageSummary.latency.p95} ms` : '—'} · Errors: {usageSummary?.errors?.rate || 0}%
                </span>
              </div>
            </div>

            {/* Daily Trend SVG Chart */}
            {usageBreakdown?.daily && usageBreakdown.daily.length > 0 && (
              <div className={styles.passwordForm} style={{ marginTop: 'var(--ui-space-3)' }}>
                <span className={styles.metricLabel} style={{ marginBottom: '8px', display: 'block' }}>Daily AI Requests & Cost</span>
                <div style={{ width: '100%', height: '140px', background: '#ffffff', border: '1px solid var(--ui-line)', padding: '12px' }}>
                  <svg width="100%" height="100%" viewBox="0 0 600 100" preserveAspectRatio="none">
                    {/* Horizontal gridlines */}
                    <line x1="0" y1="20" x2="600" y2="20" stroke="#f1f5f9" strokeWidth="1" />
                    <line x1="0" y1="50" x2="600" y2="50" stroke="#f1f5f9" strokeWidth="1" />
                    <line x1="0" y1="80" x2="600" y2="80" stroke="#f1f5f9" strokeWidth="1" />
                    {(() => {
                      const maxReq = Math.max(...usageBreakdown.daily.map((d) => d.requests), 1);
                      const barWidth = Math.max(8, Math.min(30, 500 / usageBreakdown.daily.length - 4));
                      return usageBreakdown.daily.map((d, i) => {
                        const x = 30 + i * (540 / Math.max(1, usageBreakdown.daily.length - 1 || 1));
                        const h = (d.requests / maxReq) * 70;
                        const y = 85 - h;
                        return (
                          <g key={d.date}>
                            <rect
                              x={x - barWidth / 2}
                              y={y}
                              width={barWidth}
                              height={h}
                              fill="#4169E1"
                              opacity={d.errors > 0 ? 0.75 : 1}
                            />
                            <text
                              x={x}
                              y="96"
                              fontSize="8"
                              fill="#64748b"
                              textAnchor="middle"
                            >
                              {d.date.slice(5)}
                            </text>
                          </g>
                        );
                      });
                    })()}
                  </svg>
                </div>
              </div>
            )}

            {/* Breakdowns: Models & Features */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--ui-space-3)', marginTop: 'var(--ui-space-3)' }}>
              {/* Provider & Model Breakdown */}
              <div>
                <span className={styles.metricLabel}>Breakdown by Provider & Model</span>
                <div className={styles.tableScroll} style={{ marginTop: 'var(--ui-space-1)' }}>
                  <table className={`${styles.table} ${styles.tableCompact}`}>
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Model</th>
                        <th>Calls</th>
                        <th>Tokens</th>
                        <th>Est. Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageBreakdown?.models && usageBreakdown.models.length > 0 ? (
                        usageBreakdown.models.map((m) => (
                          <tr key={`${m.provider}/${m.model}`}>
                            <td className={styles.cellMono}>{m.provider}</td>
                            <td className={styles.cellMono}>{m.model}</td>
                            <td>{m.requests.toLocaleString()}</td>
                            <td>{m.totalTokens.toLocaleString()}</td>
                            <td>{usd(m.costUsd)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={5} className={styles.cellSub}>No calls in this period</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Feature Breakdown */}
              <div>
                <span className={styles.metricLabel}>Breakdown by Feature</span>
                <div className={styles.tableScroll} style={{ marginTop: 'var(--ui-space-1)' }}>
                  <table className={`${styles.table} ${styles.tableCompact}`}>
                    <thead>
                      <tr>
                        <th>Feature</th>
                        <th>Requests</th>
                        <th>Tokens</th>
                        <th>Est. Cost</th>
                        <th>Avg Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageBreakdown?.features && usageBreakdown.features.length > 0 ? (
                        usageBreakdown.features.map((f) => (
                          <tr key={f.feature}>
                            <td>{f.feature}</td>
                            <td>{f.requests.toLocaleString()}</td>
                            <td>{f.totalTokens.toLocaleString()}</td>
                            <td>{usd(f.costUsd)}</td>
                            <td>{f.avgLatencyMs ? `${f.avgLatencyMs} ms` : '—'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={5} className={styles.cellSub}>No calls in this period</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Top Users Table */}
            <div style={{ marginTop: 'var(--ui-space-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={styles.metricLabel}>Usage by Customer / Tenant</span>
                <div style={{ display: 'flex', gap: 'var(--ui-space-2)', alignItems: 'center' }}>
                  <span className={styles.cellSub}>Sort by:</span>
                  <Select
                    aria-label="User sort"
                    value={userSort}
                    onChange={(e) => setUserSort(e.target.value)}
                    style={{ height: '28px', fontSize: '12px' }}
                  >
                    <option value="cost">Highest Cost</option>
                    <option value="requests">Most Requests</option>
                    <option value="tokens">Most Tokens</option>
                  </Select>
                </div>
              </div>

              <div className={styles.tableScroll} style={{ marginTop: 'var(--ui-space-1)' }}>
                <table className={`${styles.table} ${styles.tableCompact}`}>
                  <thead>
                    <tr>
                      <th>Customer Email</th>
                      <th>Plan</th>
                      <th>Requests</th>
                      <th>Tokens</th>
                      <th>Est. Cost (USD)</th>
                      <th>Last Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageUsers.length > 0 ? (
                      usageUsers.map((u) => (
                        <tr key={u.userId}>
                          <td><strong>{u.email}</strong></td>
                          <td><Badge tone={u.plan === 'PRO' ? 'accent' : 'neutral'}>{u.plan}</Badge></td>
                          <td>{u.requests.toLocaleString()}</td>
                          <td>{u.totalTokens.toLocaleString()}</td>
                          <td>{usd(u.costUsd)}</td>
                          <td className={styles.cellSub}>{formatDateTime(u.lastUsedAt)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={6} className={styles.cellSub}>No user calls recorded in this period.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent Calls Trace Table */}
            <div style={{ marginTop: 'var(--ui-space-4)' }}>
              <span className={styles.metricLabel}>Recent AI Call Traces</span>
              <div className={styles.tableScroll} style={{ marginTop: 'var(--ui-space-1)' }}>
                <table className={`${styles.table} ${styles.tableCompact}`}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>User</th>
                      <th>Feature</th>
                      <th>Provider / Model</th>
                      <th>Fallback</th>
                      <th>Status</th>
                      <th>Tokens</th>
                      <th>Latency</th>
                      <th>Cost</th>
                      <th>Reason / Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageTraces.length > 0 ? (
                      usageTraces.map((t) => (
                        <tr key={t.id}>
                          <td className={styles.cellSub}>{formatDateTime(t.createdAt)}</td>
                          <td>{t.userEmail ? t.userEmail.split('@')[0] : t.userId ? t.userId.slice(0, 8) : '—'}</td>
                          <td>{t.feature}</td>
                          <td className={styles.cellMono}>{t.provider} · {t.model.replace('openai/', '').replace('gemini-', '')}</td>
                          <td>
                            {t.isFallback ? (
                              <Badge tone="warning">Fallback</Badge>
                            ) : (
                              <span className={styles.cellSub}>Primary</span>
                            )}
                          </td>
                          <td>
                            <Badge tone={t.status === 'success' ? 'positive' : 'danger'}>
                              {t.status}
                            </Badge>
                          </td>
                          <td>{t.totalTokens != null ? t.totalTokens.toLocaleString() : '—'}</td>
                          <td>{t.latencyMs} ms</td>
                          <td>{usd(t.estimatedCostUsd)}</td>
                          <td className={styles.cellSub} style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.fallbackReason || t.errorMessage || '—'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={10} className={styles.cellSub}>No call traces found matching the current filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {tracesPagination.pages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--ui-space-2)' }}>
                  <span className={styles.cellSub}>
                    Page {tracesPagination.page} of {tracesPagination.pages} ({tracesPagination.total} total rows)
                  </span>
                  <div style={{ display: 'flex', gap: 'var(--ui-space-1)' }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={tracesPage <= 1}
                      onClick={() => setTracesPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={tracesPage >= tracesPagination.pages}
                      onClick={() => setTracesPage((p) => Math.min(tracesPagination.pages, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ========================================================= */}
      {/* 3. DM Classification Section (Cloudflare Clef Flash)       */}
      {/* ========================================================= */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>DM Classification</h2>
            <p className={styles.panelSubtitle}>
              Effective provider:{' '}
              <strong className={styles.cellMono}>{classStatus?.effectiveProvider || '—'}</strong>
              {' '}(source: {classStatus?.source || 'default'})
              {classStatus?.targetProvider === 'clef' && !classStatus?.credentialsPresent && (
                <span className={styles.cellSub}> · Clef selected but credentials missing; staying on Gemini</span>
              )}
            </p>
          </div>
          {classStatus && (
            <Badge tone={
              classStatus.circuitBreaker?.isOpen || (typeof classStatus.fallbackRateRatio === 'number' && classStatus.fallbackRateRatio > 0.2)
                ? 'danger'
                : classStatus.effectiveProvider === 'gemini' && classStatus.targetProvider !== 'clef'
                  ? 'neutral'
                  : 'positive'
            }>
              {classStatus.circuitBreaker?.isOpen || (typeof classStatus.fallbackRateRatio === 'number' && classStatus.fallbackRateRatio > 0.2)
                ? 'Degraded'
                : classStatus.effectiveProvider === 'gemini' && classStatus.targetProvider !== 'clef'
                  ? 'Clef off'
                  : 'Healthy'}
            </Badge>
          )}
        </div>

        {classLoading && !classStatus && (
          <div className={styles.loading}><Skeleton lines={4} height={36} /></div>
        )}

        {classError && !classStatus && (
          <p className={`${styles.notice} ${styles.noticeError}`}>{classError}</p>
        )}

        {classStatus && (
          <>
            <div className={styles.filters} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 'var(--ui-space-2)', alignItems: 'center' }}>
                <span className={styles.metricLabel}>Provider Override:</span>
                <Button
                  size="sm"
                  variant={classStatus.effectiveProvider === 'clef' ? 'primary' : 'secondary'}
                  disabled={classStatus.effectiveProvider === 'clef'}
                  onClick={() => { setClassSwitchError(''); setClassSwitchDialog('clef'); }}
                >
                  Use Clef
                </Button>
                <Button
                  size="sm"
                  variant={classStatus.effectiveProvider === 'gemini' && classStatus.targetProvider !== 'clef' ? 'primary' : 'secondary'}
                  disabled={classStatus.effectiveProvider === 'gemini' && classStatus.targetProvider !== 'clef'}
                  onClick={() => { setClassSwitchError(''); setClassSwitchDialog('gemini'); }}
                >
                  Use Gemini
                </Button>
              </div>

              <div style={{ display: 'flex', gap: 'var(--ui-space-2)' }}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleRunClassificationTest}
                  loading={classTesting}
                >
                  Test Clef now
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleResetClassificationBreaker}
                  disabled={!classStatus.circuitBreaker?.isOpen}
                  loading={classResetting}
                >
                  Reset breaker
                </Button>
              </div>
            </div>

            {classTestResult && (
              <p className={`${styles.notice} ${styles.noticeSuccess}`}>
                Synthetic probe result: Category <strong>{classTestResult.category}</strong> via provider <strong>{classTestResult.provider}</strong> ({classTestResult.model}) in {classTestResult.latencyMs} ms.
              </p>
            )}

            <div className={styles.metricGrid}>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Calls in Window</span>
                <span className={styles.metricValue}>{classStatus.totalCalls} / {classStatus.maxWindowSize}</span>
                <span className={styles.metricHint}>Last 500 rolling calls</span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Clef Share</span>
                <span className={styles.metricValue}>{classStatus.clefShare}%</span>
                <span className={styles.metricHint}>{classStatus.countsByProvider?.clef || 0} Clef calls</span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Fallback Rate</span>
                <span className={`${styles.metricValue} ${classStatus.fallbackRateRatio > 0.2 ? styles.valueDanger : ''}`}>
                  {classStatus.fallbackRate}%
                </span>
                <span className={styles.metricHint}>{classStatus.fallbackCount} total fallbacks</span>
              </div>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Clef Latency (p50 / p95)</span>
                <span className={styles.metricValue}>
                  {classStatus.latency?.clef?.p50 !== null ? `${classStatus.latency.clef.p50} ms` : '—'}
                </span>
                <span className={styles.metricHint}>
                  p95: {classStatus.latency?.clef?.p95 !== null ? `${classStatus.latency.clef.p95} ms` : '—'}
                </span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Confirmation Dialog for Classification Provider Switch */}
      {classSwitchDialog && (
        <ReasonDialog
          title="Switch Classification Provider"
          who={classSwitchDialog === 'clef' ? 'Cloudflare Clef Flash (@cf/cloudflare/clef-flash)' : 'Google Gemini Flash-Lite'}
          body={`Are you sure you want to switch the runtime DM classification provider to ${classSwitchDialog}? This takes effect immediately without a redeploy.`}
          actionLabel={`Switch to ${classSwitchDialog}`}
          variant="primary"
          busy={classSwitchBusy}
          error={classSwitchError}
          onConfirm={handleConfirmSwitchClassification}
          onClose={() => { if (!classSwitchBusy) setClassSwitchDialog(null); }}
        />
      )}

      {/* ========================================================= */}
      {/* 4. General AI Models Allowlist & Activation (Gate 4)      */}
      {/* ========================================================= */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{c.current}: {label(catalogue, config.active)}</h2>
            <p className={styles.panelSubtitle}>
              {config.isDefault ? c.defaultNote : `${c.changedBy} ${config.updatedBy || '—'} · ${formatDateTime(config.updatedAt)}`}
            </p>
          </div>
          {config.previous && <Button size="sm" onClick={() => { setDialogError(''); setDialog('rollback'); }}>{c.rollback}</Button>}
        </div>
        <div className={styles.passwordForm}>
          <p className={styles.dialogBody}>{c.previous}: {label(catalogue, config.previous)}</p>
          <p className={styles.dialogBody}>
            {c.fallback}: {config.fallbackEnabled ? label(catalogue, config.fallback) : c.fallbackOff}
            {config.fallbackState?.active && ` — ${c.fallbackActive} ${formatDateTime(config.fallbackState.until)}`}
          </p>
          <ul className={styles.dialogBody}>
            {catalogue.map((p) => (
              <li key={p.id}>
                {p.name}: {p.keyConfigured ? <Badge tone="positive">{c.keyYes}</Badge> : <span className={styles.cellSub}>{c.keyNo} (<code>{p.envKey}</code>)</span>}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>{c.choose}</h2>
            <p className={styles.panelSubtitle}>{c.samplesNote}</p>
          </div>
        </div>
        <div className={styles.filters}>
          <Select aria-label={c.provider} value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }}>
            <option value="">{c.provider}</option>
            {usable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select aria-label={c.model} value={model} onChange={(e) => setModel(e.target.value)} disabled={!provider}>
            <option value="">{c.model}</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
          <Button size="sm" variant="primary" onClick={runTest} disabled={!key} loading={testing}>{testing ? c.testing : c.runTest}</Button>
        </div>

        {result && (
          <>
            <p className={`${styles.notice} ${result.allSchemaValid ? styles.noticeSuccess : styles.noticeError}`}>
              {result.allSchemaValid ? c.allValid : c.notAllValid}
            </p>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <thead>
                  <tr><th>{c.sample}</th><th>{c.expected}</th><th>{c.got}</th><th>{c.valid}</th><th>{c.latency}</th></tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.id}>
                      <td>{r.sample}</td>
                      <td className={styles.cellMono}>{r.expected}</td>
                      <td className={styles.cellMono}>{r.category || r.errorCode || '—'}</td>
                      <td>{r.schemaValid ? <Badge tone="positive">✓</Badge> : <Badge tone="danger">✗</Badge>}</td>
                      <td>{r.latencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result.allSchemaValid && (
              <div className={styles.passwordForm}>
                <label className={styles.dialogBody}>
                  <input type="checkbox" checked={fallbackOn} onChange={(e) => setFallbackOn(e.target.checked)} /> {c.fallbackEnable}
                </label>
                {fallbackOn && (passingFallbacks.length ? (
                  <Select aria-label={c.fallbackPick} value={fallbackKey} onChange={(e) => setFallbackKey(e.target.value)}>
                    <option value="">{c.fallbackPick}</option>
                    {passingFallbacks.map((r) => (
                      <option key={`${r.provider}/${r.model}`} value={`${r.provider}/${r.model}`}>{label(catalogue, r)}</option>
                    ))}
                  </Select>
                ) : <p className={styles.cellSub}>{c.fallbackTestFirst}</p>)}
                <p className={styles.cellSub}>{c.privacy}</p>
                <div>
                  <Button
                    variant="primary"
                    disabled={fallbackOn && !fallbackKey}
                    onClick={() => { setDialogError(''); setDialog('activate'); }}
                  >
                    {c.activate}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {dialog && (
        <ReasonDialog
          title={dialog === 'activate' ? c.activateTitle : c.rollbackTitle}
          who={dialog === 'activate' ? label(catalogue, { provider, model }) : label(catalogue, config.previous)}
          body={dialog === 'activate' ? c.activateBody : c.rollbackBody}
          actionLabel={dialog === 'activate' ? c.activate : c.rollback}
          variant="primary"
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onClose={() => { if (!busy) setDialog(null); }}
        />
      )}
    </div>
  );
}
