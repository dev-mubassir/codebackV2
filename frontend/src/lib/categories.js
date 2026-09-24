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

/**
 * Folders in the inbox sidebar.
 *
 * `tone` drives the tinted icon tile, and every value is a claim the folder
 * can actually support:
 *
 *   warning  "you have to do something about this"  — ONE folder only, so the
 *            colour keeps meaning anything at all.
 *   success  money already earned.
 *   danger   hostile senders.
 *   accent   a real classification the assistant made.
 *   neutral  a container, not a judgement. `All` and `Unread` describe the
 *            view, not the messages, so they get grey.
 *
 * Note this is NOT the tone used for the spam BADGE, which stays neutral: on a
 * conversation row "spam" is a fact needing no response, while the folder is a
 * place you go to deal with hostile senders.
 */
export const INBOX_FILTERS = [
  { id: 'all', label: 'All', icon: 'inbox', tone: 'neutral' },
  { id: 'unread', label: 'Unread', icon: 'messageSquare', tone: 'neutral' },
  { id: 'important', label: 'Needs your reply', icon: 'alertTriangle', tone: 'warning' },
  { id: 'hot_leads', label: 'Hot leads', icon: 'flame', tone: 'accent' },
  { id: 'leads', label: 'Leads and questions', icon: 'target', tone: 'accent' },
  { id: 'customers', label: 'Customers', icon: 'wallet', tone: 'success' },
  { id: 'questions', label: 'General questions', icon: 'helpCircle', tone: 'accent' },
  { id: 'support', label: 'Support', icon: 'headphones', tone: 'accent' },
  { id: 'brand_deal', label: 'Brand deals', icon: 'handshake', tone: 'accent' },
  { id: 'spam', label: 'Spam and scams', icon: 'ban', tone: 'danger' },
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
