/**
 * Inbox metadata — category and priority display, plus the folder list.
 *
 * Wording lives in content/labels.js so one edit changes it everywhere.
 * This module only adds what is specific to the inbox: which icon to draw and
 * which badge class to apply. `icon` is a name from components/Icon.js, never
 * an emoji.
 */

import {
  categoryLabel,
  normalizeCategoryId as normalizeId,
  priorityLabel,
  riskLabel,
} from '@/content/labels';

export { normalizeId as normalizeCategoryId };

const CATEGORY_PRESENTATION = {
  hot_lead: { icon: 'flame', badgeClass: 'badgeBrandCollab' },
  lead: { icon: 'target', badgeClass: 'badgeBusiness' },
  product_inquiry: { icon: 'package', badgeClass: 'badgeBusiness' },
  service_inquiry: { icon: 'briefcase', badgeClass: 'badgeBusiness' },
  pricing_inquiry: { icon: 'tag', badgeClass: 'badgeBusiness' },
  availability_inquiry: { icon: 'calendar', badgeClass: 'badgeQuestion' },
  delivery_inquiry: { icon: 'truck', badgeClass: 'badgeQuestion' },
  customer: { icon: 'wallet', badgeClass: 'badgeBusiness' },
  support_request: { icon: 'headphones', badgeClass: 'badgeQuestion' },
  general_question: { icon: 'helpCircle', badgeClass: 'badgeQuestion' },
  brand_deal: { icon: 'handshake', badgeClass: 'badgeBrandCollab' },
  collaboration: { icon: 'handshake', badgeClass: 'badgeBrandCollab' },
  fan: { icon: 'heart', badgeClass: 'badgeFan' },
  spam: { icon: 'ban', badgeClass: 'badgeSpam' },
  scam: { icon: 'shieldAlert', badgeClass: 'badgeSpam' },
  abusive: { icon: 'alertTriangle', badgeClass: 'badgeSpam' },
  other: { icon: 'messageCircle', badgeClass: 'badgeOther' },
};

const DEFAULT_PRESENTATION = { icon: 'messageCircle', badgeClass: 'badgeOther' };

/** Always returns a renderable descriptor — never undefined, never a raw enum. */
export function getCategoryMeta(category) {
  const id = normalizeId(category);
  const { label, description, tone } = categoryLabel(id);
  const presentation = CATEGORY_PRESENTATION[id] || DEFAULT_PRESENTATION;
  return { id, label, description, tone, ...presentation };
}

/** Folders in the inbox sidebar. */
export const INBOX_FILTERS = [
  { id: 'all', label: 'All', icon: 'inbox' },
  { id: 'unread', label: 'Unread', icon: 'messageSquare' },
  { id: 'important', label: 'Needs your reply', icon: 'alertTriangle' },
  { id: 'hot_leads', label: 'Hot leads', icon: 'flame' },
  { id: 'leads', label: 'Leads and questions', icon: 'target' },
  { id: 'customers', label: 'Customers', icon: 'wallet' },
  { id: 'questions', label: 'General questions', icon: 'helpCircle' },
  { id: 'support', label: 'Support', icon: 'headphones' },
  { id: 'brand_deal', label: 'Brand deals', icon: 'handshake' },
  { id: 'spam', label: 'Spam and scams', icon: 'ban' },
];

const PRIORITY_DOT_CLASS = {
  critical: 'priorityCritical',
  high: 'priorityHigh',
  normal: 'priorityNormal',
  low: 'priorityLow',
};

export function getPriorityMeta(priority) {
  const id = PRIORITY_DOT_CLASS[priority] ? priority : 'normal';
  const { label, description, tone } = priorityLabel(id);
  return { id, label, description, tone, dotClass: PRIORITY_DOT_CLASS[id] };
}

const RISK_COLOR = {
  LOW: 'var(--color-success)',
  MEDIUM: 'var(--color-warning)',
  HIGH: 'var(--color-error)',
  CRITICAL: 'var(--color-error-strong)',
};

const RISK_BADGE_CLASS = {
  LOW: 'riskLow',
  MEDIUM: 'riskMedium',
  HIGH: 'riskHigh',
  CRITICAL: 'riskCritical',
};

export function getRiskMeta(riskLevel) {
  const id = String(riskLevel || 'LOW').toUpperCase();
  const key = RISK_COLOR[id] ? id : 'LOW';
  const { label, tone } = riskLabel(key);
  return { id: key, label, tone, badgeClass: RISK_BADGE_CLASS[key], color: RISK_COLOR[key] };
}
