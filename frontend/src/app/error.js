'use client';

import { errors } from '@/content/copy';
import styles from './legal/legal.module.css';

/**
 * Route-level error boundary. Shows recovery copy instead of an unstyled
 * stack trace. The underlying error is logged to the console for debugging and
 * is never rendered — error text is not user copy.
 */
export default function GlobalError({ error, reset }) {
  if (typeof window !== 'undefined') {
    console.error('[Codeback] Unhandled error:', error);
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>{errors.serverError.title}</h1>
        <p>{errors.serverError.body}</p>
        <p className={styles.contact}>
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            {errors.serverError.action}
          </button>
        </p>
      </div>
    </main>
  );
}
