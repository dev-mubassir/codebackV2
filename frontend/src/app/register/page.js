'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register, getGoogleAuthUrl } from '@/lib/api';
import Icon from '@/app/components/Icon';
import GoogleIcon from '@/app/components/GoogleIcon';
import BrandLogo from '@/app/components/BrandLogo';
import PasswordInput from '@/app/components/PasswordInput';
import AuthErrorBanner from '@/app/components/AuthErrorBanner';
import { auth, errors, validation } from '@/content/copy';
import styles from '../login/login.module.css';

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
      await register({ name, email, password, confirmPassword });
      router.push('/onboarding');
    } catch (err) {
      setError(err.response?.data?.error || errors.generic);
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
          <h1 className={styles.authTitle}>{auth.register.title}</h1>
          <p className={styles.authSubtitle}>{auth.register.subtitle}</p>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <Icon name="alertTriangle" size={14} />
            <span>{error}</span>
          </div>
        )}

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
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="confirmPassword">
              {auth.register.confirmPasswordLabel}
            </label>
            <PasswordInput
              id="confirmPassword"
              className="input"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className={`btn btn-primary ${styles.submitBtn}`}
            disabled={loading}
            id="register-submit-btn"
          >
            {loading ? auth.register.submitting : auth.register.submit}
          </button>
        </form>

        {/*
          Same entry point as the login page. The backend route is identical
          for both: /auth/google creates the account if the Google address is
          new and logs in if it already exists, so signup and sign-in need no
          separate handling here.

          A plain <a>, not a Link or fetch — this starts an OAuth redirect
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
          {auth.register.footer}
          <Link href="/login" className={styles.authLink}>
            {auth.register.footerAction}
          </Link>
        </div>
      </div>
    </div>
  );
}
