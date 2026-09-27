'use client';

/**
 * Admin — Auto DM rollout. The rollout mode (OFF | BETA | EVERYONE) decides
 * who can use Auto DM; in BETA, only users granted here (or on the
 * AUTODM_SCOPE_ALLOWLIST env list) can. AUTODM_ENABLED on the server is the
 * kill switch over all of it.
 *
 * Mode changes ask for a reason and the password again (step-up); EVERYONE
 * also asks for an explicit confirmation. Grants and revokes ask for a note /
 * reason. Everything is written to the admin audit log. Revoking stops that
 * user's automations at once and deletes nothing.
 */

import { useEffect, useState } from 'react';
import { Badge, Button, Input, Modal, Select, Skeleton, srOnly } from '@/app/components/ui';
import { formatDateTime } from '@/content/format';
import { getAutoDmAdmin, grantAutoDm, revokeAutoDm, setAutoDmMode } from '@/lib/autodmAdminApi';
import ReasonDialog from '../_components/ReasonDialog';
import { StepUpCancelled, useStepUp } from '../_components/StepUp';
import styles from '../admin.module.css';
import s from './autodm-admin.module.css';

const MODE_LABELS = {
  OFF: 'Off — nobody',
  BETA: 'Beta — granted users only',
  EVERYONE: 'Everyone',
};

const errorOf = (err, fallback) => (typeof err === 'string' ? err : err?.response?.data?.error || fallback);

