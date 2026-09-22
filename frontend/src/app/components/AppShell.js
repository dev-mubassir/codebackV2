'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getMe, logout, getNotifications } from '@/lib/api';
import Icon from './Icon';
import { nav, common } from '@/content/copy';
import styles from './AppShell.module.css';
import { buildNavItems } from './navItems';


export default function AppShell({ children, activeRoute }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);

  // Billing appears only once the server says it exists. `user` comes from
  // the getMe() call this shell already makes, so there is no extra request
  // and no frontend copy of the flag to drift.
  const NAV_ITEMS = buildNavItems({ billingEnabled: Boolean(user?.features?.billing) });

  const currentPath = activeRoute || pathname;

  useEffect(() => {
    async function init() {
      try {
        const userData = await getMe();
        setUser(userData);
        getNotifications()
          .then((d) => setNotifCount(d.unreadCount || 0))
          .catch(() => { });
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router]);

  async function handleLogout() {
    try {
      await logout().catch(() => { });
      router.push('/login');
    } catch (err) {
      console.error('Logout failed:', err);
      router.push('/login');
    }
  }

  if (loading) {
    return (
      <div className={styles.loadingScreen} aria-busy="true" aria-label={common.loading}>
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
              <img src="/assets/siffty-logo-tight.png" alt="" className={styles.brandIconImg} />
            </div>
            <span className={styles.brandName}>Siffty</span>
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
                    <span className={styles.navIcon}><Icon name={item.icon} size={16} /></span>
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
            title={nav.account}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
            id="appshell-profile-sidebar-btn"
          >
            <div className="avatar avatar-sm">
              {(user?.name || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>{user?.name || nav.account}</span>
              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{nav.accountSubtitle}</span>
            </div>
          </button>
          <button className={styles.logoutBtn} onClick={handleLogout} aria-label={nav.logOut} title={nav.logOut}>
            <Icon name="logOut" size={16} />
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
              aria-label={nav.openMenu}
            >
              <Icon name="menu" size={20} />
            </button>
          </div>
          <div className={styles.headerRight}>
            <button
              className={styles.headerAction}
              onClick={() => router.push('/notifications')}
              aria-label={nav.notifications}
              title={nav.notifications}
            >
              <Icon name="bell" size={18} />
              {notifCount > 0 && (
                <span className={styles.headerBadge}>{notifCount > 9 ? '9+' : notifCount}</span>
              )}
            </button>
            <button
              className={styles.headerUser}
              onClick={() => router.push('/profile')}
              title={nav.account}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: 'var(--radius-full)' }}
              id="appshell-profile-header-btn"
            >
              <div className="avatar avatar-sm">
                {(user?.name || user?.email || 'U')[0].toUpperCase()}
              </div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {user?.name?.split(' ')[0] || nav.account}
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
