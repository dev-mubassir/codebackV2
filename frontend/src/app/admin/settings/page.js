'use client';

import { useEffect, useState } from 'react';
import { getAdminSettings } from '@/lib/api';
import Icon from '@/app/components/Icon';
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
        <Icon name="alertTriangle" size={16} />
        <span className={styles.alertText}>{error}</span>
      </div>
    );
  }

  return (
    <div>
      {/* Admins Table */}
      <div className={styles.tableContainer} style={{ marginBottom: '28px' }}>
        <div className={styles.panelHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="users" size={16} />
            <h2 className={styles.panelTitle}>{t.settings.adminsTitle}</h2>
          </div>
          <span className={styles.panelMeta}>
            {settings?.adminUsers?.length || 0} active administrators
          </span>
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
            {settings?.adminUsers?.map((admin) => (
              <tr key={admin.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '999px',
                        background: '#eff6ff',
                        color: '#2563eb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '12px',
                        border: '1px solid #dbeafe',
                      }}
                    >
                      {(admin.name || admin.email || 'A')[0].toUpperCase()}
                    </div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{admin.name || t.users.unnamed}</div>
                  </div>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{admin.email || admin.id}</td>
                <td>
                  <span className={styles.badgeValid}>
                    <Icon name="shield" size={11} />
                    <span>{roleLabel(admin.role || 'ADMIN').label}</span>
                  </span>
                </td>
                <td>{formatDate(admin.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* System Environment Config */}
      <div className={styles.tableContainer}>
        <div className={styles.panelHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="settings" size={16} />
            <h2 className={styles.panelTitle}>{t.settings.environmentTitle}</h2>
          </div>
        </div>

        <table className={styles.table}>
          <tbody>
            <tr>
              <td style={{ fontWeight: 700, width: '240px', color: '#0f172a' }}>{t.settings.rows.port}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{settings?.environment?.port}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700, color: '#0f172a' }}>{t.settings.rows.frontendUrl}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{settings?.environment?.frontendUrl}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700, color: '#0f172a' }}>{t.settings.rows.redirectUri}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{settings?.environment?.redirectUri}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700, color: '#0f172a' }}>{t.settings.rows.signatureVerification}</td>
              <td>
                <span className={settings?.environment?.skipSignatureVerification ? styles.badgeExpired : styles.badgeValid}>
                  <Icon name={settings?.environment?.skipSignatureVerification ? 'alertTriangle' : 'check'} size={11} />
                  <span>
                    {settings?.environment?.skipSignatureVerification
                      ? t.settings.signatureSkipped
                      : t.settings.signatureEnforced}
                  </span>
                </span>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700, color: '#0f172a' }}>{t.settings.rows.nodeEnv}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{settings?.environment?.nodeEnv}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
