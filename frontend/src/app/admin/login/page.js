'use client';

/**
 * Staff sign-in.
 *
 * Submit logic is master's, unchanged — including `password.trim()`, which
 * strips spaces a password may legitimately contain. That is auth behaviour,
 * so it is reported rather than changed here.
 *
 * Changed: ~30 inline style declarations and a raw rgba() became classes on
 * --ui tokens; the labels were not connected to their inputs (clicking a label
 * did nothing and screen readers announced unlabelled fields), they are now;
 * the card's drop shadow is gone (cards are flat everywhere else); the "ADMIN"
 * pill above a title that already says "Siffty admin" is replaced by the logo.
 */

import { useState } from 'react';
import { adminLogin } from '@/lib/api';
import PasswordInput from '@/app/components/PasswordInput';
import { Button } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
import styles from '../admin.module.css';

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await adminLogin(username.trim(), password.trim());
      if (res && res.success) {
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

        {error && <p className={styles.loginError} role="alert">{error}</p>}

        <form onSubmit={handleSubmit} autoComplete="off" className={styles.loginForm}>
          <div className={styles.field}>
            <label htmlFor="admin-username" className={styles.label}>{t.login.usernameLabel}</label>
            <input
              id="admin-username"
              type="text"
              className={styles.control}
              placeholder={t.login.usernamePlaceholder}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
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
              autoComplete="new-password"
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
