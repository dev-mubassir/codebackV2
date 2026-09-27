'use client';

/**
 * Auto DM — run log: the last 50 comments one automation answered, and what
 * was sent to each person. Auto DM's own DMs are not in the inbox (they never
 * enter the messages table), so this is where they are visible.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/app/components/ui/AppShell';
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '@/app/components/ui';
import { formatDateTime } from '@/content/format';
import { createSocket } from '@/lib/socket';
import { getAutomation, getAutomationRuns, apiErrorMessage } from '@/lib/autodmApi';
import useAutoDmPage from '@/app/components/autodm/useAutoDmPage';
import { autodm, RUN_STATUS, runNote } from '@/app/components/autodm/copy';
import s from '@/app/components/autodm/autodm.module.css';

const t = autodm.runs;

function sentItems(run) {
  const items = [];
  if (run.publicReplyAt) items.push(t.sent.publicReply);
  if (run.openerSentAt) items.push(t.sent.opener);
  if (run.followChecks > 0) items.push(t.sent.followChecks(run.followChecks));
  if (run.mainImageSentAt) items.push(t.sent.image);
  if (run.deliveredAt) items.push(t.sent.link);
  return items;
}

function RunsContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const { user, state } = useAutoDmPage();
  const [automation, setAutomation] = useState(null);
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [a, r] = await Promise.all([getAutomation(id), getAutomationRuns(id)]);
      setAutomation(a);
      setRuns(r);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, autodm.loadError));
    }
  }, [id]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useEffect(() => {
    if (state !== 'ready' || !id) return undefined;
    let cancelled = false;
    Promise.all([getAutomation(id), getAutomationRuns(id)])
      .then(([a, r]) => {
        if (cancelled) return;
        setAutomation(a);
        setRuns(r);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, autodm.loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [state, id]);

  useEffect(() => {
    if (state !== 'ready' || !id) return undefined;
    const socket = createSocket();
    const bump = (evt) => {
      if (evt && evt.automationId !== id) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 1000);
    };
    socket.on('autodm:run_created', bump);
    socket.on('autodm:run_updated', bump);
    return () => {
      clearTimeout(timer.current);
      socket.disconnect();
    };
  }, [state, id, load]);

  let body;
  if (state === 'loading') body = <Skeleton lines={6} height={40} />;
  else if (state === 'error') body = <ErrorState message={autodm.loadError} onRetry={() => window.location.reload()} />;
  else if (state === 'unavailable') body = <EmptyState title={autodm.unavailable.title} body={autodm.unavailable.body} />;
  else if (error || !id) body = <ErrorState message={error || autodm.loadError} onRetry={id ? onRefresh : undefined} />;
  else if (runs === null) body = <Skeleton lines={6} height={40} />;
  else if (runs.length === 0) body = <EmptyState title={t.empty.title} body={t.empty.body} />;
  else {
    body = (
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">{t.columns.commenter}</th>
              <th scope="col">{t.columns.comment}</th>
              <th scope="col">{t.columns.status}</th>
              <th scope="col">{t.columns.sent}</th>
              <th scope="col">{t.columns.time}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const status = RUN_STATUS[run.status] || { label: run.status, tone: 'neutral' };
              const note = runNote(run.lastError);
              const sent = sentItems(run);
              return (
                <tr key={run.id}>
                  <td>{run.commenterUsername ? `@${run.commenterUsername}` : <span className={s.muted}>—</span>}</td>
                  <td className={s.commentCell}>
                    {run.commentText || <span className={s.muted}>—</span>}
                    {run.source === 'poll' && <span className={s.note}>{t.viaPoll}</span>}
                  </td>
                  <td>
                    <Badge tone={status.tone} size="sm">{status.label}</Badge>
                    {note && <span className={s.note}>{note}</span>}
                  </td>
                  <td>
                    {sent.length ? (
                      <ul className={s.sentList}>{sent.map((x) => <li key={x}>{x}</li>)}</ul>
                    ) : (
                      <span className={s.muted}>—</span>
                    )}
                  </td>
                  <td className={s.muted}><time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <AppShell
      user={user}
      title={automation ? automation.name : t.title}
      activeRoute="/autodm"
      actions={state === 'ready' && id ? <Button size="sm" onClick={onRefresh} loading={refreshing}>{t.refresh}</Button> : null}
    >
      <Link href={automation ? `/autodm?account=${encodeURIComponent(automation.instagramAccountId)}` : '/autodm'} className={s.backLink}>
        {t.back}
      </Link>
      <header className={s.pageHead}>
        <p className={s.pageSub}>{t.sub}</p>
      </header>
      {body}
    </AppShell>
  );
}

export default function RunsPage() {
  return (
    <Suspense fallback={null}>
      <RunsContent />
    </Suspense>
  );
}
