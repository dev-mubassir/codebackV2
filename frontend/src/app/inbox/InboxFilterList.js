'use client';

/**
 * The account and folder lists for the desktop folders column.
 *
 * Purely presentational — every piece of state and every handler lives in
 * inbox/page.js. Below 1280px this column is hidden and the same two choices
 * are offered as <Select>s in the conversation list header, so there is no
 * width at which a folder or an account becomes unreachable.
 */

import { INBOX_FILTERS } from '@/lib/categories';
import { IconTile } from '@/app/components/ui';
import { inbox as t } from '@/content/copy';
import styles from './inbox.module.css';

/**
 * Counts are muted grey everywhere except "Needs your reply", which is the one
 * number in this column that is a to-do rather than a statistic. Colouring the
 * others too would make all ten compete and none of them read.
 */
const ACCENT_COUNT_FOLDER = 'important';

export default function InboxFilterList({
  accounts,
  selectedAccountId,
  onAccountChange,
  allAccountsCount,
  folderCounts,
  selectedFilter,
  onFilterChange,
}) {
  return (
    <>
      {accounts.length > 1 && (
        <div className={styles.filterSection}>
          <span className={styles.filterSectionTitle}>{t.accounts}</span>
          <button
            type="button"
            className={`${styles.filterItem} ${!selectedAccountId ? styles.filterItemActive : ''}`}
            onClick={() => onAccountChange('')}
            aria-pressed={!selectedAccountId}
          >
            <span className={styles.filterItemLabel}>{t.allAccounts}</span>
            <span className={styles.filterItemCount}>{allAccountsCount}</span>
          </button>
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className={`${styles.filterItem} ${selectedAccountId === account.id ? styles.filterItemActive : ''}`}
              onClick={() => onAccountChange(account.id)}
              aria-pressed={selectedAccountId === account.id}
            >
              <span className={styles.filterItemLabel}>@{account.igUsername}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.filterSection}>
        <span className={styles.filterSectionTitle}>{t.folders}</span>
        {INBOX_FILTERS.map((folder) => {
          const count = folderCounts[folder.id] ?? 0;
          const accentCount = folder.id === ACCENT_COUNT_FOLDER && count > 0;
          return (
            <button
              key={folder.id}
              type="button"
              className={`${styles.filterItem} ${selectedFilter === folder.id ? styles.filterItemActive : ''}`}
              onClick={() => onFilterChange(folder.id)}
              aria-pressed={selectedFilter === folder.id}
            >
              <IconTile name={folder.icon} tone={folder.tone} />
              <span className={styles.filterItemLabel}>{folder.label}</span>
              <span
                className={`${styles.filterItemCount} ${accentCount ? styles.filterItemCountAccent : ''}`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
