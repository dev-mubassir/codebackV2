'use client';

import { useState } from 'react';
import Link from 'next/link';
import { forgotPassword, getGoogleAuthUrl } from '@/lib/api';
import Icon from '@/app/components/Icon';
import BrandLogo from '@/app/components/BrandLogo';
import GoogleIcon from '@/app/components/GoogleIcon';
import { auth, validation } from '@/content/copy';
import styles from '../login/login.module.css';

/**
 * Request a password reset link.
 *
 * This page shows the SAME confirmation whether or not the address has an
 * account, because the backend deliberately returns an identical response
 * either way. Rendering "no such account" here would hand back exactly the
 * account-enumeration oracle the endpoint was built to close.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [googleAccount, setGoogleAccount] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await forgotPassword(email);
      // A Google-only account has no password to reset. Showing the generic
      // "check your inbox" here left those users waiting for mail that was
      // never sent, with no way to discover why.
      if (res?.code === 'GOOGLE_ACCOUNT') {
        setGoogleAccount(true);
      } else {
        setSent(true);
      }
    } catch (err) {
      // 503 EMAIL_UNAVAILABLE lands here: the send genuinely failed, so the
      // honest answer is "we could not send it", not "check your inbox".
      setError(err.response?.data?.error || validation.genericError || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <div className={styles.authLogo}><BrandLogo size={40} /></div>
          <h1 className={styles.authTitle}>{auth.forgotPassword.title}</h1>
          <p className={styles.authSubtitle}>{auth.forgotPassword.subtitle}</p>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <Icon name="alertTriangle" size={14} />
            <span>{error}</span>
          </div>
        )}

        {googleAccount ? (
          <div role="status" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <p style={{ margin: '0 0 8px', fontSize: 15, lineHeight: 1.5 }}>
              This address signs in with Google.
            </p>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-tertiary)' }}>
              There is no password to reset — use Continue with Google instead.
            </p>
            <a
              href={getGoogleAuthUrl()}
              className={`btn btn-primary ${styles.submitBtn}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                minHeight: 40,
              }}
            >
              <GoogleIcon size={18} />
              <span>Continue with Google</span>
            </a>
          </div>
        ) : sent ? (
          <div role="status" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <p style={{ margin: '0 0 20px', fontSize: 15, lineHeight: 1.5 }}>
              {auth.forgotPassword.sent}
            </p>
            <Link href="/login" className={styles.authLink}>
              {auth.sessionExpired.action}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            <button type="submit" className={`btn btn-primary ${styles.submitBtn}`} disabled={loading}>
              {loading ? '…' : auth.forgotPassword.submit}
            </button>
          </form>
        )}

        <div className={styles.authFooter}>
          <Link href="/login" className={styles.authLink}>Back to log in</Link>
        </div>
      </div>
    </div>
  );
}
