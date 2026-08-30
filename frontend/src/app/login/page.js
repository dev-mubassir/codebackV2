'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login } from '@/lib/api';
import Icon from '@/app/components/Icon';
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
        <div className={styles.authHeader}>
          <div className={styles.authLogo}><Icon name="zap" size={20} /></div>
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
            <input
              id="password"
              type="password"
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
