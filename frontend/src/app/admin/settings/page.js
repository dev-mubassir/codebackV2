'use client';

import { useEffect, useState } from 'react';
import { getAdminSettings } from '@/lib/api';
import styles from '../admin.module.css';

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await getAdminSettings();
        setSettings(data);
      } catch (err) {
        console.error('Failed to load admin settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <div className="spinner spinner-lg" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  return (
    <div>
      {/* Super Admin Users List */}
      <div className={styles.tableContainer} style={{ marginBottom: '24px' }}>
        <div style={{ padding: '14px 20px', background: 'var(--bg-surface-secondary)', borderBottom: '1px solid var(--border-default)', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          CONFIGURED SUPER ADMIN USERS
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email / ID</th>
              <th>Role</th>
              <th>Admin Granted At</th>
            </tr>
          </thead>
          <tbody>
            {settings?.adminUsers?.map(admin => (
              <tr key={admin.id}>
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{admin.name || 'Super Admin'}</div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{admin.email || admin.id}</td>
                <td>
                  <span className={styles.badgeValid}>SUPERADMIN</span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                  {new Date(admin.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* System Environment Config */}
      <div className={styles.tableContainer}>
        <div style={{ padding: '14px 20px', background: 'var(--bg-surface-secondary)', borderBottom: '1px solid var(--border-default)', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          SYSTEM ENVIRONMENT & SECURITY CONFIGURATION
        </div>
        <table className={styles.table}>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, width: '220px', color: 'var(--text-primary)' }}>Backend Port</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{settings?.environment?.port}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Frontend URL</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{settings?.environment?.frontendUrl}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Meta Redirect URI</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{settings?.environment?.redirectUri}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Skip Webhook Signature Verification</td>
              <td>
                <span className={settings?.environment?.skipSignatureVerification ? styles.badgeExpired : styles.badgeValid}>
                  {settings?.environment?.skipSignatureVerification ? 'TRUE (TEST MODE)' : 'FALSE (ENFORCED)'}
                </span>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Node Environment</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{settings?.environment?.nodeEnv}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
