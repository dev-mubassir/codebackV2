/**
 * Admin route segment layout (server). Its own layout, separate from the
 * customer app: it only adds the metadata below and renders the client
 * AdminShell (session check, staff navigation, step-up).
 *
 * Gate 8: never indexed (also sent as an X-Robots-Tag header from
 * next.config.mjs, with the other admin security headers). Nothing in the
 * customer app links here.
 */

import { meta } from '@/content/copy';
import AdminShell from './_components/AdminShell';

export const metadata = {
  title: meta.admin.title,
  description: meta.admin.description,
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
};

export default function AdminLayout({ children }) {
  return <AdminShell>{children}</AdminShell>;
}
