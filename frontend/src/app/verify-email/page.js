'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { verifyEmail, resendVerification } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { auth } from '@/content/copy';
import styles from '../login/login.module.css';

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get('token') || '';

  const [state, setState] = useState(token ? 'verifying' : 'no-token');
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);

  // React 18 StrictMode mounts effects twice in development. The token is
  // single-use, so a second POST would consume it and report "no longer
  // valid" on a link that had just worked. The ref makes the call once.
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
      // A logged-out visitor cannot resend — the endpoint is authenticated so
      // it cannot be used to mailbomb a third party.
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
        <div className={styles.authLogo}><Icon name="zap" size={20} /></div>
        <h1 className={styles.authTitle}>{auth.verifyEmail.title}</h1>
        {state === 'verifying' && (
          <p className={styles.authSubtitle}>Confirming your address…</p>
        )}
        {state === 'no-token' && (
          <p className={styles.authSubtitle}>{auth.verifyEmail.subtitle}</p>
        )}
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <Icon name="alertTriangle" size={14} />
          <span>{error}</span>
        </div>
      )}

      {state === 'done' && (
        <div role="status" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <p style={{ margin: '0 0 20px', fontSize: 15 }}>{auth.verifyEmail.success}</p>
          <Link href="/dashboard" className={styles.authLink}>Go to your dashboard</Link>
        </div>
      )}

      {(state === 'failed' || state === 'no-token') && (
        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          {resent ? (
            <p role="status" style={{ margin: 0, fontSize: 15 }}>
              Confirmation email sent. Check your inbox.
            </p>
          ) : (
            <button type="button" className={`btn btn-primary ${styles.submitBtn}`} onClick={handleResend}>
              {auth.verifyEmail.resend}
            </button>
          )}
        </div>
      )}

      <div className={styles.authFooter}>
        <Link href="/login" className={styles.authLink}>Back to log in</Link>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className={styles.authContainer}>
      <Suspense fallback={<div className={styles.authCard} />}>
        <VerifyEmailInner />
      </Suspense>
    </div>
  );
}
