'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { resetPassword } from '@/lib/api';
import Icon from '@/app/components/Icon';
import BrandLogo from '@/app/components/BrandLogo';
import PasswordInput from '@/app/components/PasswordInput';
import { auth, validation, legal } from '@/content/copy';
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
          <div className={styles.statusBadge}>
            <span className={styles.pulseDot} />
            <span>Link Invalid</span>
          </div>
          <h1 className={styles.authTitle}>{auth.resetPassword.title}</h1>
        </div>
        <div className={styles.errorBanner} role="alert">
          <Icon name="alertTriangle" size={16} />
          <span>That reset link is not valid or has expired. Request a new one below.</span>
        </div>
        <div className={styles.authFooter}>
          <Link href="/forgot-password" className={styles.authLink}>Request a new password reset link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.authCard}>
      <div className={styles.authHeader}>
        <div className={styles.statusBadge}>
          <span className={styles.pulseDot} />
          <span>Security Verification</span>
        </div>
        <h1 className={styles.authTitle}>{auth.resetPassword.title}</h1>
        <p className={styles.authSubtitle}>{auth.resetPassword.subtitle}</p>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <Icon name="alertTriangle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {done ? (
        <div role="status" style={{ textAlign: 'center', padding: '12px 0 6px' }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.1)',
            color: '#10b981',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 14
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600, color: '#10b981' }}>
            {auth.resetPassword.success}
          </p>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>
            All previous device sessions have been invalidated. Redirecting you to sign in...
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className={styles.authForm}>
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
              placeholder="••••••••••••"
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
              placeholder="••••••••••••"
            />
          </div>

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? (
              <span>Saving password...</span>
            ) : (
              <>
                <span>{auth.resetPassword.submit}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </form>
      )}

      <div className={styles.authFooter}>
        <Link href="/login" className={styles.authLink}>← Back to log in</Link>
      </div>

      {/* Security Seal */}
      <div className={styles.securitySeal}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>End-to-end encrypted session renewal</span>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className={styles.authContainer}>
      <div className={styles.bgGridOverlay} aria-hidden="true" />
      <div className={styles.ambientGlow} aria-hidden="true" />

      <Link href="/" className={styles.topBrandNav} title="Back to Siffty.com">
        <BrandLogo size={36} className={styles.topBrandLogo} />
        <span className={styles.topBrandTitle}>Siffty</span>
      </Link>

      <Suspense fallback={<div className={styles.authCard} />}>
        <ResetPasswordForm />
      </Suspense>

      <nav aria-label="Legal" className={styles.legalNav}>
        <Link href="/privacy" className={styles.legalLink}>{legal.footerLinks.privacy}</Link>
        <Link href="/terms" className={styles.legalLink}>{legal.footerLinks.terms}</Link>
        <Link href="/data-deletion" className={styles.legalLink}>{legal.footerLinks.dataDeletion}</Link>
        <Link href="/support" className={styles.legalLink}>{legal.footerLinks.support}</Link>
      </nav>
    </div>
  );
}
