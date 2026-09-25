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
import { activateAdminAiModel, getAdminAiConfig, rollbackAdminAiModel, testAdminAiModel } from '@/lib/api';
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
