'use client';

/**
 * Auto DM usage for this billing period: "6,240 / 10,000 this month" (or
 * "Unlimited*" on a plan shown that way), the automation count, and the
 * notices — 80% / 100% of the allowance, no active plan, automations paused
 * after a downgrade. Everything comes from GET /api/autodm/usage; no number is
 * hardcoded here.
 */

import { useEffect, useState } from 'react';
import { getAutoDmUsage } from '@/lib/autodmApi';
import { usage as t } from './copy';
import s from './autodm.module.css';

const n = (x) => Number(x || 0).toLocaleString('en-IN');
const day = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function Notices({ u }) {
  const items = [];
  if (u.notice === 'no_plan') items.push(['warn', t.noPlan(u.held)]);
  else if (u.notice === 'limit') items.push(['warn', t.limit(n(u.limit), day(u.periodEnd), u.held)]);
  else if (u.notice === 'warn80') items.push(['info', t.warn80(n(u.used), n(u.limit), day(u.periodEnd))]);
  if (u.pausedForLimit > 0) items.push(['info', t.pausedForLimit(u.pausedForLimit, n(u.maxAutomations))]);
  if (items.length === 0) return null;
  return items.map(([tone, text]) => (
    <p key={text} className={`${s.usageNotice} ${tone === 'warn' ? s.usageNoticeWarn : ''}`} role={tone === 'warn' ? 'alert' : 'status'}>
      {text}
    </p>
  ));
}

export default function UsageMeter({ refreshKey = 0 }) {
  const [u, setU] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getAutoDmUsage()
      .then((d) => { if (!cancelled) setU(d); })
      .catch(() => { if (!cancelled) setU(null); }); // the meter is optional; the page works without it
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (!u) return null;
  const unlimited = u.displayUnlimited;
  const pct = unlimited || !u.limit ? 0 : Math.min(100, Math.round((u.used / u.limit) * 100));
  const period = u.planCode === 'TRIAL' ? t.inTrial : t.thisMonth;

  return (
    <section className={s.usage} aria-label={t.label}>
      <div className={s.usageStats}>
        <div className={s.usageStat}>
          <span className={s.usageLabel}>{t.label}</span>
          <span className={s.usageValue}>
            {unlimited ? (
              <>{n(u.used)} {period} · <a href="/terms#fair-use" className={s.usageLink}>{t.unlimited}</a></>
            ) : (
              <>{n(u.used)} / {n(u.limit)} {period}</>
            )}
          </span>
          {!unlimited && (
            <span className={s.usageTrack} role="meter" aria-label={t.label} aria-valuenow={u.used} aria-valuemin={0} aria-valuemax={u.limit}>
              <span className={`${s.usageFill} ${pct >= 100 ? s.usageFillFull : ''}`} style={{ width: `${pct}%` }} />
            </span>
          )}
          <span className={s.usageSub}>{t.resets(day(u.periodEnd))}</span>
        </div>
        <div className={s.usageStat}>
          <span className={s.usageLabel}>{t.automations}</span>
          <span className={s.usageValue}>
            {n(u.activeAutomations)} / {unlimited ? t.unlimitedShort : n(u.maxAutomations)} {t.active}
          </span>
        </div>
      </div>
      <Notices u={u} />
    </section>
  );
}
