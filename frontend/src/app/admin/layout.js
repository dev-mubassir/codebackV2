'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getAdminMe, adminLogout, exitImpersonation } from '@/lib/api';
import styles from './admin.module.css';

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [adminUsername, setAdminUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    if (isLoginPage) {
      setLoading(false);
      return;
    }

    async function checkAdmin() {
      try {
        const adminData = await getAdminMe();
        if (!adminData.authenticated || !adminData.isAdmin) {
          setAuthenticated(false);
          router.push('/admin/login');
        } else {
          setAuthenticated(true);
          setAdminUsername(adminData.username || 'Mubassir');
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
      alert('Failed to exit impersonation');
    }
  }

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (loading || !authenticated) {
    return (
      <div className={styles.adminLayout} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  const navItems = [
    { label: 'Dashboard', path: '/admin', icon: '📊' },
    { label: 'Users', path: '/admin/users', icon: '👥' },
    { label: 'IG Accounts', path: '/admin/accounts', icon: '📱' },
    { label: 'Logs & Health', path: '/admin/logs', icon: '🩺' },
    { label: 'Support Desk', path: '/admin/support', icon: '🎧' },
    { label: 'Settings', path: '/admin/settings', icon: '⚙️' },
  ];

  return (
    <div className={styles.adminLayout}>
      {/* Impersonation Warning Banner */}
      {impersonating && (
        <div className={styles.impersonationBanner}>
          <span>⚠️ IMPERSONATING USER: {user?.name || user?.email} — SUPPORT OVERRIDE ACTIVE</span>
          <button onClick={handleExitImpersonation}>EXIT IMPERSONATION</button>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className={styles.sidebar} style={{ marginTop: impersonating ? '38px' : '0' }}>
        <div className={styles.sidebarHeader}>
          <Link href="/admin" className={styles.brand}>
            <span className={styles.brandBadge}>ADMIN</span>
            <span className={styles.brandTitle}>CODEBACK</span>
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
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <span>Codeback Admin v1.0</span>
          <div style={{ marginTop: '4px', color: '#ffffff', fontWeight: 'bold' }}>
            👤 {adminUsername || 'Mubassir'}
          </div>
          <button
            onClick={handleAdminLogout}
            style={{
              marginTop: '10px',
              width: '100%',
              background: '#000000',
              color: '#ffffff',
              border: '1px solid #333333',
              padding: '6px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            🔒 Log Out Admin
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className={styles.main} style={{ marginTop: impersonating ? '38px' : '0' }}>
        <header className={styles.header}>
          <h1 className={styles.headerTitle}>
            {navItems.find(n => n.path === pathname)?.label || 'Admin Control Panel'}
          </h1>
          <div>
            <Link href="/dashboard" className="btn btn-secondary btn-sm" target="_blank">
              ↗ User App
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
