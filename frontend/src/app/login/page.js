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
import { auth, validation } from '@/content/copy';
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
      <div className={styles.authCard}>
        <AuthErrorBanner />

        <div className={styles.authHeader}>
          <div className={styles.authLogo}><BrandLogo size={40} /></div>
          <h1 className={styles.authTitle}>{auth.login.title}</h1>
          <p className={styles.authSubtitle}>{auth.login.subtitle}</p>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <Icon name="alertTriangle" size={14} />
            <span>{error}</span>
          </div>
        )}

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
            <label className={styles.formLabel} htmlFor="password">
              {auth.login.passwordLabel}
            </label>
            <PasswordInput
              id="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className={`btn btn-primary ${styles.submitBtn}`}
            disabled={loading}
            id="login-submit-btn"
          >
            {loading ? auth.login.submitting : auth.login.submit}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Link href="/forgot-password" className={styles.authLink}>
            Forgot your password?
          </Link>
        </div>

        {/*
          Full-page navigation, not fetch(): this starts an OAuth redirect
          chain that ends on the backend, so it must leave the SPA entirely.
        */}
        <div style={{ marginTop: 16 }}>
          <a
            href={getGoogleAuthUrl()}
            className={`btn ${styles.submitBtn}`}
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

        <div className={styles.authFooter}>
          {auth.login.footer}
          <Link href="/register" className={styles.authLink}>
            {auth.login.footerAction}
          </Link>
        </div>
      </div>
    </div>
  );
}
