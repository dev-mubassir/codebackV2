'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '@/lib/api';
import Icon from '@/app/components/Icon';
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
        <div className={styles.authHeader}>
          <div className={styles.authLogo}><Icon name="zap" size={20} /></div>
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

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="confirmPassword">
              {auth.register.confirmPasswordLabel}
            </label>
            <input
              id="confirmPassword"
              type="password"
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
