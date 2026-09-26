'use client';

/**
 * Admin — system health (Gate 3).
 *
 * One GET /api/admin/health every 30 seconds. That poll is a GET, so it does
 * not count as admin activity: an unattended health page still times out
 * after 30 idle minutes, as it should. Counts, timings and statuses only.
 */

import { useCallback, useEffect, useState } from 'react';
import { getAdminHealth, runAdminAiTest } from '@/lib/api';
import { Badge, Button, Skeleton } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import { formatCount, formatDateTime } from '@/content/format';
import styles from '../admin.module.css';

const REFRESH_MS = 30 * 1000;
const h = t.health;

const pct = (x) => (typeof x === 'number' ? `${(x * 100).toFixed(1)}%` : '—');
const ms = (x) => (typeof x === 'number' ? `${Math.round(x)} ms` : '—');
const usd = (x) => (typeof x === 'number' ? `$${x.toFixed(4)}` : '—');

function duration(seconds) {
  if (typeof seconds !== 'number') return '—';
  const d = Math.floor(seconds / 86400);
  const hr = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`;
}

function Metric({ label, value, hint, danger }) {
  return (
    <div className={styles.metricCard}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.metricValue} ${danger ? styles.valueDanger : ''}`}>{value}</span>
      {hint && <span className={styles.metricHint}>{hint}</span>}
    </div>
  );
}

const sc = h.scaling;
const storeLabel = (v) => (v ? sc.values[v] || v : '—');

function redisStatus(r) {
  if (r.error) return { tone: 'danger', label: sc.unavailable };
  if (!r.configured) return { tone: 'neutral', label: sc.notConfigured };
  return r.connected ? { tone: 'positive', label: sc.healthy } : { tone: 'danger', label: sc.unavailable };
}

/**
 * Redis & scaling: whether the instances share state, and through what. An
 * older backend reports neither `redis` nor pool counts, so the card is left
 * out rather than drawn as a row of dashes; a failed probe ({ error: true })
 * still renders, as Unavailable.
 */
function ScalingPanel({ redis, database }) {
  const pool = typeof database?.activeConnections === 'number' && typeof database?.maxConnections === 'number'
    ? database : null;
  if (!redis && !pool) return null;
  const r = redis && !redis.error ? redis : {};
  const status = redis ? redisStatus(redis) : null;
  const inProcess = r.scheduler?.inProcess;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.panelTitle}>{h.sections.scaling}</h2>
          <p className={styles.panelSubtitle}>{sc.subtitle}</p>
        </div>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
      </div>
      <div className={styles.metricGrid}>
        {redis && (
          <>
            <Metric label={sc.ping} value={ms(r.pingMs)} danger={r.configured && !r.connected} />
            <Metric label={sc.adapter} value={storeLabel(r.socketAdapter)} />
            <Metric label={sc.sessions} value={storeLabel(r.sessionStore)} />
            <Metric label={sc.queue} value={storeLabel(r.queueDriver)} />
            <Metric label={sc.rateLimit} value={storeLabel(r.rateLimitStore)} />
            <Metric
              label={sc.scheduler}
              value={typeof inProcess === 'boolean' ? (inProcess ? sc.schedulerHere : sc.schedulerElsewhere) : '—'}
            />
          </>
        )}
        {pool && (
          <Metric
            label={sc.dbConnections}
            value={`${formatCount(pool.activeConnections)} / ${formatCount(pool.maxConnections)}`}
            hint={sc.dbConnectionsHint}
            danger={pool.maxConnections > 0 && pool.activeConnections / pool.maxConnections >= 0.9}
          />
        )}
      </div>
    </section>
  );
}

function AiWindow({ title, s }) {
  if (!s || s.error) return <Metric label={title} value="—" />;
  return (
    <Metric
      label={title}
      value={`${formatCount(s.calls)} ${h.ai.calls.toLowerCase()}`}
      hint={`${h.ai.errorRate} ${pct(s.errorRate)} · ${h.ai.p95} ${ms(s.p95LatencyMs)} · ${h.ai.cost} ${usd(s.estimatedCostUsd)}`}
      danger={s.errorRate > 0.2}
    />
  );
}

