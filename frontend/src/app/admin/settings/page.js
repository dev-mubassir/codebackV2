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
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  return (
    <div>
      {/* Super Admin Users List */}
      <div className={styles.tableContainer} style={{ marginBottom: '24px' }}>
        <div style={{ padding: '16px', background: '#141414', borderBottom: '1px solid #262626', fontWeight: 'bold' }}>
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
                  <div style={{ fontWeight: 'bold' }}>{admin.name || 'Super Admin'}</div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{admin.email || admin.id}</td>
                <td>
                  <span className={styles.badgeValid}>SUPERADMIN</span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                  {new Date(admin.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* System Environment Config */}
      <div className={styles.tableContainer}>
        <div style={{ padding: '16px', background: '#141414', borderBottom: '1px solid #262626', fontWeight: 'bold' }}>
          SYSTEM ENVIRONMENT & SECURITY CONFIGURATION
        </div>
        <table className={styles.table}>
          <tbody>
            <tr>
              <td style={{ fontWeight: 'bold', width: '220px' }}>Backend Port</td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{settings?.environment?.port}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 'bold' }}>Frontend URL</td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{settings?.environment?.frontendUrl}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 'bold' }}>Meta Redirect URI</td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{settings?.environment?.redirectUri}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 'bold' }}>Skip Webhook Signature Verification</td>
              <td>
                <span className={settings?.environment?.skipSignatureVerification ? styles.badgeExpired : styles.badgeValid}>
                  {settings?.environment?.skipSignatureVerification ? 'TRUE (TEST MODE)' : 'FALSE (ENFORCED)'}
                </span>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 'bold' }}>Node Environment</td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{settings?.environment?.nodeEnv}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
