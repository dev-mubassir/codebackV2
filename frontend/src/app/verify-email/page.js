'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { verifyEmail, resendVerification } from '@/lib/api';
import Icon from '@/app/components/Icon';
import BrandLogo from '@/app/components/BrandLogo';
import { auth, legal } from '@/content/copy';
import styles from '../login/login.module.css';

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get('token') || '';

  const [state, setState] = useState(token ? 'verifying' : 'no-token');
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);

  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    verifyEmail(token)
      .then(() => setState('done'))
      .catch((err) => {
        setError(
          err.response?.data?.error ||
            'That confirmation link is no longer valid. Request a new one.'
        );
        setState('failed');
      });
  }, [token]);

  async function handleResend() {
    setError('');
    try {
      await resendVerification();
      setResent(true);
    } catch (err) {
      setError(
        err.response?.status === 401
          ? 'Log in first, then request a new confirmation email.'
          : err.response?.data?.error || 'Could not send that email. Try again.'
      );
    }
  }

  return (
    <div className={styles.authCard}>
      <div className={styles.authHeader}>
        <div className={styles.statusBadge}>
          <span className={styles.pulseDot} />
          <span>Email Verification</span>
        </div>
        <h1 className={styles.authTitle}>{auth.verifyEmail.title}</h1>
        {state === 'verifying' && (
          <p className={styles.authSubtitle}>Confirming your email address with Siffty...</p>
        )}
        {state === 'no-token' && (
          <p className={styles.authSubtitle}>{auth.verifyEmail.subtitle}</p>
        )}
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <Icon name="alertTriangle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {state === 'done' && (
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
          <p style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 600, color: '#10b981' }}>
            {auth.verifyEmail.success}
          </p>
          <p style={{ margin: '0 0 22px', fontSize: 13, color: '#6b7280' }}>
            Your email is now verified. You have full access to your Instagram DM workspace.
          </p>
          <Link href="/dashboard" className={styles.submitBtn} style={{ textDecoration: 'none' }}>
            Go to Your Dashboard
          </Link>
        </div>
      )}

      {(state === 'failed' || state === 'no-token') && (
        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          {resent ? (
            <p role="status" style={{ margin: '0 0 16px', fontSize: 14, color: '#10b981', fontWeight: 500 }}>
              Confirmation email sent. Check your inbox.
            </p>
          ) : (
            <button type="button" className={styles.submitBtn} onClick={handleResend}>
              <span>{auth.verifyEmail.resend}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
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
        <span>Official Instagram Graph API Partner</span>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className={styles.authContainer}>
      <div className={styles.bgGridOverlay} aria-hidden="true" />
      <div className={styles.ambientGlow} aria-hidden="true" />

      <Link href="/" className={styles.topBrandNav} title="Back to Siffty.com">
        <BrandLogo size={36} className={styles.topBrandLogo} />
        <span className={styles.topBrandTitle}>Siffty</span>
      </Link>

      <Suspense fallback={<div className={styles.authCard} />}>
        <VerifyEmailInner />
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
