/**
 * Canonical, extensible constants for Codeback's AI classification system.
 *
 * The frontend must never hard-code around only this list — it renders
 * unknown/future categories with a generic fallback style (see
 * frontend/src/lib/categories.js). Adding a new category here is enough to
 * extend the system end-to-end.
 *
 * Legacy note: earlier versions of Codeback stored Title-Case categories
 * directly on Message/Conversation (e.g. "Brand/Collab", "Business"). Old
 * rows keep those values for history; LEGACY_CATEGORY_MAP translates them to
 * the new canonical ids so priority logic and the UI treat them the same.
 */

const CATEGORIES = [
  'brand_deal',
  'collaboration',
  'fan',
  'question',
  'customer',
  'business_inquiry',
  'support',
  'spam',
  'other',
];

const LEGACY_CATEGORY_MAP = {
  'Brand/Collab': 'brand_deal',
  Business: 'business_inquiry',
  Question: 'question',
  Fan: 'fan',
  Spam: 'spam',
  Other: 'other',
};

function normalizeCategory(category) {
  if (!category) return 'other';
  if (CATEGORIES.includes(category)) return category;
  if (LEGACY_CATEGORY_MAP[category]) return LEGACY_CATEGORY_MAP[category];
  return 'other';
}

const PRIORITIES = ['critical', 'high', 'normal', 'low'];

// Base priority weight per category before creator preferences / signals are
// applied. Higher number = more important. Used as the starting point for
// computePriorityScore() in services/aiService.js.
const CATEGORY_BASE_SCORE = {
  brand_deal: 85,
  collaboration: 70,
  customer: 65,
  business_inquiry: 55,
  question: 40,
  fan: 25,
  support: 50,
  spam: 0,
  other: 20,
};

const PREFERENCE_WEIGHT_KEY_BY_CATEGORY = {
  brand_deal: 'brandDealsPriority',
  collaboration: 'collaborationsPriority',
  customer: 'customersPriority',
  business_inquiry: 'customersPriority',
  support: 'customersPriority',
  fan: 'fanPriority',
  question: 'questionsPriority',
  spam: 'spamPriority',
  other: 'questionsPriority',
};

// Multiplier applied to the base score depending on how important the
// creator says this type of conversation is to them.
const PREFERENCE_MULTIPLIER = {
  critical: 1.4,
  high: 1.15,
  normal: 1,
  low: 0.6,
  off: 0.15,
};

function scoreToPriorityBucket(score) {
  if (score >= 80) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 25) return 'normal';
  return 'low';
}

const NOTIFICATION_TYPES = [
  'new_brand_deal',
  'high_priority_conversation',
  'important_customer',
  'ai_analysis_completed',
  'instagram_connection_problem',
];

const BRAND_DEAL_STATUSES = ['new', 'contacted', 'negotiating', 'confirmed', 'declined', 'expired'];

const SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due', 'cancelled', 'expired'];

const AI_MESSAGE_STATUSES = ['pending', 'processing', 'completed', 'failed', 'skipped'];

module.exports = {
  CATEGORIES,
  LEGACY_CATEGORY_MAP,
  normalizeCategory,
  PRIORITIES,
  CATEGORY_BASE_SCORE,
  PREFERENCE_WEIGHT_KEY_BY_CATEGORY,
  PREFERENCE_MULTIPLIER,
  scoreToPriorityBucket,
  NOTIFICATION_TYPES,
  BRAND_DEAL_STATUSES,
  SUBSCRIPTION_STATUSES,
  AI_MESSAGE_STATUSES,
};
