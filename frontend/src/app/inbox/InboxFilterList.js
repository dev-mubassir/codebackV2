'use client';

import Icon from '@/app/components/Icon';
import { INBOX_FILTERS } from '@/lib/categories';
import { inbox as t } from '@/content/copy';
import styles from './inbox.module.css';

/**
 * The account and folder lists — single source of truth for both the
 * desktop .filterSidebar and the mobile drawer's equivalent section, so
 * they can never drift out of sync. Purely presentational: all state
 * (selectedAccountId, selectedFilter, counts) and handlers live in
 * inbox/page.js and are passed in as props. `idPrefix` keeps element ids
 * unique when this renders twice in the DOM at once (desktop + drawer,
 * one hidden by CSS at any given width) — literal ids like
 * "filter-account-all" would otherwise collide.
 */
export default function InboxFilterList({
  accounts,
  selectedAccountId,
  onAccountChange,
  allAccountsCount,
  folderCounts,
  selectedFilter,
  onFilterChange,
  idPrefix = '',
}) {
  return (
    <>
      <div className={styles.filterSection}>
        <span className={styles.filterSectionTitle}>{t.accounts}</span>
        <div className={styles.filterItemList}>
          <button
            className={`${styles.filterItemBtn} ${selectedAccountId === '' ? styles.filterItemBtnActive : ''}`}
            onClick={() => onAccountChange('')}
            id={`${idPrefix}filter-account-all`}
          >
            <div className={styles.filterItemLeft}>
              <span className={styles.filterItemIcon}><Icon name="globe" size={14} /></span>
              <span className={styles.filterItemLabel}>{t.allAccounts}</span>
            </div>
            <span className={styles.filterItemCount}>{allAccountsCount}</span>
          </button>
          {accounts.map(acc => (
            <button
              key={acc.id}
              className={`${styles.filterItemBtn} ${selectedAccountId === acc.id ? styles.filterItemBtnActive : ''}`}
              onClick={() => onAccountChange(acc.id)}
              id={`${idPrefix}filter-account-${acc.id}`}
            >
              <div className={styles.filterItemLeft}>
                <span className={styles.filterItemIcon}><Icon name="instagram" size={14} /></span>
                <span className={styles.filterItemLabel}>@{acc.igUsername || 'account'}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filterSection}>
        <span className={styles.filterSectionTitle}>{t.folders}</span>
        <div className={styles.filterItemList}>
          {INBOX_FILTERS.map(f => {
            const isActive = selectedFilter === f.id;
            const count = folderCounts[f.id] ?? 0;
            return (
              <button
                key={f.id}
                className={`${styles.filterItemBtn} ${isActive ? styles.filterItemBtnActive : ''}`}
                onClick={() => onFilterChange(f.id)}
                id={`${idPrefix}filter-tab-${f.id}`}
              >
                <div className={styles.filterItemLeft}>
                  <span className={styles.filterItemIcon}><Icon name={f.icon} size={14} /></span>
                  <span className={styles.filterItemLabel}>{f.label}</span>
                </div>
                {count > 0 && <span className={styles.filterItemCount}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