export default function AdminAutoDmPage() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [modeDraft, setModeDraft] = useState('');
  const [confirmEveryone, setConfirmEveryone] = useState(false);
  const [pending, setPending] = useState(null); // { kind: 'mode', mode } | { kind: 'revoke', grant }
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [grantError, setGrantError] = useState('');
  const [granting, setGranting] = useState(false);
  const { withStepUp } = useStepUp();

  const load = () =>
    getAutoDmAdmin()
      .then((d) => { setData(d); setLoadError(''); })
      .catch(() => setLoadError("Couldn't load Auto DM settings. Refresh to try again."));

  useEffect(() => {
    let cancelled = false;
    getAutoDmAdmin()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setLoadError("Couldn't load Auto DM settings. Refresh to try again."); });
    return () => { cancelled = true; };
  }, []);

  const mode = data ? data.mode : 'OFF';
  const selected = modeDraft || mode;

  function askMode() {
    setDialogError('');
    if (selected === 'EVERYONE') setConfirmEveryone(true);
    else setPending({ kind: 'mode', mode: selected });
  }

  async function confirm(reason) {
    setBusy(true);
    setDialogError('');
    try {
      if (pending.kind === 'mode') {
        const m = pending.mode;
        await withStepUp(() => setAutoDmMode(m, reason, m === 'EVERYONE' ? 'EVERYONE' : undefined));
        setNotice(`Rollout mode is now ${MODE_LABELS[m]}.`);
        setModeDraft('');
      } else {
        await revokeAutoDm(pending.grant.userId, reason);
        setNotice(`Auto DM access removed for ${pending.grant.email}. Their automations stop at once; nothing was deleted.`);
      }
      setPending(null);
      await load();
    } catch (err) {
      if (!(err instanceof StepUpCancelled)) setDialogError(errorOf(err, "Couldn't save that. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function submitGrant(e) {
    e.preventDefault();
    setGrantError('');
    if (note.trim().length < 3) {
      setGrantError('Add a short note (at least 3 characters) saying why.');
      return;
    }
    setGranting(true);
    try {
      await grantAutoDm(email.trim(), note.trim());
      setNotice(`Auto DM access granted to ${email.trim()}.`);
      setEmail('');
      setNote('');
      await load();
    } catch (err) {
      setGrantError(errorOf(err, "Couldn't grant access. Try again."));
    } finally {
      setGranting(false);
    }
  }

  if (!data && !loadError) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;

  return (
    <div className={styles.stack}>
      <p className={styles.pageLeadText}>
        Who can use Auto DM (comment-to-DM). The server switch AUTODM_ENABLED overrides everything on this page.
      </p>
      {loadError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{loadError}</span></div>}
      {notice && <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status"><span className={styles.noticeText}>{notice}</span></div>}

      {data && (
        <>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>Rollout</h2></div>
            <div className={s.body}>
              <div className={s.facts}>
                <span>Server switch (AUTODM_ENABLED):</span>
                <Badge tone={data.killSwitchOn ? 'positive' : 'warning'}>{data.killSwitchOn ? 'On' : 'Off — Auto DM is off for everyone'}</Badge>
                <span>Current mode:</span>
                <Badge tone={mode === 'OFF' ? 'neutral' : 'accent'}>{MODE_LABELS[mode]}</Badge>
                {data.modeUpdatedAt && <span>changed {formatDateTime(data.modeUpdatedAt)}</span>}
              </div>
              <div className={s.modeRow}>
                <Select label="Rollout mode" className={s.modeSelect} value={selected} onChange={(e) => setModeDraft(e.target.value)}>
                  {data.modes.map((m) => <option key={m} value={m}>{MODE_LABELS[m] || m}</option>)}
                </Select>
                <Button variant="primary" size="sm" disabled={selected === mode} onClick={askMode}>Change mode</Button>
              </div>
              <p className={s.hint}>
                Beta also admits the {data.envAllowlistCount} email(s) on the server&apos;s AUTODM_SCOPE_ALLOWLIST. Comment polling: {data.pollMode}.
              </p>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>Beta access</h2></div>
            <div className={s.body}>
              <form className={s.grantForm} onSubmit={submitGrant}>
                <Input label="User email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required />
                <Input label="Note (why)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Beta tester" />
                <Button variant="primary" size="sm" type="submit" loading={granting} disabled={!email.trim()}>Grant access</Button>
              </form>
              {grantError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{grantError}</span></div>}
              <p className={s.hint}>The person must already have a Siffty account. Access only matters while the mode is Beta.</p>
            </div>
            {data.grants.length === 0 ? (
              <p className={s.empty}>Nobody has been granted access yet.</p>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col">Note</th>
                      <th scope="col">Granted</th>
                      <th scope="col" className={styles.alignRight}>Automations</th>
                      <th scope="col" className={styles.alignRight}>DMs sent</th>
                      <th scope="col" className={styles.alignRight}>Failures</th>
                      <th scope="col" className={styles.alignRight}><span className={srOnly}>Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.grants.map((g) => (
                      <tr key={g.userId}>
                        <td>
                          {g.email}
                          {g.name && <div className={styles.cellSub}>{g.name}</div>}
                        </td>
                        <td>{g.note || '—'}</td>
                        <td className={styles.cellSub}>{formatDateTime(g.grantedAt)}</td>
                        <td className={`${styles.alignRight} ${s.num}`}>{g.counts.automations}</td>
                        <td className={`${styles.alignRight} ${s.num}`}>{g.counts.dmsSent}</td>
                        <td className={`${styles.alignRight} ${s.num}`}>{g.counts.failures}</td>
                        <td className={styles.alignRight}>
                          <div className={styles.rowActions}>
                            <Button size="sm" variant="danger" onClick={() => { setDialogError(''); setPending({ kind: 'revoke', grant: g }); }}>
                              Revoke
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {confirmEveryone && (
        <Modal
          title="Turn Auto DM on for everyone?"
          onClose={() => setConfirmEveryone(false)}
          actions={(
            <>
              <Button size="sm" onClick={() => setConfirmEveryone(false)}>Cancel</Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => { setConfirmEveryone(false); setPending({ kind: 'mode', mode: 'EVERYONE' }); }}
              >
                Yes, everyone
              </Button>
            </>
          )}
        >
          <p className={s.hint}>
            Every Siffty user will see Auto DM, and their next Instagram connect will ask for comment access. Only do
            this after Meta has approved instagram_business_manage_comments.
          </p>
        </Modal>
      )}

      {pending && (
        <ReasonDialog
          title={pending.kind === 'mode' ? `Change rollout mode to ${MODE_LABELS[pending.mode]}` : 'Revoke Auto DM access'}
          who={pending.kind === 'revoke' ? pending.grant.email : undefined}
          body={
            pending.kind === 'mode'
              ? 'You will be asked for your password again.'
              : 'Their automations stop at once. Nothing is deleted; granting again resumes them.'
          }
          actionLabel={pending.kind === 'mode' ? 'Change mode' : 'Revoke'}
          variant={pending.kind === 'mode' ? 'primary' : 'danger'}
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
