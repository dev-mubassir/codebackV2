'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login, getGoogleAuthUrl } from '@/lib/api';
import Icon from '@/app/components/Icon';
import GoogleIcon from '@/app/components/GoogleIcon';
import BrandLogo from '@/app/components/BrandLogo';
import PasswordInput from '@/app/components/PasswordInput';
import AuthErrorBanner from '@/app/components/AuthErrorBanner';
import { auth, validation, legal } from '@/content/copy';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await login({ email, password });
      if (!res.user?.onboardingCompleted) {
        router.push('/onboarding');
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.error || validation.loginFailed);
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
        <AuthErrorBanner />

        <div className={styles.authHeader}>
          <div className={styles.statusBadge}>
            <span className={styles.pulseDot} />
            <span>Workspace Sign In</span>
          </div>
          <h1 className={styles.authTitle}>{auth.login.title}</h1>
          <p className={styles.authSubtitle}>{auth.login.subtitle}</p>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <Icon name="alertTriangle" size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Google OAuth Button */}
        <div>
          <a
            href={getGoogleAuthUrl()}
            className={styles.googleBtn}
            id="login-google-btn"
          >
            <GoogleIcon size={18} />
            <span>Continue with Google</span>
          </a>
        </div>

        {/* Divider */}
        <div className={styles.divider}>
          <span>or continue with email</span>
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit} className={styles.authForm}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="email">
              {auth.login.emailLabel}
            </label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder={auth.login.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className={styles.formGroup}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className={styles.formLabel} htmlFor="password">
                {auth.login.passwordLabel}
              </label>
              <Link href="/forgot-password" className={styles.forgotPasswordLink}>
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              className="input"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={loading}
            id="login-submit-btn"
          >
            {loading ? (
              <span>Logging in...</span>
            ) : (
              <>
                <span>{auth.login.submit}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </form>

        {/* Footer Navigation */}
        <div className={styles.authFooter}>
          {auth.login.footer}{' '}
          <Link href="/register" className={styles.authLink}>
            {auth.login.footerAction}
          </Link>
        </div>

        {/* Terms & Privacy Policy Consent */}
        <p className={styles.termsConsent}>
          By signing in, you agree to our{' '}
          <Link href="/terms" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </Link>{' '}
          and acknowledge our{' '}
          <Link href="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </Link>.
        </p>
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
