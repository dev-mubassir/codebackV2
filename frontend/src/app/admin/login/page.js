'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminLogin } from '@/lib/api';
import styles from '../admin.module.css';

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await adminLogin(username.trim(), password.trim());
      if (res && res.success) {
        window.location.href = '/admin';
      } else {
        setError(res?.error || 'Invalid admin credentials');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid admin credentials');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#000000',
      color: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{
        background: '#0a0a0a',
        border: '1px solid #ffffff',
        padding: '32px',
        maxWidth: '420px',
        width: '100%'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <span className={styles.brandBadge} style={{ fontSize: '0.875rem', padding: '4px 8px' }}>SUPER ADMIN</span>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Codeback Control Panel
          </h1>
          <p style={{ fontSize: '0.8125rem', color: '#a3a3a3', marginTop: '6px' }}>
            Separate System Administrator Authentication
          </p>
        </div>

        {error && (
          <div style={{
            background: '#171717',
            border: '1px solid #ffffff',
            color: '#ffffff',
            padding: '10px 14px',
            fontSize: '0.8125rem',
            marginBottom: '20px',
            fontWeight: 'bold',
            textAlign: 'center'
          }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', marginBottom: '6px' }}>
              Admin Username
            </label>
            <input
              type="text"
              className={styles.searchInput}
              style={{ width: '100%', padding: '12px' }}
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', marginBottom: '6px' }}>
              Admin Password
            </label>
            <input
              type="password"
              className={styles.searchInput}
              style={{ width: '100%', padding: '12px' }}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: '8px' }}
            disabled={submitting}
          >
            {submitting ? 'Authenticating...' : 'Sign In To Control Panel ↗'}
          </button>
        </form>

        <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.75rem', color: '#737373', textTransform: 'uppercase' }}>
          Independent Founder Admin Access
        </div>
      </div>
    </div>
  );
}
