'use client';

/**
 * Admin — AI provider (Gate 4).
 *
 * Pick a provider + model from the server's allowlist (only providers whose
 * key is configured), test it on 10 synthetic messages, then activate it —
 * with a written reason and a password step-up — or roll back in one click.
 * The page never sees or sends an API key: the server shows only whether
 * each provider's key is configured.
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
} from '@/lib/api';
import { Badge, Button, Select, Skeleton } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import { formatDateTime } from '@/content/format';
import ReasonDialog from '../_components/ReasonDialog';
import { StepUpCancelled, useStepUp } from '../_components/StepUp';
import styles from '../admin.module.css';

const c = t.ai;
const usd = (x) => (typeof x === 'number' ? `$${x.toFixed(2)}` : '—');
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

  const load = useCallback(async () => {
    try {
      setConfig(await getAdminAiConfig());
    } catch {
      setError(errors.admin.settings);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAdminAiConfig()
      .then((data) => { if (!cancelled) setConfig(data); })
      .catch(() => { if (!cancelled) setError(errors.admin.settings); });
    return () => { cancelled = true; };
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

  useEffect(() => {
    let timer = null;
    let active = true;

    async function poll() {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const data = await getAdminClassificationStatus();
        if (active) {
          setClassStatus(data);
          setClassError('');
          setClassLoading(false);
        }
      } catch {
        if (active) setClassError('Could not load classification status.');
      }
    }

    poll();
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

  async function handleConfirmSwitchProvider(reason) {
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

  async function handleRunClassificationTest() {
    setClassTesting(true);
    setClassTestResult(null);
    try {
      const res = await testAdminClassification();
      setClassTestResult(res);
      setNotice({
        tone: 'success',
        text: `Classification test completed via ${res.provider}: ${res.category} (${res.latencyMs} ms).`,
      });
      await loadClassification();
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.error || 'Classification test failed.' });
    } finally {
      setClassTesting(false);
    }
  }

  async function handleResetBreaker() {
    setClassResetting(true);
    try {
      const res = await resetAdminClassificationBreaker('Admin manual reset');
      setClassStatus(res.stats);
      setNotice({ tone: 'success', text: 'Circuit breaker reset successfully.' });
    } catch (err) {
      setNotice({ tone: 'error', text: err?.response?.data?.error || 'Could not reset circuit breaker.' });
    } finally {
      setClassResetting(false);
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
      await load();
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

  return (
    <div className={styles.stack}>
      {notice && (
        <p className={`${styles.notice} ${notice.tone === 'error' ? styles.noticeError : styles.noticeSuccess}`} role="status">{notice.text}</p>
      )}

      {/* ========================================================= */}
      {/* DM Classification Section (Cloudflare Clef Flash)        */}
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
            {/* Provider Controls & Action Buttons */}
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
                  onClick={handleResetBreaker}
                  disabled={!classStatus.circuitBreaker?.isOpen}
                  loading={classResetting}
                >
                  Reset breaker
                </Button>
              </div>
            </div>

            {/* Test result display */}
            {classTestResult && (
              <p className={`${styles.notice} ${styles.noticeSuccess}`}>
                Synthetic probe result: Category <strong>{classTestResult.category}</strong> via provider <strong>{classTestResult.provider}</strong> ({classTestResult.model}) in {classTestResult.latencyMs} ms.
              </p>
            )}

            {/* Metric Row */}
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
                  {classStatus.latency?.gemini?.p50 !== null && ` · Gemini p50: ${classStatus.latency.gemini.p50} ms`}
                </span>
              </div>
            </div>

            {/* Operational Status */}
            <div className={styles.passwordForm}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--ui-space-3)' }}>
                <div>
                  <span className={styles.metricLabel}>Credentials</span>
                  <div>
                    {classStatus.credentialsPresent ? (
                      <Badge tone="positive">Present</Badge>
                    ) : (
                      <Badge tone="danger">Absent</Badge>
                    )}
                    <span className={styles.cellSub} style={{ marginLeft: 'var(--ui-space-2)' }}>
                      CLOUDFLARE_ACCOUNT_ID / TOKEN
                    </span>
                  </div>
                </div>

                <div>
                  <span className={styles.metricLabel}>Circuit Breaker</span>
                  <div>
                    <Badge tone={classStatus.circuitBreaker?.isOpen ? 'danger' : 'positive'}>
                      {classStatus.circuitBreaker?.state || 'CLOSED'}
                    </Badge>
                    {classStatus.circuitBreaker?.isOpen && (
                      <span className={styles.cellSub} style={{ marginLeft: 'var(--ui-space-2)' }}>
                        Retry in {classStatus.circuitBreaker?.secondsUntilRetry}s
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <span className={styles.metricLabel}>In-Flight Concurrency</span>
                  <div style={{ fontSize: 'var(--ui-text-base)', fontWeight: 600, color: 'var(--ui-ink)' }}>
                    {classStatus.concurrency?.inFlight || 0} / {classStatus.concurrency?.maxConcurrency || 5} active
                  </div>
                </div>

                <div>
                  <span className={styles.metricLabel}>Last Clef Success</span>
                  <div className={styles.cellSub}>
                    {classStatus.lastClefSuccessAt ? formatDateTime(classStatus.lastClefSuccessAt) : 'None recorded'}
                  </div>
                </div>
              </div>

              {/* Fallback Reasons Table */}
              <div style={{ marginTop: 'var(--ui-space-3)' }}>
                <span className={styles.metricLabel}>Fallback Reasons Breakdown</span>
                {classStatus.totalCalls === 0 ? (
                  <p className={styles.cellSub}>No calls since the last restart</p>
                ) : Object.keys(classStatus.fallbackReasons || {}).length === 0 ? (
                  <p className={styles.cellSub}>No fallbacks recorded in the current window.</p>
                ) : (
                  <div className={styles.tableScroll} style={{ marginTop: 'var(--ui-space-2)' }}>
                    <table className={`${styles.table} ${styles.tableCompact}`}>
                      <thead>
                        <tr>
                          <th>Reason</th>
                          <th>Count</th>
                          <th>Share of Calls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(classStatus.fallbackReasons).map(([reason, count]) => (
                          <tr key={reason}>
                            <td className={styles.cellMono}>{reason}</td>
                            <td>{count}</td>
                            <td>{((count / classStatus.totalCalls) * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <p className={styles.cellSub} style={{ marginTop: 'var(--ui-space-2)' }}>
                Note: In-memory metrics and rolling window reset when the backend process restarts.
              </p>
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
          onConfirm={handleConfirmSwitchProvider}
          onClose={() => { if (!classSwitchBusy) setClassSwitchDialog(null); }}
        />
      )}

      {/* ========================================================= */}
      {/* Text Generation Models Section (Existing Gemini Router)  */}
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
            <p className={styles.dialogBody}>
              {c.cost}: {result.cost.classifications30d > 0
                ? `${c.costCurrent} ${usd(result.cost.currentMonthlyUsd)} · ${c.costCandidate} ${usd(result.cost.candidateMonthlyUsd)}`
                : c.noVolume}{' '}
              ({usd(result.cost.candidatePer1000Usd)} {c.costPer1000})
            </p>

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
