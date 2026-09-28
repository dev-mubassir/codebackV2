'use client';

/**
 * Admin — Auto DM rollout and limits. The rollout mode (OFF | BETA |
 * EVERYONE) decides who can use Auto DM; in BETA, only users granted here (or
 * on the AUTODM_SCOPE_ALLOWLIST env list) can. AUTODM_ENABLED on the server is
 * the kill switch over all of it.
 *
 * Limits: per-plan automation and Auto DM allowances, and the enforcement
 * switch (OFF: usage is counted and shown, nothing is blocked — keep it OFF
 * until billing is enabled). A grant can carry "No limits" (testers, the Meta
 * reviewer): counted, never blocked.
 *
 * Mode, enforcement and plan-limit changes ask for a reason and the password
 * again (step-up); EVERYONE also asks for an explicit confirmation. Grants,
 * revokes and "No limits" ask for a note / reason. Everything is written to the
 * admin audit log. Revoking stops that user's automations at once and deletes
 * nothing.
 */

import { useEffect, useState } from 'react';
import { Badge, Button, Input, Modal, Select, Skeleton, srOnly } from '@/app/components/ui';
import { formatDateTime } from '@/content/format';
import {
  getAutoDmAdmin,
  grantAutoDm,
  revokeAutoDm,
  setAutoDmMode,
  setAutoDmEnforcement,
  setAutoDmPlanLimits,
  setAutoDmNoLimits,
} from '@/lib/autodmAdminApi';
import ReasonDialog from '../_components/ReasonDialog';
import { StepUpCancelled, useStepUp } from '../_components/StepUp';
import styles from '../admin.module.css';
import s from './autodm-admin.module.css';

const MODE_LABELS = {
  OFF: 'Off — nobody',
  BETA: 'Beta — granted users only',
  EVERYONE: 'Everyone',
};

const ENFORCEMENT_LABELS = {
  OFF: 'Off — count usage, block nothing',
  ON: 'On — hold Auto DMs over the limit',
};

const n = (x) => Number(x || 0).toLocaleString('en-IN');
const errorOf = (err, fallback) => (typeof err === 'string' ? err : err?.response?.data?.error || fallback);

function dialogFor(pending) {
  switch (pending.kind) {
    case 'mode':
      return { title: `Change rollout mode to ${MODE_LABELS[pending.mode]}`, body: 'You will be asked for your password again.', action: 'Change mode', variant: 'primary' };
    case 'enforcement':
      return {
        title: `Turn limit enforcement ${pending.mode === 'ON' ? 'on' : 'off'}`,
        body:
          pending.mode === 'ON'
            ? 'Auto DMs over a plan’s allowance, and for users without an active plan, will be held (for up to 7 days). You will be asked for your password again.'
            : 'Held Auto DMs are released within a few minutes. Usage is still counted. You will be asked for your password again.',
        action: pending.mode === 'ON' ? 'Turn on' : 'Turn off',
        variant: 'primary',
      };
    case 'plan':
      return {
        title: `Change ${pending.name} limits`,
        body: `${n(pending.values.maxAutomations)} automations, ${n(pending.values.monthlyDms)} Auto DMs per period${pending.values.displayUnlimited ? ', shown as Unlimited*' : ''}. Pricing cards update at once. You will be asked for your password again.`,
        action: 'Save limits',
        variant: 'primary',
      };
    case 'noLimits':
      return {
        title: pending.value ? 'Give this user no limits' : 'Remove no limits',
        who: pending.grant.email,
        body: pending.value ? 'Their usage is still counted, but never blocked (testers, the Meta reviewer).' : 'Their plan’s limits apply again.',
        action: pending.value ? 'No limits' : 'Remove',
        variant: 'primary',
      };
    default:
      return {
        title: 'Revoke Auto DM access',
        who: pending.grant.email,
        body: 'Their automations stop at once. Nothing is deleted; granting again resumes them. "No limits" is removed too.',
        action: 'Revoke',
        variant: 'danger',
      };
  }
}

