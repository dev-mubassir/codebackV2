'use client';

/**
 * Admin — administrators and the server configuration, read-only.
 *
 * Data layer is master's: one GET /api/admin/settings.
 *
 * Changed: the section headers were inline-styled divs; they are panel
 * headings now. "Signature checks skipped" was in the same badge as an
 * expired token — it is a warning (something to act on), and "enforced" is
 * neutral rather than green, because it is a setting, not money earned.
 */

import { useEffect, useState } from 'react';
import { getAdminSettings } from '@/lib/api';
import { Badge, Skeleton } from '@/app/components/ui';
import { admin as t, errors } from '@/content/copy';
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
        setSettings(await getAdminSettings());
      } catch {
        setError(errors.admin.settings);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  if (loading) return <div className={styles.loading}><Skeleton lines={5} height={40} /></div>;

  if (error) {
    return (
      <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
        <span className={styles.noticeText}>{error}</span>
      </div>
    );
  }

  const env = settings?.environment || {};

  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{t.settings.adminsTitle}</h2>
        </div>
        <div className={styles.tableScroll}>
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
                  <td className={styles.cellPrimary}>{admin.name || t.users.unnamed}</td>
                  <td className={styles.cellMono}>{admin.email || admin.id}</td>
                  <td><Badge tone="neutral">{roleLabel(admin.role || 'ADMIN').label}</Badge></td>
                  <td>{formatDate(admin.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>{t.settings.environmentTitle}</h2>
        </div>
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.tableCompact}`}>
            <tbody>
              <tr>
                <td className={styles.cellKey}>{t.settings.rows.port}</td>
                <td className={styles.cellMono}>{env.port}</td>
              </tr>
              <tr>
                <td className={styles.cellKey}>{t.settings.rows.frontendUrl}</td>
                <td className={styles.cellMono}>{env.frontendUrl}</td>
              </tr>
              <tr>
                <td className={styles.cellKey}>{t.settings.rows.redirectUri}</td>
                <td className={styles.cellMono}>{env.redirectUri}</td>
              </tr>
              <tr>
                <td className={styles.cellKey}>{t.settings.rows.signatureVerification}</td>
                <td>
                  {env.skipSignatureVerification
                    ? <Badge tone="warning">{t.settings.signatureSkipped}</Badge>
                    : <Badge tone="neutral">{t.settings.signatureEnforced}</Badge>}
                </td>
              </tr>
              <tr>
                <td className={styles.cellKey}>{t.settings.rows.nodeEnv}</td>
                <td className={styles.cellMono}>{env.nodeEnv}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
