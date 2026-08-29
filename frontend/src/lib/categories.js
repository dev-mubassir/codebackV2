/**
 * Shared, extensible category + priority metadata for the inbox UI.
 *
 * Supports Creators, Video/Photo Editors, Product Sellers, Freelancers, Local Businesses,
 * Coaches, E-Commerce, Agencies, and more.
 */

export const CATEGORY_META = {
  // Sales & Leads
  hot_lead: { label: 'Hot Lead', icon: '🔥', badgeClass: 'badgeBrandCollab' },
  lead: { label: 'Lead', icon: '🎯', badgeClass: 'badgeBusiness' },
  product_inquiry: { label: 'Product Inquiry', icon: '📦', badgeClass: 'badgeBusiness' },
  service_inquiry: { label: 'Service Inquiry', icon: '💼', badgeClass: 'badgeBusiness' },
  pricing_inquiry: { label: 'Pricing Question', icon: '🏷️', badgeClass: 'badgeBusiness' },
  availability_inquiry: { label: 'Availability', icon: '📅', badgeClass: 'badgeQuestion' },
  delivery_inquiry: { label: 'Shipping / Delivery', icon: '🚚', badgeClass: 'badgeQuestion' },

  // Relationship & Support
  customer: { label: 'Customer', icon: '💰', badgeClass: 'badgeBusiness' },
  support_request: { label: 'Support', icon: '🎧', badgeClass: 'badgeQuestion' },
  general_question: { label: 'Question', icon: '❓', badgeClass: 'badgeQuestion' },

  // Creator & Partnerships
  brand_deal: { label: 'Brand Deal', icon: '🔥', badgeClass: 'badgeBrandCollab' },
  collaboration: { label: 'Collaboration', icon: '🤝', badgeClass: 'badgeBusiness' },

  // Social & Non-commercial
  fan: { label: 'Fan / Social', icon: '❤️', badgeClass: 'badgeFan' },

  // Security & Negative
  spam: { label: 'Spam', icon: '🚫', badgeClass: 'badgeSpam' },
  scam: { label: '🚨 Potential Scam', icon: '🚨', badgeClass: 'badgeSpam' },
  abusive: { label: 'Abusive', icon: '⚠️', badgeClass: 'badgeSpam' },

  // Fallback
  other: { label: 'Other', icon: '💬', badgeClass: 'badgeOther' },
};

const LEGACY_ALIASES = {
  'Brand/Collab': 'brand_deal',
  Business: 'service_inquiry',
  business_inquiry: 'service_inquiry',
  Question: 'general_question',
  question: 'general_question',
  Fan: 'fan',
  Spam: 'spam',
  Other: 'other',
  support: 'support_request',
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

// Filter tabs shown in the inbox sidebar
export const INBOX_FILTERS = [
  { id: 'all', label: 'All', icon: '📥' },
  { id: 'unread', label: 'Unread', icon: '●' },
  { id: 'important', label: 'Important', icon: '🔥' },
  { id: 'hot_leads', label: 'Hot Leads', icon: '🔥' },
  { id: 'leads', label: 'Leads & Inquiries', icon: '🎯' },
  { id: 'customers', label: 'Customers', icon: '💰' },
  { id: 'questions', label: 'Questions', icon: '❓' },
  { id: 'support', label: 'Support', icon: '🎧' },
  { id: 'brand_deal', label: 'Brand Deals / Collabs', icon: '🤝' },
  { id: 'needs_human', label: 'Needs Human', icon: '👤' },
  { id: 'spam', label: 'Spam & Scams', icon: '🚫' },
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

export const RISK_META = {
  LOW: { label: 'Low Risk', badgeClass: 'riskLow', color: 'var(--color-success)' },
  MEDIUM: { label: 'Medium Risk', badgeClass: 'riskMedium', color: 'var(--color-warning)' },
  HIGH: { label: 'High Risk', badgeClass: 'riskHigh', color: 'var(--color-error)' },
  CRITICAL: { label: 'Critical Risk', badgeClass: 'riskCritical', color: 'var(--color-error-strong)' },
};

export function getRiskMeta(riskLevel) {
  const upper = String(riskLevel || 'LOW').toUpperCase();
  return RISK_META[upper] || RISK_META.LOW;
}
