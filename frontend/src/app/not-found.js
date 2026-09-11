import Link from 'next/link';
import { errors } from '@/content/copy';
import styles from './legal/legal.module.css';

export const metadata = {
  title: 'Page not found — Siffty',
};

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>{errors.notFound.title}</h1>
        <p>{errors.notFound.body}</p>
        <p className={styles.contact}>
          <Link href="/dashboard">{errors.notFound.action}</Link>
        </p>
      </div>
    </main>
  );
}
