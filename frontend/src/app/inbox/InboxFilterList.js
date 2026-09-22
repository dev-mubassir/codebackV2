'use client';

import Icon from '@/app/components/Icon';
import { INBOX_FILTERS } from '@/lib/categories';
import { inbox as t } from '@/content/copy';
import styles from './inbox.module.css';

const LABELS = [
  { id: 'hot_leads', label: 'Potential Buyer', color: '#a855f7' },
  { id: 'questions', label: 'Pricing Question', color: '#3b82f6' },
  { id: 'brand_deal', label: 'Partnership', color: '#22c55e' },
  { id: 'support', label: 'Support', color: '#f97316' },
  { id: 'all', label: 'Others', color: '#94a3b8' },
];

export default function InboxFilterList({
  accounts = [],
  selectedAccountId = '',
  onAccountChange,
  allAccountsCount = 0,
  folderCounts = {},
  selectedFilter = 'all',
  onFilterChange,
  idPrefix = '',
}) {
  return (
    <div className={styles.filterListWrapper}>
      {/* Smart Folders Section */}
      <div className={styles.filterSection}>
        <div className={styles.filterItemList}>
          {INBOX_FILTERS.map((f) => {
            const isActive = selectedFilter === f.id;
            const count = f.id === 'all' ? allAccountsCount : (folderCounts[f.id] ?? 0);
            return (
              <button
                key={f.id}
                className={`${styles.filterItemBtn} ${isActive ? styles.filterItemBtnActive : ''}`}
                onClick={() => onFilterChange(f.id)}
                id={`${idPrefix}filter-tab-${f.id}`}
              >
                <div className={styles.filterItemLeft}>
                  <span className={styles.filterItemIcon}>
                    <Icon name={f.icon || 'inbox'} size={16} />
                  </span>
                  <span className={styles.filterItemLabel}>{f.label}</span>
                </div>
                {count > 0 && <span className={styles.filterItemCount}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Connected Accounts Section */}
      {accounts.length > 0 && (
        <div className={styles.filterSection}>
          <span className={styles.filterSectionTitle}>{t.accounts}</span>
          <div className={styles.filterItemList}>
            <button
              className={`${styles.filterItemBtn} ${selectedAccountId === '' ? styles.filterItemBtnActive : ''}`}
              onClick={() => onAccountChange('')}
              id={`${idPrefix}filter-account-all`}
            >
              <div className={styles.filterItemLeft}>
                <span className={styles.filterItemIcon}><Icon name="globe" size={15} /></span>
                <span className={styles.filterItemLabel}>{t.allAccounts}</span>
              </div>
            </button>
            {accounts.map((acc) => (
              <button
                key={acc.id}
                className={`${styles.filterItemBtn} ${selectedAccountId === acc.id ? styles.filterItemBtnActive : ''}`}
                onClick={() => onAccountChange(acc.id)}
                id={`${idPrefix}filter-account-${acc.id}`}
              >
                <div className={styles.filterItemLeft}>
                  <span className={styles.filterItemIcon}><Icon name="instagram" size={15} /></span>
                  <span className={styles.filterItemLabel}>@{acc.igUsername || 'account'}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Labels / Categories Section */}
      <div className={styles.filterSection}>
        <span className={styles.filterSectionTitle}>Labels</span>
        <div className={styles.filterItemList}>
          {LABELS.map((lbl) => {
            const isActive = selectedFilter === lbl.id;
            return (
              <button
                key={lbl.label}
                className={`${styles.filterItemBtn} ${isActive ? styles.filterItemBtnActive : ''}`}
                onClick={() => onFilterChange(lbl.id)}
              >
                <div className={styles.filterItemLeft}>
                  <span
                    className={styles.labelDot}
                    style={{ backgroundColor: lbl.color }}
                  />
                  <span className={styles.filterItemLabel}>{lbl.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
