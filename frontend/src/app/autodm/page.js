'use client';

/**
 * Auto DM — the automations of one Instagram account, with live run counts.
 *
 * States, in order: not available to this user (feature off or not yet
 * rolled out) → no Instagram account → account without the comments scope
 * ("Reconnect Instagram") → no automations yet → the list.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/app/components/ui/AppShell';
import { Button, EmptyState, ErrorState, Modal, Select, Skeleton, Toggle } from '@/app/components/ui';
import { getInstagramAuthUrl } from '@/lib/api';
import { createSocket } from '@/lib/socket';
import { listAutomations, setAutomationStatus, deleteAutomation, apiErrorMessage } from '@/lib/autodmApi';
import useAutoDmPage from '@/app/components/autodm/useAutoDmPage';
import { autodm as t } from '@/app/components/autodm/copy';
import s from '@/app/components/autodm/autodm.module.css';

function ReconnectPanel({ title, body, action }) {
  return (
    <section className={s.panel}>
      <h2 className={s.panelTitle}>{title}</h2>
      <p className={s.panelBody}>{body}</p>
      <Button variant="primary" onClick={() => { window.location.href = getInstagramAuthUrl(); }}>
        {action}
      </Button>
    </section>
  );
}

function AutomationRow({ a, onToggle, onDelete, busy }) {
  const router = useRouter();
  const c = a.counts || {};
  const scope = a.postScope === 'SPECIFIC' ? t.scope.specific(a.mediaIds.length) : t.scope.any;
  const trigger = a.triggerType === 'KEYWORDS' ? t.trigger.keywords(a.keywords) : t.trigger.any;
  const cells = [
    ['matched', c.matched],
    ['dmsSent', c.dmsSent],
    ['delivered', c.delivered],
    ['waitingFollow', c.waitingFollow],
    ['failed', c.failed],
  ];
  return (
    <li className={s.row}>
      <div className={s.rowMain}>
        <span className={s.rowName}>{a.name}</span>
        <span className={s.rowMeta}>{scope} · {trigger}</span>
        <Toggle
          checked={a.status === 'active'}
          disabled={busy}
          onChange={(v) => onToggle(a, v)}
          label={a.status === 'active' ? t.active : t.paused}
        />
      </div>
      <div className={s.counts}>
        {cells.map(([key, value]) => (
          <div key={key} className={s.count}>
            <span className={s.countValue}>{typeof value === 'number' ? value : 0}</span>
            <span className={s.countLabel}>{t.columns[key]}</span>
          </div>
        ))}
      </div>
      <div className={s.rowActions}>
        <Button size="sm" onClick={() => router.push(`/autodm/runs?id=${encodeURIComponent(a.id)}`)}>{t.actions.runs}</Button>
        <Button size="sm" onClick={() => router.push(`/autodm/edit?id=${encodeURIComponent(a.id)}`)}>{t.actions.edit}</Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(a)}>{t.actions.delete}</Button>
      </div>
    </li>
  );
}

function AutoDmListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, state, accounts } = useAutoDmPage();
  const [chosenId, setChosenId] = useState('');
  const [listState, setListState] = useState({ accountId: null, items: null });
  const [listError, setListError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const refreshTimer = useRef(null);

  const connected = useMemo(() => accounts.filter((a) => a.connectionStatus === 'CONNECTED'), [accounts]);
  const wanted = searchParams.get('account');
  const accountId =
    (connected.some((a) => a.id === chosenId) && chosenId) ||
    (connected.some((a) => a.id === wanted) && wanted) ||
    (connected[0] && connected[0].id) ||
    '';
  const account = connected.find((a) => a.id === accountId) || null;
  // The list on screen always belongs to the selected account.
  const automations = listState.accountId === accountId ? listState.items : null;
  const setAutomations = (update) =>
    setListState((st) => ({ accountId: st.accountId, items: typeof update === 'function' ? update(st.items) : update }));

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const items = await listAutomations(accountId);
      setListState({ accountId, items });
      setListError('');
    } catch (err) {
      setListError(apiErrorMessage(err, t.loadError));
    }
  }, [accountId]);

  useEffect(() => {
    if (!account || !account.ready) return undefined;
    let cancelled = false;
    listAutomations(account.id)
      .then((items) => {
        if (cancelled) return;
        setListState({ accountId: account.id, items });
        setListError('');
      })
      .catch((err) => {
        if (!cancelled) setListError(apiErrorMessage(err, t.loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  // Live counts: any run change for this user refreshes the list (debounced).
  useEffect(() => {
    if (!account || !account.ready) return undefined;
    const socket = createSocket();
    const bump = () => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(load, 1500);
    };
    socket.on('autodm:run_created', bump);
    socket.on('autodm:run_updated', bump);
    return () => {
      clearTimeout(refreshTimer.current);
      socket.disconnect();
    };
  }, [account, load]);

  async function onToggle(a, active) {
    setBusyId(a.id);
    setActionError('');
    try {
      await setAutomationStatus(a.id, active ? 'active' : 'paused');
      setAutomations((list) => list.map((x) => (x.id === a.id ? { ...x, status: active ? 'active' : 'paused' } : x)));
    } catch (err) {
      setActionError(apiErrorMessage(err, t.toggleError));
    } finally {
      setBusyId(null);
    }
  }

  async function onConfirmDelete() {
    const a = confirmDelete;
    setConfirmDelete(null);
    setActionError('');
    try {
      await deleteAutomation(a.id);
      setAutomations((list) => list.filter((x) => x.id !== a.id));
    } catch (err) {
      setActionError(apiErrorMessage(err, t.deleteError));
    }
  }

  const canCreate = Boolean(account && account.ready);
  const createButton = canCreate ? (
    <Button variant="primary" size="sm" onClick={() => router.push(`/autodm/new?account=${encodeURIComponent(account.id)}`)}>
      {t.create}
    </Button>
  ) : null;

  let body;
  if (state === 'loading') {
    body = <Skeleton lines={4} height={72} />;
  } else if (state === 'error') {
    body = <ErrorState message={t.loadError} onRetry={() => window.location.reload()} />;
  } else if (state === 'unavailable') {
    body = <EmptyState title={t.unavailable.title} body={t.unavailable.body} />;
  } else if (connected.length === 0) {
    body = <ReconnectPanel title={t.noAccount.title} body={t.noAccount.body} action={t.noAccount.action} />;
  } else if (!account) {
    body = <Skeleton lines={4} height={72} />;
  } else if (!account.ready) {
    body = <ReconnectPanel title={t.reconnect.title} body={t.reconnect.body} action={t.reconnect.action} />;
  } else if (listError) {
    body = <ErrorState message={listError} onRetry={load} />;
  } else if (automations === null) {
    body = <Skeleton lines={4} height={72} />;
  } else if (automations.length === 0) {
    body = <EmptyState title={t.empty.title} body={t.empty.body} action={createButton} />;
  } else {
    body = (
      <ul className={s.list}>
        {automations.map((a) => (
          <AutomationRow key={a.id} a={a} busy={busyId === a.id} onToggle={onToggle} onDelete={setConfirmDelete} />
        ))}
      </ul>
    );
  }

  return (
    <AppShell user={user} title={t.pageTitle} activeRoute="/autodm" actions={automations && automations.length ? createButton : null}>
      <header className={s.pageHead}>
        <p className={s.pageSub}>{t.pageSub}</p>
        {state === 'ready' && connected.length > 1 && (
          <div className={s.headControls}>
            <Select
              label={t.account}
              className={s.accountSelect}
              value={accountId}
              onChange={(e) => setChosenId(e.target.value)}
            >
              {connected.map((a) => (
                <option key={a.id} value={a.id}>@{a.igUsername || a.id}</option>
              ))}
            </Select>
          </div>
        )}
      </header>

      {actionError && <p className={s.errNote} role="alert">{actionError}</p>}
      {body}

      {confirmDelete && (
        <Modal
          title={t.deleteConfirm.title}
          onClose={() => setConfirmDelete(null)}
          actions={(
            <>
              <Button onClick={() => setConfirmDelete(null)}>{t.deleteConfirm.cancel}</Button>
              <Button variant="danger" onClick={onConfirmDelete}>{t.deleteConfirm.confirm}</Button>
            </>
          )}
        >
          <p className={s.panelBody}>{t.deleteConfirm.body}</p>
        </Modal>
      )}
    </AppShell>
  );
}

export default function AutoDmPage() {
  return (
    <Suspense fallback={null}>
      <AutoDmListContent />
    </Suspense>
  );
}
