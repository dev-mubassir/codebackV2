/**
 * Shared, extensible category + priority metadata for the inbox UI.
 *
 * The backend can introduce new categories at any time (see
 * backend/src/lib/constants.js) — this module never assumes the list is
 * fixed. getCategoryMeta() always returns a safe, generic fallback for any
 * category id it doesn't recognize instead of breaking the UI.
 *
 * Legacy note: conversations created before the AI rewrite may still carry
 * old Title-Case category values (e.g. "Brand/Collab"). LEGACY_ALIASES maps
 * them onto the same visual treatment as their canonical replacement so old
 * and new data both render correctly.
 */

export const CATEGORY_META = {
  brand_deal: { label: 'Brand Deal', icon: '🔥', badgeClass: 'badgeBrandCollab' },
  collaboration: { label: 'Collaboration', icon: '🤝', badgeClass: 'badgeBusiness' },
  customer: { label: 'Customer', icon: '💰', badgeClass: 'badgeBusiness' },
  business_inquiry: { label: 'Business', icon: '💼', badgeClass: 'badgeBusiness' },
  question: { label: 'Question', icon: '❓', badgeClass: 'badgeQuestion' },
  fan: { label: 'Fan', icon: '❤️', badgeClass: 'badgeFan' },
  support: { label: 'Support', icon: '🎧', badgeClass: 'badgeQuestion' },
  spam: { label: 'Spam', icon: '🚫', badgeClass: 'badgeSpam' },
  other: { label: 'Other', icon: '💬', badgeClass: 'badgeOther' },
};

const LEGACY_ALIASES = {
  'Brand/Collab': 'brand_deal',
  Business: 'business_inquiry',
  Question: 'question',
  Fan: 'fan',
  Spam: 'spam',
  Other: 'other',
};

const DEFAULT_META = { label: 'Other', icon: '💬', badgeClass: 'badgeOther' };

export function normalizeCategoryId(category) {
  if (!category) return 'other';
  if (CATEGORY_META[category]) return category;
  if (LEGACY_ALIASES[category]) return LEGACY_ALIASES[category];
  return 'other';
}

/** Always returns a renderable { label, icon, badgeClass } — never undefined. */
export function getCategoryMeta(category) {
  const id = normalizeCategoryId(category);
  return CATEGORY_META[id] || DEFAULT_META;
}

// Filter tabs shown in the inbox sidebar. "All"/"Unread"/"Important" are
// pseudo-filters handled separately from real categories.
export const INBOX_FILTERS = [
  { id: 'all', label: 'All', icon: '📥' },
  { id: 'unread', label: 'Unread', icon: '●' },
  { id: 'important', label: 'Important', icon: '🔥' },
  { id: 'brand_deal', label: 'Brand Deals', icon: '🔥' },
  { id: 'collaboration', label: 'Collabs', icon: '🤝' },
  { id: 'customer', label: 'Customers', icon: '💰' },
  { id: 'fan', label: 'Fans', icon: '❤️' },
  { id: 'question', label: 'Questions', icon: '❓' },
  { id: 'spam', label: 'Spam', icon: '🚫' },
];

export const PRIORITY_META = {
  critical: { label: 'Critical', dotClass: 'priorityCritical' },
  high: { label: 'High', dotClass: 'priorityHigh' },
  normal: { label: 'Normal', dotClass: 'priorityNormal' },
  low: { label: 'Low', dotClass: 'priorityLow' },
};

export function getPriorityMeta(priority) {
  return PRIORITY_META[priority] || PRIORITY_META.normal;
}