export default function AdminHealthPage() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [test, setTest] = useState({ busy: false, result: null });

  const load = useCallback(async () => {
    try {
      setHealth(await getAdminHealth());
      setError('');
    } catch {
      setError(errors.admin.stats);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) await load();
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [load]);

  async function handleTest() {
    setTest({ busy: true, result: null });
    try {
      setTest({ busy: false, result: await runAdminAiTest() });
    } catch {
      setTest({ busy: false, result: { ok: false, errorCode: 'REQUEST_FAILED' } });
    }
  }

  if (!health && !error) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;

  const p = health?.process || {};
  const ai = health?.ai || {};
  const tokens = health?.instagramTokens || {};

  return (
    <div className={styles.stack}>
      {error && (
        <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
          <span className={styles.noticeText}>{error}</span>
        </div>
      )}

      {health && (
        <>
          <p className={styles.pageLeadText}>
            {h.refreshed} {formatDateTime(health.generatedAt)}. {h.autoRefresh}
          </p>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{h.sections.server}</h2></div>
            <div className={styles.metricGrid}>
              <Metric label={h.server.uptime} value={duration(p.uptimeSeconds)} />
              <Metric label={h.server.memory} value={`${p.memoryMb?.rss ?? '—'} MB`} hint={`heap ${p.memoryMb?.heapUsed ?? '—'} / ${p.memoryMb?.heapTotal ?? '—'} MB`} />
              <Metric label={h.server.loop} value={ms(p.eventLoopLagMs?.p99)} danger={p.eventLoopLagMs?.p99 > 200} />
              {p.unhandledRejections && (
                <Metric
                  label={h.server.unhandled}
                  value={String(p.unhandledRejections.last10m)}
                  hint={h.server.unhandledHint(p.unhandledRejections.sinceBoot)}
                  danger={p.unhandledRejections.last10m > 0}
                />
              )}
              <Metric label={h.server.db} value={health.database?.ok ? ms(health.database.pingMs) : h.server.dbDown} danger={!health.database?.ok} />
              <Metric label={h.server.sockets} value={formatCount(health.sockets?.connectedClients)} />
              <Metric
                label={h.server.webhooks}
                value={formatCount(health.webhooks?.received24h)}
                hint={`${h.server.lastWebhook}: ${health.webhooks?.lastReceivedAt ? formatDateTime(health.webhooks.lastReceivedAt) : h.never}`}
              />
              <Metric label={h.server.email} value={formatCount(health.email?.failures24h)} danger={health.email?.failures24h > 0} />
            </div>
          </section>

          <ScalingPanel redis={health.redis} database={health.database} />

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2 className={styles.panelTitle}>{h.sections.ai}</h2>
                <p className={styles.panelSubtitle}>{h.estimated}</p>
              </div>
              <Button size="sm" onClick={handleTest} loading={test.busy}>{test.busy ? h.ai.testing : h.ai.test}</Button>
            </div>
            {test.result && (
              <p className={`${styles.notice} ${test.result.ok ? styles.noticeSuccess : styles.noticeError}`} role="status">
                {test.result.ok
                  ? `${test.result.provider} / ${test.result.model} ${h.ai.testOk} ${ms(test.result.latencyMs)}`
                  : `${h.ai.testFailed} ${test.result.errorCode}`}
              </p>
            )}
            <div className={styles.metricGrid}>
              <AiWindow title={h.ai.lastHour} s={ai.lastHour} />
              <AiWindow title={h.ai.lastDay} s={ai.last24Hours} />
              <Metric label={h.ai.active} value={ai.active?.primaryProvider || h.none} hint={`${h.ai.lastModel}: ${ai.active?.lastSuccessfulModel || h.none}`} />
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{h.sections.jobs}</h2></div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <thead>
                  <tr><th>{h.jobs.name}</th><th>{h.jobs.lastRun}</th><th>{h.jobs.status}</th></tr>
                </thead>
                <tbody>
                  {(Array.isArray(health.jobs) ? health.jobs : []).map((j) => (
                    <tr key={j.jobName}>
                      <td className={styles.cellMono}>{j.jobName}</td>
                      <td>{formatDateTime(j.startedAt)}</td>
                      <td>
                        {j.success === true && <Badge tone="positive">{h.jobs.ok}</Badge>}
                        {j.success === false && <Badge tone="danger">{h.jobs.failed}</Badge>}
                        {j.success == null && <Badge tone="neutral">{h.jobs.running}</Badge>}
                        {j.error && <div className={styles.cellSub}>{j.error}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>{h.sections.tokens}</h2>
              <span className={styles.panelMeta}>{formatCount(tokens.needsReconnect)} {h.tokens.reconnect}</span>
            </div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <thead>
                  <tr><th>{h.tokens.account}</th><th>{h.tokens.expires}</th><th>{h.tokens.status}</th></tr>
                </thead>
                <tbody>
                  {(tokens.expiringWithin7Days || []).length === 0 ? (
                    <tr><td colSpan="3" className={styles.cellEmpty}>{h.none}</td></tr>
                  ) : tokens.expiringWithin7Days.map((a) => (
                    <tr key={a.id}>
                      <td>@{a.igUsername || a.id}</td>
                      <td>{formatDateTime(a.tokenExpiresAt)}</td>
                      <td><Badge tone={a.tokenStatus === 'VALID' ? 'warning' : 'danger'}>{a.tokenStatus}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>{h.refresh.title}</h2>
              <span className={styles.panelMeta}>
                {h.refresh.lastOk}: {tokens.lastSuccessfulRefreshAt ? formatDateTime(tokens.lastSuccessfulRefreshAt) : h.never}
              </span>
            </div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <thead>
                  <tr><th>{h.tokens.account}</th><th>{h.refresh.failedAt}</th><th>{h.refresh.code}</th><th>{h.tokens.status}</th></tr>
                </thead>
                <tbody>
                  {(tokens.refreshFailures || []).length === 0 ? (
                    <tr><td colSpan="4" className={styles.cellEmpty}>{h.none}</td></tr>
                  ) : tokens.refreshFailures.map((a) => (
                    <tr key={a.id}>
                      <td>@{a.igUsername || a.id}</td>
                      <td>{formatDateTime(a.tokenRefreshFailedAt)}</td>
                      <td className={styles.cellMono}>{a.tokenRefreshError}</td>
                      <td><Badge tone={a.tokenStatus === 'VALID' ? 'warning' : 'danger'}>{a.tokenStatus}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>{h.sections.errors}</h2></div>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <thead>
                  <tr><th>{h.errors.when}</th><th>{h.errors.where}</th><th>{h.errors.what}</th></tr>
                </thead>
                <tbody>
                  {(health.recentErrors || []).length === 0 ? (
                    <tr><td colSpan="3" className={styles.cellEmpty}>{h.none}</td></tr>
                  ) : health.recentErrors.slice(0, 30).map((e, i) => (
                    <tr key={`${e.at}-${i}`}>
                      <td>{formatDateTime(e.at)}</td>
                      <td className={styles.cellMono}>{e.route || '—'}</td>
                      <td className={styles.cellMono}>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
