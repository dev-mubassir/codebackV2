/**
 * Shown while the admin has maintenance mode on (Gate 7). The API client
 * sends the browser here on a 503 MAINTENANCE. Not indexed.
 */

import Link from 'next/link';
import { maintenance as copy } from '@/content/copy';
import styles from '../error-pages.module.css';

export const metadata = {
  title: 'Back soon — Siffty',
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return (
    <div className={styles.errorPageWrapper}>
      <main className={styles.mainContainer}>
        <h1 className={styles.errorHeadline}>{copy.title}</h1>
        <p className={styles.errorSubtitle}>{copy.body}</p>
        <div className={styles.ctaButtonGroup}>
          <Link href="/dashboard" className={styles.btnPrimary}>{copy.retry}</Link>
        </div>
      </main>
    </div>
  );
}
