'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getMe, logout, getNotifications, getAccounts } from '@/lib/api';
import styles from './AppShell.module.css';

const NAV_ITEMS = [
  { section: 'Overview', items: [
    { label: 'Dashboard', path: '/dashboard', icon: '📊' },
  ]},
  { section: 'Messaging', items: [
    { label: 'Inbox', path: '/inbox', icon: '📥' },
    { label: 'Brand Deals', path: '/brand-deals', icon: '🔥' },
    { label: 'Notifications', path: '/notifications', icon: '🔔' },
  ]},
  { section: 'Configuration', items: [
    { label: 'AI Settings', path: '/settings', icon: '⚙️' },
  ]},
];

export default function AppShell({ children, activeRoute }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);

  const currentPath = activeRoute || pathname;

  useEffect(() => {
    async function init() {
      try {
        const userData = await getMe();
        setUser(userData);
        getNotifications()
          .then((d) => setNotifCount(d.unreadCount || 0))
          .catch(() => {});
      } catch {
        router.push('/');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router]);

  async function handleLogout() {
    try {
      await logout();
      router.push('/');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className={styles.overlay}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarHeader}>
          <button className={styles.brand} onClick={() => router.push('/dashboard')}>
            <div className={styles.brandIcon}>
              <img src="/logo.png" alt="Codeback Logo" className={styles.brandIconImg} />
            </div>
            <span className={styles.brandName}>Codeback</span>
          </button>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map((section, idx) => (
            <div key={section.section} className={styles.navSection}>
              <div className={styles.navSectionLabel}>{section.section}</div>
              {section.items.map((item) => {
                const isActive = currentPath === item.path;
                return (
                  <button
                    key={item.path}
                    className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                    onClick={() => {
                      router.push(item.path);
                      setSidebarOpen(false);
                    }}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span className={styles.navLabel}>{item.label}</span>
                    {item.path === '/notifications' && notifCount > 0 && (
                      <span className={styles.navBadge}>
                        {notifCount > 99 ? '99+' : notifCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <button
            className={styles.userInfo}
            onClick={() => {
              router.push('/profile');
              setSidebarOpen(false);
            }}
            title="View Profile & Account Settings"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
            id="appshell-profile-sidebar-btn"
          >
            <div className="avatar avatar-sm">
              {(user?.name || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>{user?.name || 'My Profile'}</span>
              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Profile & Account</span>
            </div>
          </button>
          <button className={styles.logoutBtn} onClick={handleLogout} title="Log out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className={styles.main}>
        {/* Top header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <button
              className={styles.menuBtn}
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
          <div className={styles.headerRight}>
            <button
              className={styles.headerAction}
              onClick={() => router.push('/notifications')}
              title="Notifications"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {notifCount > 0 && (
                <span className={styles.headerBadge}>{notifCount > 9 ? '9+' : notifCount}</span>
              )}
            </button>
            <button
              className={styles.headerUser}
              onClick={() => router.push('/profile')}
              title="Account & Profile"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: 'var(--radius-full)' }}
              id="appshell-profile-header-btn"
            >
              <div className="avatar avatar-sm">
                {(user?.name || user?.email || 'U')[0].toUpperCase()}
              </div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {user?.name?.split(' ')[0] || 'Profile'}
              </span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
