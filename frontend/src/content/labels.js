/**
 * Display mapping for every value stored in the database or returned by the
 * API.
 *
 * Storage and payloads are never changed. `hot_lead`, `IGNORE_SPAM`,
 * `human_only`, `NEEDS_RECONNECT` and the rest stay exactly as written by the
 * backend — this module only decides what a person sees on screen.
 *
 * Every lookup falls back to `titleCase()`, so a value added to the backend
 * before it is added here renders as "Hot Lead", never as raw `hot_lead`.
 *
 * `tone` drives colour only: neutral | positive | warning | danger.
 */

/** Last-resort humaniser. `needs_reconnect` -> `Needs Reconnect`. */
export function titleCase(value) {
  if (value === null || value === undefined || value === '') return 'Unknown';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function lookup(map, value, fallbackTone = 'neutral') {
  if (value === null || value === undefined || value === '') {
    return { label: 'Unknown', description: null, tone: fallbackTone };
  }
  const direct = map[value];
  if (direct) return { description: null, tone: fallbackTone, ...direct };
  const lowered = map[String(value).toLowerCase()];
  if (lowered) return { description: null, tone: fallbackTone, ...lowered };
  const uppered = map[String(value).toUpperCase()];
  if (uppered) return { description: null, tone: fallbackTone, ...uppered };
  return { label: titleCase(value), description: null, tone: fallbackTone };
}

// ============================================
// Conversation category — backend CATEGORIES
// ============================================
export const CATEGORY_LABELS = {
  hot_lead: { label: 'Hot lead', description: 'Ready to buy or book now', tone: 'positive' },
  lead: { label: 'Lead', description: 'Qualified commercial prospect', tone: 'positive' },
  product_inquiry: { label: 'Product question', description: 'Specs, stock, or condition', tone: 'neutral' },
  service_inquiry: { label: 'Service question', description: 'Scope, portfolio, or custom work', tone: 'neutral' },
  pricing_inquiry: { label: 'Pricing question', description: 'Rates, quotes, or packages', tone: 'neutral' },
  availability_inquiry: { label: 'Availability', description: 'Stock, slots, or booking dates', tone: 'neutral' },
  delivery_inquiry: { label: 'Delivery', description: 'Shipping, timing, or coverage', tone: 'neutral' },
  customer: { label: 'Existing customer', description: 'Someone who has already bought', tone: 'positive' },
  support_request: { label: 'Support', description: 'Help after a purchase', tone: 'neutral' },
  general_question: { label: 'General question', description: 'Hours, contact, or other basics', tone: 'neutral' },
  brand_deal: { label: 'Brand deal', description: 'Paid sponsorship or campaign', tone: 'positive' },
  collaboration: { label: 'Brand deal', description: 'Barter, affiliate, or creative collab', tone: 'positive' },
  fan: { label: 'Fan message', description: 'Praise or friendly chat', tone: 'neutral' },
  spam: { label: 'Spam', description: 'Unsolicited promotion', tone: 'warning' },
  scam: { label: 'Scam', description: 'Phishing or fraud attempt', tone: 'danger' },
  abusive: { label: 'Abusive', description: 'Harassment or toxic language', tone: 'danger' },
  other: { label: 'Other', description: 'No clear category', tone: 'neutral' },
};

const LEGACY_CATEGORY_ALIASES = {
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

export function normalizeCategoryId(category) {
  if (!category) return 'other';
  if (CATEGORY_LABELS[category]) return category;
  if (LEGACY_CATEGORY_ALIASES[category]) return LEGACY_CATEGORY_ALIASES[category];
  return 'other';
}

export function categoryLabel(category) {
  return lookup(CATEGORY_LABELS, normalizeCategoryId(category));
}

// ============================================
// Customer type — backend CUSTOMER_TYPES
// ============================================
export const CUSTOMER_TYPE_LABELS = {
  potential_buyer: { label: 'Potential buyer', tone: 'positive' },
  hot_lead: { label: 'Hot lead', tone: 'positive' },
  lead: { label: 'Lead', tone: 'positive' },
  existing_customer: { label: 'Existing customer', tone: 'positive' },
  collaborator: { label: 'Collaborator', tone: 'neutral' },
  casual_fan: { label: 'Fan', tone: 'neutral' },
  spammer: { label: 'Spammer', tone: 'warning' },
  scammer: { label: 'Scammer', tone: 'danger' },
  unknown: { label: 'Not yet classified', tone: 'neutral' },
};

export function customerTypeLabel(value) {
  return lookup(CUSTOMER_TYPE_LABELS, value);
}

// ============================================
// Priority bucket
// ============================================
export const PRIORITY_LABELS = {
  critical: { label: 'Critical', description: 'Handle first', tone: 'danger' },
  high: { label: 'High', description: 'Handle today', tone: 'warning' },
  normal: { label: 'Normal', description: 'No rush', tone: 'neutral' },
  low: { label: 'Low', description: 'Safe to leave', tone: 'neutral' },
};

export function priorityLabel(value) {
  return lookup(PRIORITY_LABELS, value || 'normal');
}

// ============================================
// Risk level
// ============================================
export const RISK_LABELS = {
  LOW: { label: 'Low risk', tone: 'positive' },
  MEDIUM: { label: 'Medium risk', tone: 'warning' },
  HIGH: { label: 'High risk', tone: 'danger' },
  CRITICAL: { label: 'Critical risk', tone: 'danger' },
};

export function riskLabel(value) {
  return lookup(RISK_LABELS, String(value || 'LOW').toUpperCase());
}

// ============================================
// Recommended action — free-text-ish enum written by the assistant
// ============================================
export const RECOMMENDED_ACTION_LABELS = {
  ANSWER_PRICING: { label: 'Send your rates', tone: 'positive' },
  SEND_PORTFOLIO: { label: 'Share your portfolio', tone: 'positive' },
  HUMAN_ESCALATION: { label: 'Reply personally', tone: 'warning' },
  IGNORE_SPAM: { label: 'Ignore — spam', tone: 'warning' },
  BLOCK_OR_WARN_USER: { label: 'Block or report', tone: 'danger' },
  AWAIT_CUSTOMER_INQUIRY: { label: 'Wait for a real question', tone: 'neutral' },
  REVIEW_CONVERSATION: { label: 'Read and decide', tone: 'neutral' },
  REVIEW: { label: 'Read and decide', tone: 'neutral' },
};

export function recommendedActionLabel(value) {
  return lookup(RECOMMENDED_ACTION_LABELS, value || 'REVIEW');
}

// ============================================
// Reply mode — BusinessProfile.autoReplyMode
// ============================================
export const REPLY_MODE_LABELS = {
  smart: {
    label: 'Automatic',
    description: 'Siffty answers safe pricing, product, and service questions on your behalf.',
    tone: 'warning',
  },
  suggest_only: {
    label: 'Suggested replies',
    description: 'Siffty writes a draft. Nothing is sent until you send it.',
    tone: 'neutral',
  },
  human_only: {
    label: 'Manual',
    description: 'Siffty never sends anything. You write every reply yourself.',
    tone: 'positive',
  },
};

/** The database default. A profile with no value set never auto-sends. */
export const DEFAULT_REPLY_MODE = 'human_only';

export function replyModeLabel(value) {
  return lookup(REPLY_MODE_LABELS, value || DEFAULT_REPLY_MODE);
}

/** True only for the one mode that can send a message without you. */
export function replyModeSendsAutomatically(value) {
  return (value || DEFAULT_REPLY_MODE) === 'smart';
}

// ============================================
// Message processing state — Message.aiStatus
// ============================================
export const MESSAGE_STATUS_LABELS = {
  pending: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Reading', tone: 'neutral' },
  completed: { label: 'Reviewed', tone: 'positive' },
  auto_replied: { label: 'Answered automatically', tone: 'positive' },
  failed: { label: 'Could not read', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

export function messageStatusLabel(value) {
  return lookup(MESSAGE_STATUS_LABELS, value);
}

// ============================================
// Why an inbound message was not sorted — Message.aiSkipReason
// (set only when aiStatus is 'skipped'). No numbers: a paid plan's limits are
// fair-use guards, never published.
// ============================================
export const SKIP_REASON_LABELS = {
  not_entitled: { label: 'Not sorted', description: 'Arrived while there was no active trial or plan.', tone: 'warning' },
  cycle_cap: { label: 'Not sorted', description: "Arrived after this cycle's sorting allowance was used.", tone: 'warning' },
  hourly_throttle: {
    label: 'Not sorted',
    description: 'Arrived during an unusual burst of messages, so sorting paused.',
    tone: 'warning',
  },
};

const UNRECORDED_SKIP = { label: 'Not sorted', description: 'Sorting was unavailable when this arrived.', tone: 'warning' };

export function skipReasonLabel(value) {
  if (!value) return { ...UNRECORDED_SKIP };
  return SKIP_REASON_LABELS[value] ? { ...SKIP_REASON_LABELS[value] } : { ...UNRECORDED_SKIP };
}

// ============================================
// Instagram connection — InstagramAccount
// ============================================
export const CONNECTION_STATUS_LABELS = {
  CONNECTED: { label: 'Connected', tone: 'positive' },
  DISCONNECTED: { label: 'Disconnected', tone: 'warning' },
};

export const TOKEN_STATUS_LABELS = {
  VALID: { label: 'Active', description: 'Receiving messages normally', tone: 'positive' },
  NEEDS_RECONNECT: { label: 'Reconnect needed', description: 'Messages stop until you reconnect', tone: 'danger' },
};

export function connectionStatusLabel(value) {
  return lookup(CONNECTION_STATUS_LABELS, value || 'CONNECTED');
}

export function tokenStatusLabel(value) {
  return lookup(TOKEN_STATUS_LABELS, value || 'VALID');
}

// ============================================
// Brand deal pipeline — BRAND_DEAL_STATUSES
// ============================================
export const BRAND_DEAL_STATUS_LABELS = {
  new: { label: 'New', tone: 'positive' },
  contacted: { label: 'Contacted', tone: 'neutral' },
  negotiating: { label: 'Negotiating', tone: 'neutral' },
  confirmed: { label: 'Confirmed', tone: 'positive' },
  declined: { label: 'Declined', tone: 'warning' },
  expired: { label: 'Expired', tone: 'warning' },
};

export function brandDealStatusLabel(value) {
  return lookup(BRAND_DEAL_STATUS_LABELS, value);
}

// ============================================
// Account role
// ============================================
export const ROLE_LABELS = {
  ADMIN: { label: 'Administrator', tone: 'warning' },
  USER: { label: 'Standard account', tone: 'neutral' },
};

export function roleLabel(value) {
  return lookup(ROLE_LABELS, value || 'USER');
}

// ============================================
// Category priority weights set in Settings
// ============================================
export const PRIORITY_WEIGHT_LABELS = {
  critical: { label: 'Always first', tone: 'danger' },
  high: { label: 'High', tone: 'warning' },
  normal: { label: 'Normal', tone: 'neutral' },
  low: { label: 'Low', tone: 'neutral' },
  off: { label: 'Ignore', tone: 'neutral' },
};

export const PRIORITY_WEIGHT_ORDER = ['critical', 'high', 'normal', 'low', 'off'];

export function priorityWeightLabel(value) {
  return lookup(PRIORITY_WEIGHT_LABELS, value || 'normal');
}

// ============================================
// Reply tone
// ============================================
export const TONE_LABELS = {
  friendly: { label: 'Friendly', description: 'Warm and approachable' },
  professional: { label: 'Professional', description: 'Direct and businesslike' },
  casual: { label: 'Casual', description: 'Relaxed and conversational' },
  concise: { label: 'Concise', description: 'Short, no small talk' },
  warm: { label: 'Warm', description: 'Personal and welcoming' },
  custom: { label: 'Custom', description: 'Follows your own instructions' },
};

export const TONE_ORDER = ['friendly', 'professional', 'casual', 'concise', 'warm', 'custom'];

export function toneLabel(value) {
  return lookup(TONE_LABELS, value || 'friendly');
}

// ============================================
// Admin-side operational enums
// ============================================
export const ALERT_LEVEL_LABELS = {
  ERROR: { label: 'Action needed', tone: 'danger' },
  WARNING: { label: 'Worth checking', tone: 'warning' },
  INFO: { label: 'For information', tone: 'neutral' },
};

export const WEBHOOK_STATUS_LABELS = {
  SUCCESS: { label: 'Delivered', tone: 'positive' },
  FAILED: { label: 'Failed', tone: 'danger' },
  SKIPPED: { label: 'Skipped', tone: 'neutral' },
  SKIPPED_DISCONNECTED: { label: 'Skipped — account disconnected', tone: 'neutral' },
};

export function alertLevelLabel(value) {
  return lookup(ALERT_LEVEL_LABELS, value || 'INFO');
}

export function webhookStatusLabel(value) {
  return lookup(WEBHOOK_STATUS_LABELS, value);
}

// ============================================
// Notification types — backend NOTIFICATION_TYPES
// ============================================
export const NOTIFICATION_TYPE_LABELS = {
  new_lead: { label: 'New lead', tone: 'positive' },
  new_brand_deal: { label: 'Brand deal', tone: 'positive' },
  high_priority_conversation: { label: 'Needs your reply', tone: 'warning' },
  important_customer: { label: 'Customer opportunity', tone: 'positive' },
  ai_analysis_completed: { label: 'Conversation reviewed', tone: 'neutral' },
  scam_alert: { label: 'Scam warning', tone: 'danger' },
  needs_human_escalation: { label: 'Needs your reply', tone: 'warning' },
  instagram_connection_problem: { label: 'Connection problem', tone: 'danger' },
};

export function notificationTypeLabel(value) {
  return lookup(NOTIFICATION_TYPE_LABELS, value);
}

// ============================================
// Conversation list preview — non-text inbound messages.
// Confirmed against the live database (Gate 2, pre-Meta-review reel-filter
// fix): the messageType values actually seen are ig_reel, share, ig_post,
// video, image, text. Backend stores the raw type; this only decides what a
// business owner sees in the conversation-list preview.
// ============================================
export const MESSAGE_TYPE_PREVIEW_LABELS = {
  ig_reel: { label: 'Shared a reel' },
  share: { label: 'Shared a post' },
  ig_post: { label: 'Shared a post' },
  video: { label: 'Sent a video' },
  image: { label: 'Sent a photo' },
};

export function messageTypePreviewLabel(value) {
  return lookup(MESSAGE_TYPE_PREVIEW_LABELS, value).label;
}
