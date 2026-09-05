'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { resetPassword } from '@/lib/api';
import Icon from '@/app/components/Icon';
import PasswordInput from '@/app/components/PasswordInput';
import { auth, validation } from '@/content/copy';
import styles from '../login/login.module.css';

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(validation.passwordsDoNotMatch || 'Those passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await resetPassword({ token, password, confirmPassword });
      setDone(true);
      // Completing a reset invalidates every session for this account,
      // including any this browser already had, so the only sensible next
      // step is a fresh login.
      setTimeout(() => router.push('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'That reset link is no longer valid. Request a new one.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <h1 className={styles.authTitle}>{auth.resetPassword.title}</h1>
        </div>
        <div className={styles.errorBanner} role="alert">
          <Icon name="alertTriangle" size={14} />
          <span>That reset link is not valid. Request a new one.</span>
        </div>
        <div className={styles.authFooter}>
          <Link href="/forgot-password" className={styles.authLink}>Request a new link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.authCard}>
      <div className={styles.authHeader}>
        <div className={styles.authLogo}><Icon name="zap" size={20} /></div>
        <h1 className={styles.authTitle}>{auth.resetPassword.title}</h1>
        <p className={styles.authSubtitle}>{auth.resetPassword.subtitle}</p>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <Icon name="alertTriangle" size={14} />
          <span>{error}</span>
        </div>
      )}

      {done ? (
        <div role="status" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 15 }}>{auth.resetPassword.success}</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-tertiary)' }}>
            Any other devices signed into this account have been logged out.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="password">New password</label>
            <PasswordInput
              id="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              autoFocus
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="confirmPassword">Confirm new password</label>
            <PasswordInput
              id="confirmPassword"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className={`btn btn-primary ${styles.submitBtn}`} disabled={loading}>
            {loading ? '…' : auth.resetPassword.submit}
          </button>
        </form>
      )}

      <div className={styles.authFooter}>
        <Link href="/login" className={styles.authLink}>Back to log in</Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <div className={styles.authContainer}>
      <Suspense fallback={<div className={styles.authCard} />}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
