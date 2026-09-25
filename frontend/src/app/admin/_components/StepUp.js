'use client';

/**
 * Step-up: destructive admin actions need the admin password re-entered within
 * the last five minutes. The backend enforces it (403 STEP_UP_REQUIRED); this
 * provider is only the UI half.
 *
 *   const { withStepUp, ensureStepUp } = useStepUp();
 *
 *   withStepUp(() => pruneWebhookLogs(30, reason))
 *     Runs the action. If the backend asks for step-up, shows the password
 *     dialog and retries the action ONCE after a successful confirm.
 *
 *   ensureStepUp()
 *     For actions the page cannot retry itself — a CSV download is a browser
 *     navigation, not an XHR — confirms first when the window is not open.
 *
 * Both reject with StepUpCancelled if the admin closes the dialog.
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { adminStepUp, getAdminMe } from '@/lib/api';
import PasswordInput from '@/app/components/PasswordInput';
import { Button, Field, Modal } from '@/app/components/ui';
import { admin as t, common } from '@/content/copy';
import styles from '../admin.module.css';

export class StepUpCancelled extends Error {
  constructor() {
    super('Step-up cancelled');
    this.name = 'StepUpCancelled';
  }
}

const StepUpContext = createContext(null);

const needsStepUp = (err) => err?.response?.status === 403 && err.response.data?.code === 'STEP_UP_REQUIRED';

export function StepUpProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(null); // { resolve, reject }

  const prompt = useCallback(
    () =>
      new Promise((resolve, reject) => {
        pending.current = { resolve, reject };
        setPassword('');
        setError('');
        setOpen(true);
      }),
    []
  );

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    pending.current?.reject(new StepUpCancelled());
    pending.current = null;
  }, [busy]);

  async function confirm(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminStepUp(password);
      setOpen(false);
      setPassword('');
      pending.current?.resolve();
      pending.current = null;
    } catch (err) {
      setError(err?.response?.data?.code === 'STEP_UP_FAILED' ? t.stepUp.wrong : err?.response?.data?.error || t.stepUp.failed);
    } finally {
      setBusy(false);
    }
  }

  const withStepUp = useCallback(
    async (action) => {
      try {
        return await action();
      } catch (err) {
        if (!needsStepUp(err)) throw err;
        await prompt();
        return action();
      }
    },
    [prompt]
  );

  const ensureStepUp = useCallback(async () => {
    const me = await getAdminMe();
    const until = me.stepUpValidUntil ? Date.parse(me.stepUpValidUntil) : 0;
    // A little margin so the window cannot close between here and the request.
    if (until - Date.now() > 15 * 1000) return;
    await prompt();
  }, [prompt]);

  return (
    <StepUpContext.Provider value={{ withStepUp, ensureStepUp }}>
      {children}
      {open && (
        <Modal
          title={t.stepUp.title}
          onClose={close}
          actions={(
            <>
              <Button size="sm" onClick={close} disabled={busy}>{common.cancel}</Button>
              <Button size="sm" variant="primary" type="submit" form="admin-step-up" loading={busy}>
                {t.stepUp.action}
              </Button>
            </>
          )}
        >
          <form id="admin-step-up" onSubmit={confirm} className={styles.dialogForm}>
            <p className={styles.dialogBody}>{t.stepUp.body}</p>
            <Field label={t.stepUp.label} htmlFor="admin-step-up-password" error={error}>
              <PasswordInput
                id="admin-step-up-password"
                className={styles.control}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
          </form>
        </Modal>
      )}
    </StepUpContext.Provider>
  );
}

export function useStepUp() {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp must be used inside <StepUpProvider>.');
  return ctx;
}
