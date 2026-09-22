'use client';

/**
 * The frame every internal page sits in — dashboard, inbox, settings, profile,
 * notifications, billing and admin.
 *
 * WHY THE INBOX IS IN HERE TOO. On master the inbox carries its own header,
 * and that header has no link to Settings or Billing: once you were in the
 * inbox the only way out was the logo. One shell means one nav, one active
 * state, and one mobile drawer, so that cannot drift again. The inbox passes
 * `variant="full"` to opt out of the page padding and the document scroll,
 * because it scrolls its own columns.
 *
 * The sidebar is light. Master's is the only dark surface in the product and
 * reads as a different application from the landing page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import Icon from '@/app/components/Icon';
import Avatar from '@/app/components/Avatar';
import { buildNavItems } from '@/app/components/navItems';
import { logout } from '@/lib/api';
import { nav as navCopy } from '@/content/copy';
import s from './AppShell.module.css';

const cx = (...p) => p.filter(Boolean).join(' ');

export default function AppShell({
  user,
  title,
  actions,
  activeRoute,
  variant = 'default',
  notificationCount = 0,
  navCounts = {},
  children,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef(null);
  const menuBtnRef = useRef(null);

  const current = activeRoute || pathname;
  const isFull = variant === 'full';

  // Billing stays gated. The backend 404s those routes while BILLING_ENABLED
  // is false, so an ungated entry is a dead link during Meta App Review.
  const sections = buildNavItems({ billingEnabled: Boolean(user?.features?.billing) });

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        closeDrawer();
        menuBtnRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    drawerRef.current?.querySelector('a, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  async function handleLogout() {
    await logout().catch(() => {});
    router.push('/login');
  }

  const userLabel = user?.name || user?.email?.split('@')[0] || navCopy.account;

  return (
    <div className={cx(s.shell, isFull && s.shellFull)}>
      <div
        className={cx(s.scrim, drawerOpen && s.scrimOpen)}
        onClick={closeDrawer}
        aria-hidden="true"
      />

      <aside
        ref={drawerRef}
        className={cx(s.sidebar, drawerOpen && s.sidebarOpen)}
        aria-label={navCopy.sections?.overview ? 'Main' : undefined}
      >
        <button className={s.brand} onClick={() => router.push('/dashboard')}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/siffty-logo-sm.webp" alt="" className={s.brandMark} width={22} height={22} />
          <span className={s.brandName}>Siffty</span>
        </button>

        <nav className={s.nav}>
          {sections.map((section) => (
            <div key={section.section} className={s.navSection}>
              <span className={s.navSectionLabel}>{section.section}</span>
              {section.items.map((item) => {
                const active = current === item.path || current?.startsWith(`${item.path}/`);
                const count = navCounts[item.path];
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={cx(s.navItem, active && s.navItemActive)}
                    aria-current={active ? 'page' : undefined}
                    onClick={closeDrawer}
                  >
                    <Icon name={item.icon} size={16} />
                    <span className={s.navItemLabel}>{item.label}</span>
                    {typeof count === 'number' && count > 0 && (
                      <span className={s.navCount}>{count}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={s.sidebarFooter}>
          <button className={s.userBtn} onClick={() => router.push('/profile')}>
            <Avatar name={userLabel} size={28} decorative />
            <span className={s.userMeta}>
              <span className={s.userName}>{userLabel}</span>
              <span className={s.userSub}>{navCopy.account}</span>
            </span>
          </button>
          <button
            className={cx(s.navItem, s.iconBtn)}
            onClick={handleLogout}
            aria-label={navCopy.logOut}
            title={navCopy.logOut}
          >
            <Icon name="logOut" size={16} />
          </button>
        </div>
      </aside>

      <div className={s.main}>
        <header className={s.topbar}>
          <button
            ref={menuBtnRef}
            className={cx(s.navItem, s.iconBtn, s.menuBtn)}
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <Icon name="menu" size={18} />
          </button>

          <h1 className={s.topbarTitle}>{title}</h1>

          <div className={s.topbarActions}>
            {actions}
            <span className={s.notifBtnWrap}>
              <button
                className={cx(s.navItem, s.iconBtn)}
                    onClick={() => router.push('/notifications')}
                aria-label={navCopy.notifications}
                title={navCopy.notifications}
              >
                <Icon name="bell" size={18} />
              </button>
              {notificationCount > 0 && <span className={s.notifDot} aria-hidden="true" />}
            </span>
          </div>
        </header>

        {isFull ? (
          <div className={s.contentFull}>{children}</div>
        ) : (
          <div className={s.content}>
            <div className={s.contentInner}>{children}</div>
          </div>
        )}
      </div>
    </div>
  );
}
