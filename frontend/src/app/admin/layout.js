'use client';

/**
 * Admin frame — auth check, staff navigation, and the page shell.
 *
 * The SHELL is the customer app's: this renders the classes from
 * components/ui/AppShell.module.css directly — same light sidebar, same active
 * row, same topbar, same mobile drawer — so staff pages and customer pages
 * read as one product. What differs is only what should: the nav items, the
 * admin session check, and the admin logout. It does not use the AppShell
 * COMPONENT because that one is wired to the customer session, customer nav
 * and customer logout.
 *
 * The auth logic is master's, including the fix carried from Gate 1 that
 * starts the login page unlocked rather than setting state synchronously in
 * the effect.
 *
 * Changed: master's dark #1a1a2e sidebar and its horizontal-bar mobile
 * layout are replaced by the shared shell and its drawer.
 *
 * Admin rebuild (Gate 1):
 *   - impersonation is gone (it exposed customer DMs);
 *   - the session is the separate admin session. It ends after 30 minutes
 *     without ACTIVITY, and only a real click, keystroke or page change sends
 *     the heartbeat below — the backend never counts a GET, so nothing that
 *     refreshes on its own can keep an unattended panel signed in;
 *   - destructive actions ask for the password again (StepUpProvider).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getAdminMe, adminLogout, adminHeartbeat } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { Avatar, Skeleton } from '@/app/components/ui';
import { admin as t, nav as navCopy } from '@/content/copy';
import { StepUpProvider } from './_components/StepUp';
import shell from '@/app/components/ui/AppShell.module.css';
import styles from './admin.module.css';

const cx = (...p) => p.filter(Boolean).join(' ');

// At most one heartbeat a minute. The idle limit is 30 minutes, so this is
// fine-grained enough while keeping a busy admin from sending one per click.
const HEARTBEAT_MIN_GAP_MS = 60 * 1000;

const NAV_ITEMS = [
  { label: t.nav.dashboard, path: '/admin', icon: 'dashboard' },
  { label: t.nav.health, path: '/admin/health', icon: 'shield' },
  { label: t.nav.ai, path: '/admin/ai', icon: 'zap' },
  { label: t.nav.users, path: '/admin/users', icon: 'users' },
  { label: t.nav.plans, path: '/admin/plans', icon: 'package' },
  { label: t.nav.coupons, path: '/admin/coupons', icon: 'tag' },
  { label: t.nav.payments, path: '/admin/payments', icon: 'creditCard' },
  { label: t.nav.accounts, path: '/admin/accounts', icon: 'instagram' },
  { label: t.nav.support, path: '/admin/support', icon: 'lifeBuoy' },
  { label: t.nav.settings, path: '/admin/settings', icon: 'settings' },
];

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [adminUsername, setAdminUsername] = useState('');
  const [loading, setLoading] = useState(() => pathname !== '/admin/login');
  const [authenticated, setAuthenticated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef(null);
  const menuBtnRef = useRef(null);

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
          setAdminUsername(adminData.email || t.panelTitle);
        }
      } catch {
        setAuthenticated(false);
        router.push('/admin/login');
      } finally {
        setLoading(false);
      }
    }
    checkAdmin();
  }, [router, isLoginPage]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Activity heartbeat: real input and page changes only.
  const lastBeat = useRef(0);
  const beat = useCallback(() => {
    const now = Date.now();
    if (now - lastBeat.current < HEARTBEAT_MIN_GAP_MS) return;
    lastBeat.current = now;
    // A failure here is either the network or an ended session; the next
    // real request surfaces the latter through the api.js interceptor.
    adminHeartbeat().catch(() => {});
  }, []);

  useEffect(() => {
    if (!authenticated) return undefined;
    const events = ['pointerdown', 'keydown'];
    events.forEach((e) => window.addEventListener(e, beat, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, beat));
  }, [authenticated, beat]);

  useEffect(() => {
    if (authenticated) beat();
  }, [pathname, authenticated, beat]);

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

  async function handleAdminLogout() {
    try {
      await adminLogout();
    } finally {
      window.location.href = '/admin/login';
    }
  }

  if (isLoginPage) return <>{children}</>;

  const current = NAV_ITEMS.find((n) => n.path === pathname);

  if (loading || !authenticated) {
    return (
      <div className={shell.shell}>
        <div className={shell.main}>
          <div className={shell.content}>
            <div className={shell.contentInner}><Skeleton lines={5} height={48} /></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shell.shell}>
      <div className={cx(shell.scrim, drawerOpen && shell.scrimOpen)} onClick={closeDrawer} aria-hidden="true" />

      <aside ref={drawerRef} className={cx(shell.sidebar, drawerOpen && shell.sidebarOpen)} aria-label={t.panelTitle}>
        <Link href="/admin" className={shell.brand} onClick={closeDrawer}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/siffty-logo-sm.webp" alt="" className={shell.brandMark} width={22} height={22} />
          <span className={shell.brandName}>{t.brand}</span>
        </Link>

        <nav className={shell.nav}>
          <div className={shell.navSection}>
            <span className={shell.navSectionLabel}>{t.panelTitle}</span>
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.path;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={cx(shell.navItem, active && shell.navItemActive)}
                  aria-current={active ? 'page' : undefined}
                  onClick={closeDrawer}
                >
                  <Icon name={item.icon} size={16} />
                  <span className={shell.navItemLabel}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div className={shell.sidebarFooter}>
          <div className={shell.userBtn}>
            <Avatar name={adminUsername || t.panelTitle} size={28} decorative />
            <span className={shell.userMeta}>
              <span className={shell.userName}>{adminUsername || t.panelTitle}</span>
              <span className={shell.userSub}>{t.panelTitle}</span>
            </span>
          </div>
          <button
            type="button"
            className={cx(shell.navItem, shell.iconBtn)}
            onClick={handleAdminLogout}
            aria-label={t.logOut}
            title={t.logOut}
          >
            <Icon name="logOut" size={16} />
          </button>
        </div>
      </aside>

      <div className={shell.main}>
        <header className={shell.topbar}>
          <button
            ref={menuBtnRef}
            type="button"
            className={cx(shell.navItem, shell.iconBtn, shell.menuBtn)}
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label={navCopy.openMenu}
            aria-expanded={drawerOpen}
          >
            <Icon name="menu" size={18} />
          </button>

          <h1 className={shell.topbarTitle}>{current?.label || t.panelTitle}</h1>

          <div className={shell.topbarActions}>
            <Link href="/dashboard" target="_blank" rel="noopener noreferrer" className={styles.openApp}>
              <Icon name="externalLink" size={13} />
              {t.openApp}
            </Link>
          </div>
        </header>

        <div className={shell.content}>
          <div className={shell.contentInner}>
            <StepUpProvider>{children}</StepUpProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