export default function AdminAutoDmPage() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [modeDraft, setModeDraft] = useState('');
  const [enforcementDraft, setEnforcementDraft] = useState('');
  const [confirmEveryone, setConfirmEveryone] = useState(false);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [noLimits, setNoLimits] = useState(false);
  const [grantError, setGrantError] = useState('');
  const [granting, setGranting] = useState(false);
  const [editing, setEditing] = useState(null); // plan limits being edited
  const [editError, setEditError] = useState('');
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
  const enforcement = data ? data.enforcement : 'OFF';
  const selectedEnforcement = enforcementDraft || enforcement;

  function askMode() {
    setDialogError('');
    if (selected === 'EVERYONE') setConfirmEveryone(true);
    else setPending({ kind: 'mode', mode: selected });
  }

  function savePlanDraft(e) {
    e.preventDefault();
    const maxAutomations = Number(editing.maxAutomations);
    const monthlyDms = Number(editing.monthlyDms);
    if (!Number.isInteger(maxAutomations) || maxAutomations < 0 || !Number.isInteger(monthlyDms) || monthlyDms < 0) {
      setEditError('Use whole numbers, 0 or more.');
      return;
    }
    setDialogError('');
    setPending({ kind: 'plan', planCode: editing.planCode, name: editing.name, values: { maxAutomations, monthlyDms, displayUnlimited: editing.displayUnlimited } });
    setEditing(null);
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
      } else if (pending.kind === 'enforcement') {
        await withStepUp(() => setAutoDmEnforcement(pending.mode, reason));
        setNotice(`Limit enforcement is now ${pending.mode === 'ON' ? 'on' : 'off'}.`);
        setEnforcementDraft('');
      } else if (pending.kind === 'plan') {
        await withStepUp(() => setAutoDmPlanLimits(pending.planCode, pending.values, reason));
        setNotice(`${pending.name} limits saved.`);
      } else if (pending.kind === 'noLimits') {
        await setAutoDmNoLimits(pending.grant.userId, pending.value, reason);
        setNotice(pending.value ? `${pending.grant.email} now has no limits.` : `${pending.grant.email} is back on their plan's limits.`);
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
      await grantAutoDm(email.trim(), note.trim(), noLimits);
      setNotice(`Auto DM access granted to ${email.trim()}${noLimits ? ', with no limits' : ''}.`);
      setEmail('');
      setNote('');
      setNoLimits(false);
      await load();
    } catch (err) {
      setGrantError(errorOf(err, "Couldn't grant access. Try again."));
    } finally {
      setGranting(false);
    }
  }

  if (!data && !loadError) return <div className={styles.loading}><Skeleton lines={6} height={40} /></div>;
  const dialog = pending ? dialogFor(pending) : null;

  return (
    <div className={styles.stack}>
      <p className={styles.pageLeadText}>
        Who can use Auto DM (comment-to-DM), and how much. The server switch AUTODM_ENABLED overrides everything on this page.
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
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>Limits</h2></div>
            <div className={s.body}>
              <div className={s.facts}>
                <span>Enforcement:</span>
                <Badge tone={enforcement === 'ON' ? 'accent' : 'neutral'}>{ENFORCEMENT_LABELS[enforcement]}</Badge>
                {data.enforcementUpdatedAt && <span>changed {formatDateTime(data.enforcementUpdatedAt)}</span>}
              </div>
              <div className={s.modeRow}>
                <Select label="Enforcement" className={s.modeSelect} value={selectedEnforcement} onChange={(e) => setEnforcementDraft(e.target.value)}>
                  {data.enforcementModes.map((m) => <option key={m} value={m}>{ENFORCEMENT_LABELS[m] || m}</option>)}
                </Select>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={selectedEnforcement === enforcement}
                  onClick={() => { setDialogError(''); setPending({ kind: 'enforcement', mode: selectedEnforcement }); }}
                >
                  Change
                </Button>
              </div>
              <p className={s.hint}>
                Keep enforcement off until billing is enabled (after Meta approval). Off still counts every Auto DM, so the numbers below are real either way.
              </p>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Plan</th>
                    <th scope="col" className={styles.alignRight}>Active automations</th>
                    <th scope="col" className={styles.alignRight}>Auto DMs per period</th>
                    <th scope="col">Shown as</th>
                    <th scope="col">Source</th>
                    <th scope="col" className={styles.alignRight}><span className={srOnly}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.planLimits.map((p) => (
                    <tr key={p.planCode}>
                      <td>
                        {p.name}
                        <div className={styles.cellSub}>{p.planCode} · {p.cycleLengthDays}-day period</div>
                      </td>
                      <td className={`${styles.alignRight} ${s.num}`}>{n(p.maxAutomations)}</td>
                      <td className={`${styles.alignRight} ${s.num}`}>{n(p.monthlyDms)}</td>
                      <td>{p.displayUnlimited ? 'Unlimited*' : 'Numbers'}</td>
                      <td><Badge tone={p.source === 'custom' ? 'accent' : 'neutral'}>{p.source === 'custom' ? 'Edited' : 'Default'}</Badge></td>
                      <td className={styles.alignRight}>
                        <div className={styles.rowActions}>
                          <Button
                            size="sm"
                            onClick={() => {
                              setEditError('');
                              setEditing({ planCode: p.planCode, name: p.name, maxAutomations: String(p.maxAutomations), monthlyDms: String(p.monthlyDms), displayUnlimited: p.displayUnlimited });
                            }}
                          >
                            Edit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`${s.hint} ${s.tableNote}`}>A plan without edits uses the launch defaults; Enterprise uses Pro&apos;s until you set it.</p>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>Beta access</h2></div>
            <div className={s.body}>
              <form className={s.grantForm} onSubmit={submitGrant}>
                <Input label="User email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required />
                <Input label="Note (why)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Beta tester" />
                <Button variant="primary" size="sm" type="submit" loading={granting} disabled={!email.trim()}>Grant access</Button>
              </form>
              <label className={s.check}>
                <input type="checkbox" checked={noLimits} onChange={(e) => setNoLimits(e.target.checked)} /> No limits (tester / Meta reviewer)
              </label>
              {grantError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert"><span className={styles.noticeText}>{grantError}</span></div>}
              <p className={s.hint}>The person must already have a Siffty account. Access only matters while the mode is Beta; &quot;No limits&quot; applies in every mode.</p>
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
                      <th scope="col">Limits</th>
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
                        <td>{g.noLimits ? <Badge tone="accent">No limits</Badge> : <Badge tone="neutral">Plan</Badge>}</td>
                        <td className={`${styles.alignRight} ${s.num}`}>{g.counts.automations}</td>
                        <td className={`${styles.alignRight} ${s.num}`}>{g.counts.dmsSent}</td>
                        <td className={`${styles.alignRight} ${s.num}`}>{g.counts.failures}</td>
                        <td className={styles.alignRight}>
                          <div className={styles.rowActions}>
                            <Button size="sm" onClick={() => { setDialogError(''); setPending({ kind: 'noLimits', grant: g, value: !g.noLimits }); }}>
                              {g.noLimits ? 'Use plan limits' : 'No limits'}
                            </Button>
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

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2 className={styles.panelTitle}>Usage this period</h2></div>
            {data.usage.length === 0 ? (
              <p className={s.empty}>No Auto DMs sent yet.</p>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col">Plan</th>
                      <th scope="col">Period from</th>
                      <th scope="col" className={styles.alignRight}>Auto DMs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.usage.map((u) => (
                      <tr key={u.userId}>
                        <td>
                          {u.email || u.userId}
                          {u.noLimits && <div className={styles.cellSub}>No limits</div>}
                        </td>
                        <td>{u.planCode || '—'}</td>
                        <td className={styles.cellSub}>{formatDateTime(u.periodStart)}</td>
                        <td className={`${styles.alignRight} ${s.num}`}>
                          {n(u.used)} / {u.displayUnlimited ? 'Unlimited*' : n(u.limit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={`${s.hint} ${s.tableNote}`}>The 50 highest this period. 1 Auto DM = 1 person who received the first DM.</p>
          </section>
        </>
      )}

      {editing && (
        <Modal
          title={`${editing.name} — Auto DM limits`}
          onClose={() => setEditing(null)}
          actions={(
            <>
              <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" variant="primary" type="submit" form="autodm-plan-limits">Continue</Button>
            </>
          )}
        >
          <form id="autodm-plan-limits" className={s.editForm} onSubmit={savePlanDraft}>
            <Input
              label="Active automations"
              type="number"
              min="0"
              step="1"
              value={editing.maxAutomations}
              onChange={(e) => setEditing({ ...editing, maxAutomations: e.target.value })}
              required
            />
            <Input
              label="Auto DMs per billing period"
              type="number"
              min="0"
              step="1"
              value={editing.monthlyDms}
              onChange={(e) => setEditing({ ...editing, monthlyDms: e.target.value })}
              required
            />
            <label className={s.check}>
              <input
                type="checkbox"
                checked={editing.displayUnlimited}
                onChange={(e) => setEditing({ ...editing, displayUnlimited: e.target.checked })}
              />{' '}
              Show as &quot;Unlimited*&quot; on pricing (the numbers above still apply as fair use)
            </label>
            {editError && <p className={s.formError} role="alert">{editError}</p>}
          </form>
        </Modal>
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
            this after Meta has approved instagram_business_manage_comments. The &quot;Coming soon&quot; badges on the
            landing and pricing pages disappear within a minute.
          </p>
        </Modal>
      )}

      {pending && (
        <ReasonDialog
          title={dialog.title}
          who={dialog.who}
          body={dialog.body}
          actionLabel={dialog.action}
          variant={dialog.variant}
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
