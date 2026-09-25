'use client';

/**
 * The announcement banner at the top of the customer app (admin rebuild,
 * Gate 7). Reads the public feed once per page load; a dismissed banner stays
 * dismissed on this browser (by id). Plain text only — React escapes it.
 */

import { useEffect, useState } from 'react';
import { getActiveAnnouncements } from '@/lib/api';
import Icon from '@/app/components/Icon';
import { announcementBanner as copy } from '@/content/copy';
import styles from './AnnouncementBanner.module.css';

const STORAGE_KEY = 'siffty.dismissedAnnouncements';

function readDismissed() {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function AnnouncementBanner() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getActiveAnnouncements()
      .then((list) => {
        if (cancelled) return;
        const dismissed = new Set(readDismissed());
        setItems(list.filter((a) => !dismissed.has(a.id)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function dismiss(id) {
    setItems((list) => list.filter((a) => a.id !== id));
    try {
      const next = [...readDismissed(), id].slice(-20);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: it just comes back next page load
    }
  }

  if (items.length === 0) return null;

  return (
    <div className={styles.wrap}>
      {items.map((a) => (
        <div key={a.id} className={`${styles.banner} ${styles[a.type] || styles.info}`} role={a.type === 'critical' ? 'alert' : 'status'}>
          <Icon name={a.type === 'info' ? 'info' : 'alertTriangle'} size={14} />
          <span className={styles.text}>{a.message}</span>
          <button type="button" className={styles.close} onClick={() => dismiss(a.id)} aria-label={copy.dismiss} title={copy.dismiss}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
