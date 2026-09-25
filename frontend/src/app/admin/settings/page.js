'use client';

/**
 * Admin — administrators, your own password, and the server configuration.
 *
 * Admin rebuild (Gate 1): administrators are admin_users rows, created and
 * reset only by the owner-run scripts (see ADMIN.md) — there is no "add admin"
 * button by design. Changing your password here keeps this session and signs
 * out every other admin session.
 */

import { useEffect, useState } from 'react';
import { changeAdminPassword, getAdminSettings } from '@/lib/api';
import PasswordInput from '@/app/components/PasswordInput';
import { Button, Field, Skeleton } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import { formatDate, formatDateTime } from '@/content/format';
import styles from '../admin.module.css';

const MIN_PASSWORD = 16;

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { tone, text }
  const copy = t.settings.password;

  async function submit(e) {
    e.preventDefault();
    setResult(null);
    if (next.length < MIN_PASSWORD) return setResult({ tone: 'error', text: copy.tooShort });
    if (next !== confirm) return setResult({ tone: 'error', text: copy.mismatch });

    setBusy(true);
    try {
      await changeAdminPassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setResult({ tone: 'success', text: copy.done });
    } catch (err) {
      setResult({ tone: 'error', text: err?.response?.data?.error || copy.failed });
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{copy.title}</h2>
      </div>
      <form onSubmit={submit} className={styles.passwordForm}>
        <p className={styles.dialogBody}>{copy.body}</p>
        <Field label={copy.current} htmlFor="admin-current-password">
          <PasswordInput id="admin-current-password" className={styles.control} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Field label={copy.next} hint={copy.nextHint} htmlFor="admin-new-password">
          <PasswordInput id="admin-new-password" className={styles.control} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD} required />
        </Field>
        <Field label={copy.confirm} htmlFor="admin-confirm-password">
          <PasswordInput id="admin-confirm-password" className={styles.control} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </Field>
        {result && (
          <p
            className={`${styles.notice} ${result.tone === 'error' ? styles.noticeError : styles.noticeSuccess}`}
            role={result.tone === 'error' ? 'alert' : 'status'}
          >
            {result.text}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" loading={busy}>{copy.submit}</Button>
        </div>
      </form>
    </section>
  );
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadSettings() {
      try {
        setSettings(await getAdminSettings());
      } catch {
        setError(errors.admin.settings);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  if (loading) return <div className={styles.loading}><Skeleton lines={5} height={40} /></div>;

  if (error) {
    return (
      <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
        <span className={styles.noticeText}>{error}</span>
      </div>
    );
  }

  const env = settings?.environment || {};

  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{t.settings.adminsTitle}</h2>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t.settings.adminsColumns.email}</th>
                <th>{t.settings.adminsColumns.lastLogin}</th>
                <th>{t.settings.adminsColumns.passwordChanged}</th>
                <th>{t.settings.adminsColumns.created}</th>
              </tr>
            </thead>
            <tbody>
              {settings?.admins?.map((admin) => (
                <tr key={admin.id}>
                  <td className={styles.cellMono}>{admin.email}</td>
                  <td>{admin.lastLoginAt ? formatDateTime(admin.lastLoginAt) : '—'}</td>
                  <td>{formatDate(admin.passwordChangedAt)}</td>
                  <td>{formatDate(admin.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={`${styles.cellSub} ${styles.passwordForm}`}>{t.settings.adminsNote}</p>
      </section>

      <ChangePassword />

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{t.settings.environmentTitle}</h2>
        </div>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.tableCompact}`}>
            <tbody>
              <tr>
                <td className={styles.cellKey}>{t.settings.rows.frontendUrl}</td>
                <td className={styles.cellMono}>{env.frontendUrl}</td>
              </tr>
              <tr>
                <td className={styles.cellKey}>{t.settings.rows.nodeEnv}</td>
                <td className={styles.cellMono}>{env.nodeEnv}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
