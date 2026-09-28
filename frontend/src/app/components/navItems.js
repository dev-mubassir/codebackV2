import { nav } from '@/content/copy';

/**
 * The app's navigation, built once.
 *
 * It began as two byte-identical copies, one in the old AppShell and one in
 * NavSidebar. That was survivable while the list was static — but the billing
 * entry is CONDITIONAL, and a condition duplicated in two places is a
 * condition that eventually disagrees with itself. Both of those files are
 * gone now (2026-09-24); components/ui/AppShell is the only caller.
 *
 * BILLING IS GATED, deliberately. Until BILLING_ENABLED is set, the billing
 * routes 404 and there is no pricing to show, so a permanent nav entry would
 * be a link to a dead page during Meta App Review — exactly what that flag
 * exists to prevent. Gating it here means flipping ONE environment variable
 * on the backend lights up the route and the nav together, with no code
 * change at flip time and nothing to remember.
 *
 * The flag arrives from the server on GET /auth/me (`features.billing`), not
 * from a NEXT_PUBLIC_ mirror — a second copy on the frontend could be set
 * differently from the backend's and would show a nav entry to a 404.
 */
export function buildNavItems({ billingEnabled = false, autodmEnabled = false } = {}) {
  return [
    {
      section: nav.sections.overview,
      items: [{ label: nav.dashboard, path: '/dashboard', icon: 'dashboard' }],
    },
    {
      section: nav.sections.messaging,
      items: [
        { label: nav.inbox, path: '/inbox', icon: 'inbox' },
        { label: nav.notifications, path: '/notifications', icon: 'bell' },
        // Auto DM: gated like billing, on GET /api/autodm/status (AppShell).
        ...(autodmEnabled ? [{ label: 'Auto DM', path: '/autodm', icon: 'send' }] : []),
      ],
    },
    {
      section: nav.sections.configuration,
      items: [
        { label: nav.settings, path: '/settings', icon: 'settings' },
        ...(billingEnabled ? [{ label: nav.billing, path: '/billing', icon: 'wallet' }] : []),
      ],
    },
  ];
}
