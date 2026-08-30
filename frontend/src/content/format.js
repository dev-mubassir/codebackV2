/**
 * Formatting helpers — one date format, one currency format, one plural rule
 * for the whole product.
 *
 * Dates are always written `29 Aug 2026`. Numeric DD/MM vs MM/DD is ambiguous
 * for an international audience, so it is never used.
 */

const DATE_FORMAT = { day: 'numeric', month: 'short', year: 'numeric' };
const TIME_FORMAT = { hour: 'numeric', minute: '2-digit' };

/** `29 Aug 2026`. Returns an em dash for missing or unparseable values. */
export function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', DATE_FORMAT);
}

/** `29 Aug 2026, 14:05`. Returns an em dash for missing or unparseable values. */
export function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString('en-GB', DATE_FORMAT)}, ${date.toLocaleTimeString('en-GB', TIME_FORMAT)}`;
}

/** `14:05` — clock time only, for message bubbles. */
export function formatTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', TIME_FORMAT);
}

/** Compact relative age for conversation lists: `now`, `12m`, `5h`, `3d`, `29 Aug 2026`. */
export function formatTimeAgo(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return formatDate(date);
}

/**
 * Correct pluralisation. Never renders "1 messages".
 *
 *   plural(1, 'message')            -> '1 message'
 *   plural(4, 'message')            -> '4 messages'
 *   plural(2, 'reply', 'replies')   -> '2 replies'
 */
export function plural(count, singular, pluralForm) {
  const n = Number(count) || 0;
  const word = n === 1 ? singular : pluralForm || `${singular}s`;
  return `${n.toLocaleString('en-GB')} ${word}`;
}

/** Just the word, without the count in front. */
export function pluralWord(count, singular, pluralForm) {
  return Number(count) === 1 ? singular : pluralForm || `${singular}s`;
}

/** Thousands separators, nothing else. */
export function formatCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-GB') : '0';
}

/**
 * One currency format for the whole product, including inside starter
 * templates. Amounts are written with the ISO code so a reader in any region
 * knows which rupee, dollar, or pound is meant.
 *
 *   formatCurrency(7500)              -> 'INR 7,500'
 *   formatCurrency(350, 'USD')        -> 'USD 350'
 */
export const DEFAULT_CURRENCY = 'INR';

export function formatCurrency(amount, currency = DEFAULT_CURRENCY) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return `${String(currency || DEFAULT_CURRENCY).toUpperCase()} ${n.toLocaleString('en-GB')}`;
}

/**
 * Percentages need a stated denominator and a minimum sample size. Below the
 * threshold a share is meaningless — "100%" of one conversation tells nobody
 * anything — so it is suppressed rather than shown.
 */
export const MIN_PERCENT_SAMPLE = 10;

export function formatPercent(part, total, { minSample = MIN_PERCENT_SAMPLE } = {}) {
  const t = Number(total) || 0;
  if (t < minSample) return null;
  return `${Math.round((Number(part) || 0) / t * 100)}%`;
}
