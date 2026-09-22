'use client';

import { useState } from 'react';
import Link from 'next/link';
import { forgotPassword, getGoogleAuthUrl } from '@/lib/api';
import Icon from '@/app/components/Icon';
import BrandLogo from '@/app/components/BrandLogo';
import GoogleIcon from '@/app/components/GoogleIcon';
import { auth, validation, legal } from '@/content/copy';
import styles from '../login/login.module.css';

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
      if (res?.code === 'GOOGLE_ACCOUNT') {
        setGoogleAccount(true);
      } else {
        setSent(true);
      }
    } catch (err) {
      setError(err.response?.data?.error || validation.genericError || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.authContainer}>
      {/* Background Decorative Grid & Ambient Cones */}
      <div className={styles.bgGridOverlay} aria-hidden="true" />
      <div className={styles.ambientGlow} aria-hidden="true" />

      {/* Top Brand Link */}
      <Link href="/" className={styles.topBrandNav} title="Back to Siffty.com">
        <BrandLogo size={36} className={styles.topBrandLogo} />
        <span className={styles.topBrandTitle}>Siffty</span>
      </Link>

      {/* Auth Card */}
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <div className={styles.statusBadge}>
            <span className={styles.pulseDot} />
            <span>Password Recovery</span>
          </div>
          <h1 className={styles.authTitle}>{auth.forgotPassword.title}</h1>
          <p className={styles.authSubtitle}>{auth.forgotPassword.subtitle}</p>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <Icon name="alertTriangle" size={16} />
            <span>{error}</span>
          </div>
        )}

        {googleAccount ? (
          <div role="status" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <p style={{ margin: '0 0 8px', fontSize: 15, lineHeight: 1.5, color: '#1f2937', fontWeight: 600 }}>
              This address signs in with Google.
            </p>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>
              There is no password to reset — use Continue with Google instead.
            </p>
            <a
              href={getGoogleAuthUrl()}
              className={styles.googleBtn}
            >
              <GoogleIcon size={18} />
              <span>Continue with Google</span>
            </a>
          </div>
        ) : sent ? (
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
            <p style={{ margin: '0 0 14px', fontSize: 15, lineHeight: 1.5, color: '#1f2937' }}>
              {auth.forgotPassword.sent}
            </p>
            <p style={{ margin: '0 0 22px', fontSize: 13, color: '#6b7280' }}>
              Didn't receive the email? Check your spam folder or try again in a few minutes.
            </p>
            <Link href="/login" className={styles.submitBtn} style={{ textDecoration: 'none' }}>
              Back to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.authForm}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                className="input"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? (
                <span>Sending link...</span>
              ) : (
                <>
                  <span>{auth.forgotPassword.submit}</span>
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
          <span>Verified recovery link • Valid for 1 hour</span>
        </div>
      </div>

      {/* Bottom Legal Navigation */}
      <nav aria-label="Legal" className={styles.legalNav}>
        <Link href="/privacy" className={styles.legalLink}>{legal.footerLinks.privacy}</Link>
        <Link href="/terms" className={styles.legalLink}>{legal.footerLinks.terms}</Link>
        <Link href="/data-deletion" className={styles.legalLink}>{legal.footerLinks.dataDeletion}</Link>
        <Link href="/support" className={styles.legalLink}>{legal.footerLinks.support}</Link>
      </nav>
    </div>
  );
}
