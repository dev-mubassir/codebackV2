'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getAdminMe, adminLogout, exitImpersonation } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { admin as t, common, errors } from '@/content/copy';
import styles from './admin.module.css';

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [adminUsername, setAdminUsername] = useState('');
  const [loading, setLoading] = useState(() => pathname !== '/admin/login');
  const [authenticated, setAuthenticated] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    // The login page has nothing to check, so it starts unlocked rather than
    // starting locked and synchronously unlocking itself inside this effect.
    if (isLoginPage) return;

    async function checkAdmin() {
      try {
        const adminData = await getAdminMe();
        if (!adminData.authenticated || !adminData.isAdmin) {
          setAuthenticated(false);
          router.push('/admin/login');
        } else {
          setAuthenticated(true);
          setAdminUsername(adminData.username || t.panelTitle);
          // NOTE: `impersonating` is never set to true anywhere — GET
          // /api/admin/me does not return an impersonation flag, so this
          // banner has never rendered. Wiring it up is impersonation
          // behaviour, which is owned elsewhere; reported, not changed here.
        }
      } catch (err) {
        setAuthenticated(false);
        router.push('/admin/login');
      } finally {
        setLoading(false);
      }
    }
    checkAdmin();
  }, [router, isLoginPage]);

  async function handleAdminLogout() {
    try {
      await adminLogout();
      window.location.href = '/admin/login';
    } catch (err) {
      window.location.href = '/admin/login';
    }
  }

  async function handleExitImpersonation() {
    try {
      await exitImpersonation();
      window.location.href = '/admin';
    } catch (err) {
      alert(errors.admin.exitImpersonate);
    }
  }

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (loading || !authenticated) {
    return (
      <div className={styles.adminLayout} style={{ alignItems: 'center', justifyContent: 'center' }} aria-busy="true" aria-label={common.loading}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  const navItems = [
    { label: t.nav.dashboard, path: '/admin', icon: 'dashboard' },
    { label: t.nav.users, path: '/admin/users', icon: 'users' },
    { label: t.nav.accounts, path: '/admin/accounts', icon: 'instagram' },
    { label: t.nav.support, path: '/admin/support', icon: 'lifeBuoy' },
    { label: t.nav.settings, path: '/admin/settings', icon: 'settings' },
  ];

  return (
    <div className={styles.adminLayout}>
      {/* Impersonation Warning Banner */}
      {impersonating && (
        <div className={styles.impersonationBanner}>
          <span>
            <Icon name="alertTriangle" size={14} /> {t.impersonation.banner}
          </span>
          <button onClick={handleExitImpersonation}>{t.impersonation.exit}</button>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className={styles.sidebar} style={{ marginTop: impersonating ? '38px' : '0' }}>
        <div className={styles.sidebarHeader}>
          <Link href="/admin" className={styles.brand}>
            <span className={styles.brandBadge}>{t.login.eyebrow}</span>
            <span className={styles.brandTitle}>{common.productName}</span>
          </Link>
        </div>

        <nav className={styles.nav}>
          {navItems.map(item => {
            const isActive = pathname === item.path;
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
              >
                <Icon name={item.icon} size={15} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <div style={{ fontWeight: '600', color: 'white', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="user" size={14} /> {adminUsername || t.panelTitle}
          </div>
          <button
            onClick={handleAdminLogout}
            className="btn btn-secondary btn-sm"
            style={{ width: '100%' }}
          >
            <Icon name="logOut" size={13} /> {t.logOut}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={styles.main} style={{ marginTop: impersonating ? '38px' : '0' }}>
        <header className={styles.header}>
          <h1 className={styles.headerTitle}>
            {navItems.find(n => n.path === pathname)?.label || t.panelTitle}
          </h1>
          <div>
            <Link href="/dashboard" className="btn btn-secondary btn-sm" target="_blank" rel="noopener noreferrer">
              <Icon name="externalLink" size={13} /> {t.openApp}
            </Link>
          </div>
        </header>

        <div className={styles.content}>
          {children}
        </div>
      </main>
    </div>
  );
}
