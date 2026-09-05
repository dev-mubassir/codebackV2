'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Icon from '@/app/components/Icon';
import { errors } from '@/content/copy';
import { resendVerification, getMe } from '@/lib/api';

/**
 * Renders the `?error=` code the backend redirected with.
 *
 * WHY THIS EXISTS. The backend emits 19 distinct error codes across the
 * Instagram and Google flows. Only five had copy, and only the landing page
 * read the param at all — so a redirect to /profile, /dashboard, /login or
 * /register produced a page that reloaded and said nothing. The user saw a
 * blank bounce and had no way to know what happened or what to do.
 *
 * `email_unverified` additionally gets a real action, because knowing the
 * problem is not the same as being able to fix it: it shows the address the
 * mail is going to (so a typo at registration is visible) and a resend button.
 */
function AuthErrorBannerInner({ onDismiss }) {
  const params = useSearchParams();
  const code = params.get('error');

  const [address, setAddress] = useState(null);
  const [resendState, setResendState] = useState('idle'); // idle | sending | sent | failed
  const [resendError, setResendError] = useState('');

  const needsVerification = code === 'email_unverified';

  useEffect(() => {
    // Show WHICH address the link goes to — a typo at registration is
    // otherwise invisible and unfixable from here.
    if (!needsVerification) return;
    getMe()
      .then((me) => setAddress(me?.email || null))
      .catch(() => setAddress(null));
  }, [needsVerification]);

  if (!code) return null;

  const message = errors.oauthCallback[code] || errors.oauthCallback.generic;

  async function handleResend() {
    setResendState('sending');
    setResendError('');
    try {
      await resendVerification();
      setResendState('sent');
    } catch (err) {
      // While the sending domain is unverified this is a 503 EMAIL_UNAVAILABLE.
      // Surface it honestly — claiming success would leave the user waiting for
      // mail that was never sent, which is the whole failure mode being fixed.
      setResendState('failed');
      setResendError(
        err.response?.data?.error ||
          'We could not send that email just now. Try again shortly.'
      );
    }
  }

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '12px 14px',
        marginBottom: 16,
        borderRadius: 10,
        background: 'var(--color-error-bg, #fef2f2)',
        border: '1px solid var(--color-error-border, #fecaca)',
        color: 'var(--color-error-text, #991b1b)',
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <span style={{ flexShrink: 0, marginTop: 2 }}>
        <Icon name="alertTriangle" size={15} />
      </span>

      <div style={{ flex: 1 }}>
        <div>{message}</div>

        {needsVerification && (
          <div style={{ marginTop: 10 }}>
            {address && (
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>
                We'll send it to <strong>{address}</strong>. Wrong address? Update it in your
                profile below.
              </div>
            )}

            {resendState === 'sent' ? (
              <div style={{ fontSize: 13 }} role="status">
                Confirmation email sent — check your inbox.
              </div>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={handleResend}
                disabled={resendState === 'sending'}
                style={{ fontSize: 13, padding: '6px 12px' }}
              >
                {resendState === 'sending' ? 'Sending…' : 'Resend verification email'}
              </button>
            )}

            {resendState === 'failed' && (
              <div style={{ fontSize: 13, marginTop: 8 }}>{resendError}</div>
            )}
          </div>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

/** useSearchParams needs a Suspense boundary in the app router. */
export default function AuthErrorBanner(props) {
  return (
    <Suspense fallback={null}>
      <AuthErrorBannerInner {...props} />
    </Suspense>
  );
}
