'use client';

/**
 * Staff sign-in.
 *
 * Admin rebuild (Gate 1): email + password against admin_users. The password
 * is sent exactly as typed — the old `password.trim()` silently changed
 * passwords that start or end with a space. `?expired=1` (set by the api.js
 * interceptor when the admin session times out) shows why the admin is here.
 *
 * Changed: ~30 inline style declarations and a raw rgba() became classes on
 * --ui tokens; the labels were not connected to their inputs (clicking a label
 * did nothing and screen readers announced unlabelled fields), they are now;
 * the card's drop shadow is gone (cards are flat everywhere else); the "ADMIN"
 * pill above a title that already says "Siffty admin" is replaced by the logo.
 */

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { adminLogin } from '@/lib/api';
import PasswordInput from '@/app/components/PasswordInput';
import { Button } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import styles from '../admin.module.css';

/**
 * Why the admin is back here. Its own component inside <Suspense>, as the
 * Next docs require for useSearchParams on a prerendered route.
 */
function ExpiredNotice() {
  const expired = useSearchParams().get('expired') === '1';
  return expired ? <p className={styles.loginError} role="status">{t.login.expired}</p> : null;
}

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await adminLogin(email.trim(), password);
      if (res && res.authenticated) {
        window.location.href = '/admin';
      } else {
        setError(res?.error || errors.admin.login);
      }
    } catch (err) {
      setError(err.response?.data?.error || errors.admin.login);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.loginPage}>
      <div className={styles.loginCard}>
        <div className={styles.loginHead}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/siffty-logo-sm.webp" alt="" className={styles.loginMark} width={36} height={36} />
          <h1 className={styles.loginTitle}>{t.login.title}</h1>
          <p className={styles.loginSub}>{t.login.subtitle}</p>
        </div>

        {!error && <Suspense fallback={null}><ExpiredNotice /></Suspense>}
        {error && <p className={styles.loginError} role="alert">{error}</p>}

        <form onSubmit={handleSubmit} autoComplete="off" className={styles.loginForm}>
          <div className={styles.field}>
            <label htmlFor="admin-email" className={styles.label}>{t.login.emailLabel}</label>
            <input
              id="admin-email"
              type="email"
              className={styles.control}
              placeholder={t.login.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="admin-password" className={styles.label}>{t.login.passwordLabel}</label>
            <PasswordInput
              id="admin-password"
              className={styles.control}
              placeholder={t.login.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <Button type="submit" variant="primary" block loading={submitting}>
            {submitting ? t.login.submitting : t.login.submit}
          </Button>
        </form>
      </div>
    </main>
  );
}
