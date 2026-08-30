'use client';

import { useEffect, useState } from 'react';
import { getAdminSettings } from '@/lib/api';
import { admin as t, common, errors } from '@/content/copy';
import { roleLabel } from '@/content/labels';
import { formatDate } from '@/content/format';
import styles from '../admin.module.css';

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await getAdminSettings();
        setSettings(data);
      } catch (err) {
        setError(errors.admin.settings);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }} aria-busy="true" aria-label={common.loading}>
        <div className="spinner spinner-lg" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${styles.alertBox} ${styles.alertBoxWarning}`} role="alert">
        <span className={styles.alertText}>{error}</span>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.tableContainer} style={{ marginBottom: '24px' }}>
        <div style={{ padding: '14px 20px', background: 'var(--bg-surface-secondary)', borderBottom: '1px solid var(--border-default)', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          {t.settings.adminsTitle}
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t.settings.adminsColumns.name}</th>
              <th>{t.settings.adminsColumns.email}</th>
              <th>{t.settings.adminsColumns.role}</th>
              <th>{t.settings.adminsColumns.granted}</th>
            </tr>
          </thead>
          <tbody>
            {settings?.adminUsers?.map(admin => (
              <tr key={admin.id}>
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{admin.name || t.users.unnamed}</div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{admin.email || admin.id}</td>
                <td>
                  <span className={styles.badgeValid}>{roleLabel(admin.role || 'ADMIN').label}</span>
                </td>
                <td>{formatDate(admin.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* System Environment Config */}
      <div className={styles.tableContainer}>
        <div style={{ padding: '14px 20px', background: 'var(--bg-surface-secondary)', borderBottom: '1px solid var(--border-default)', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          {t.settings.environmentTitle}
        </div>
        <table className={styles.table}>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, width: '220px', color: 'var(--text-primary)' }}>{t.settings.rows.port}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{settings?.environment?.port}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.settings.rows.frontendUrl}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{settings?.environment?.frontendUrl}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.settings.rows.redirectUri}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{settings?.environment?.redirectUri}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.settings.rows.signatureVerification}</td>
              <td>
                <span className={settings?.environment?.skipSignatureVerification ? styles.badgeExpired : styles.badgeValid}>
                  {settings?.environment?.skipSignatureVerification
                    ? t.settings.signatureSkipped
                    : t.settings.signatureEnforced}
                </span>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.settings.rows.nodeEnv}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{settings?.environment?.nodeEnv}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
