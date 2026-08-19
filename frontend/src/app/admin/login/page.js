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
      background: 'var(--bg-page)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        padding: '36px',
        maxWidth: '400px',
        width: '100%',
        boxShadow: 'var(--shadow-md)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <span className="badge badge-primary" style={{ fontSize: '11px', marginBottom: '8px' }}>
            SUPER ADMIN CONTROL PANEL
          </span>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '8px', color: 'var(--text-primary)' }}>
            Codeback Administration
          </h1>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '4px' }}>
            System Administrator Authentication
          </p>
        </div>

        {error && (
          <div style={{
            background: 'var(--color-error-subtle)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: 'var(--color-error-text)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
            marginBottom: '20px',
            fontWeight: 500,
            textAlign: 'center'
          }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Admin Username
            </label>
            <input
              type="text"
              className="input"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Admin Password
            </label>
            <input
              type="password"
              className="input"
              placeholder="Enter password"
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
            {submitting ? 'Authenticating...' : 'Sign In To Admin →'}
          </button>
        </form>
      </div>
    </div>
  );
}
