'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { register, getGoogleAuthUrl } from '@/lib/api';
import Icon from '@/app/components/Icon';
import GoogleIcon from '@/app/components/GoogleIcon';
import BrandLogo from '@/app/components/BrandLogo';
import PasswordInput from '@/app/components/PasswordInput';
import AuthErrorBanner from '@/app/components/AuthErrorBanner';
import { auth, errors, validation, legal } from '@/content/copy';
import styles from '../login/login.module.css';

/**
 * Optional influencer / promo code. Uncontrolled, so an influencer link
 * (/register?code=PRIYA20) can prefill it without a state update in an
 * effect; inside <Suspense> as the Next docs require for useSearchParams.
 */
function CouponField() {
  const prefill = (useSearchParams().get('code') || '').slice(0, 32);
  return (
    <div className={styles.formGroup}>
      <label className={styles.formLabel} htmlFor="couponCode">{auth.register.couponLabel}</label>
      <input id="couponCode" name="couponCode" type="text" className="input" defaultValue={prefill} maxLength={32} autoComplete="off" placeholder={auth.register.couponPlaceholder} />
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const couponCode = (e.currentTarget.elements.couponCode?.value || '').trim();

    if (password.length < 6) {
      setError(validation.passwordTooShort);
      return;
    }

    if (password !== confirmPassword) {
      setError(validation.passwordMismatch);
      return;
    }

    setLoading(true);

    try {
      await register({ name, email, password, confirmPassword, ...(couponCode ? { couponCode } : {}) });
      router.push('/onboarding');
    } catch (err) {
      setError(err.response?.data?.error || errors.generic);
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
            <span>Start Free Trial</span>
          </div>
          <h1 className={styles.authTitle}>{auth.register.title}</h1>
          <p className={styles.authSubtitle}>{auth.register.subtitle}</p>
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
            id="register-google-btn"
          >
            <GoogleIcon size={18} />
            <span>Continue with Google</span>
          </a>
        </div>

        {/* Divider */}
        <div className={styles.divider}>
          <span>or register with email</span>
        </div>

        {/* Registration Form */}
        <form onSubmit={handleSubmit} className={styles.authForm}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="name">
              {auth.register.nameLabel}
            </label>
            <input
              id="name"
              type="text"
              className="input"
              placeholder={auth.register.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="email">
              {auth.register.emailLabel}
            </label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder={auth.register.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="password">
              {auth.register.passwordLabel}
            </label>
            <PasswordInput
              id="password"
              className="input"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="confirmPassword">
              {auth.register.confirmPasswordLabel}
            </label>
            <PasswordInput
              id="confirmPassword"
              className="input"
              placeholder="••••••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <Suspense fallback={null}>
            <CouponField />
          </Suspense>

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={loading}
            id="register-submit-btn"
          >
            {loading ? (
              <span>Creating account...</span>
            ) : (
              <>
                <span>{auth.register.submit}</span>
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
          {auth.register.footer}{' '}
          <Link href="/login" className={styles.authLink}>
            {auth.register.footerAction}
          </Link>
        </div>

        {/* Terms & Privacy Policy Consent */}
        <p className={styles.termsConsent}>
          By creating an account, you agree to our{' '}
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
