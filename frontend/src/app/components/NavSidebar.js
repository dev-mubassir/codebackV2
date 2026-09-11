'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { logout } from '@/lib/api';
import Icon from './Icon';
import { nav } from '@/content/copy';
// Read-only: matches AppShell's exact look. This file must never be edited
// from here — see the note in NavSidebar.module.css.
import appShellStyles from './AppShell.module.css';
import styles from './NavSidebar.module.css';

export const NAV_ITEMS = [
  { section: nav.sections.overview, items: [
    { label: nav.dashboard, path: '/dashboard', icon: 'dashboard' },
  ]},
  { section: nav.sections.messaging, items: [
    { label: nav.inbox, path: '/inbox', icon: 'inbox' },
    { label: nav.notifications, path: '/notifications', icon: 'bell' },
  ]},
  { section: nav.sections.configuration, items: [
    { label: nav.settings, path: '/settings', icon: 'settings' },
  ]},
];

export const NAV_DRAWER_ID = 'app-nav-drawer';

/**
 * Currently used only by the inbox's mobile header (with `mobileOnly`), not
 * by AppShell — AppShell keeps its own original inline sidebar. Visuals are
 * borrowed read-only from AppShell.module.css so the drawer matches it
 * exactly; `mobileOnly`'s hiding rule lives in this component's own
 * NavSidebar.module.css instead, so AppShell.module.css never changes.
 */
export default function NavSidebar({ open, onClose, activeRoute, user, notifCount, mobileOnly, topSection }) {
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = activeRoute || pathname;
  const navRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Escape closes the drawer; only wired up while it's actually open.
  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // The page behind the drawer must not scroll while it's open. Lifted on
  // close AND on unmount, so navigating away (or the component disappearing
  // for any other reason) can never leave the lock stuck.
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // If the viewport grows past the mobile breakpoint while the drawer is
  // open, close it — otherwise the scroll lock above could get stuck once
  // `mobileOnly` (or, on AppShell, the responsive CSS) hides the drawer
  // outright without it ever having been dismissed normally.
  useEffect(() => {
    if (!open) return undefined;
    const mq = window.matchMedia('(min-width: 769px)');
    function handleChange(e) {
      if (e.matches) onClose();
    }
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, [open, onClose]);

  // Focus moves into the drawer (its first focusable element — found by
  // query rather than a ref pinned to a specific NAV_ITEMS button, since
  // `topSection` can render its own focusable content before it) on open,
  // and back to whatever triggered the open (the hamburger button, in
  // practice) on close — captured via document.activeElement rather than a
  // prop, since that's already whatever the user just activated to open
  // the drawer.
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement;
      navRef.current?.querySelector('button, a, [tabindex]')?.focus();
    } else {
      previouslyFocusedRef.current?.focus?.();
    }
  }, [open]);

  async function handleLogout() {
    try {
      await logout().catch(() => {});
      router.push('/login');
    } catch (err) {
      console.error('Logout failed:', err);
      router.push('/login');
    }
  }

  function navigate(path) {
    router.push(path);
    onClose();
  }

  const rootClass = mobileOnly ? `${appShellStyles.sidebar} ${styles.mobileOnly}` : appShellStyles.sidebar;
  const overlayClass = mobileOnly ? `${appShellStyles.overlay} ${styles.mobileOnly}` : appShellStyles.overlay;

  return (
    <>
      {open && <div className={overlayClass} onClick={onClose} />}

      <aside id={NAV_DRAWER_ID} className={`${rootClass} ${open ? appShellStyles.sidebarOpen : ''}`}>
        <div className={appShellStyles.sidebarHeader}>
          <button className={appShellStyles.brand} onClick={() => navigate('/dashboard')}>
            <div className={appShellStyles.brandIcon}>
              <img src="/logo.png" alt="" className={appShellStyles.brandIconImg} />
            </div>
            <span className={appShellStyles.brandName}>Codeback</span>
          </button>
        </div>

        <nav className={appShellStyles.nav} ref={navRef}>
          {topSection}
          {NAV_ITEMS.map((section) => (
            <div key={section.section} className={appShellStyles.navSection}>
              <div className={appShellStyles.navSectionLabel}>{section.section}</div>
              {section.items.map((item) => {
                const isActive = currentPath === item.path;
                return (
                  <button
                    key={item.path}
                    className={`${appShellStyles.navItem} ${isActive ? appShellStyles.navItemActive : ''}`}
                    onClick={() => navigate(item.path)}
                  >
                    <span className={appShellStyles.navIcon}><Icon name={item.icon} size={16} /></span>
                    <span className={appShellStyles.navLabel}>{item.label}</span>
                    {item.path === '/notifications' && notifCount > 0 && (
                      <span className={appShellStyles.navBadge}>
                        {notifCount > 99 ? '99+' : notifCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={appShellStyles.sidebarFooter}>
          <button
            className={appShellStyles.userInfo}
            onClick={() => navigate('/profile')}
            title={nav.account}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
          >
            <div className="avatar avatar-sm">
              {(user?.name || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div className={appShellStyles.userMeta}>
              <span className={appShellStyles.userName}>{user?.name || nav.account}</span>
              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{nav.accountSubtitle}</span>
            </div>
          </button>
          <button className={appShellStyles.logoutBtn} onClick={handleLogout} aria-label={nav.logOut} title={nav.logOut}>
            <Icon name="logOut" size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}
