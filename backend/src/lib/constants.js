/**
 * Canonical constants for conversation classification and priority scoring.
 *
 * The VALUES here are stored in the database and sent in API payloads, so they
 * never change. Their human labels live in frontend/src/content/labels.js and
 * are resolved at render time only.
 *
 * Supports Creators, Video/Photo Editors, Product Sellers, Freelancers, Local Businesses,
 * Coaches, E-Commerce, Agencies, and more.
 */

const CATEGORIES = [
  // Commercial & Sales inquiries
  'product_inquiry',       // Product specs, price, stock, condition, warranty
  'service_inquiry',       // Service scope, portfolio, turnaround, custom work
  'pricing_inquiry',       // Price check, rates, quotes, package cost
  'availability_inquiry',  // In-stock, calendar booking, appointment slot
  'delivery_inquiry',      // Shipping options, delivery timeframe, location coverage
  'hot_lead',              // Ready to buy/book immediately with high commercial intent
  'lead',                  // General qualified commercial prospect

  // Relationship & Support
  'customer',              // Existing client, recurring buyer
  'support_request',       // Post-purchase questions, troubleshooting, order tracking
  'general_question',      // General FAQ, business hours, contact info

  // Creator & Partnerships
  'brand_deal',            // Paid brand sponsorship, media campaign
  'collaboration',         // Creative collab, UGC, barter, affiliate

  // Social & Non-commercial
  'fan',                   // Casual compliment, praise, emoji, friendly chat

  // Security & Negative
  'spam',                  // Unsolicited promotion, crypto, buy followers
  'scam',                  // Fraud, OTP requests, fake payment proof, phishing
  'abusive',               // Harassment, toxic language, insults

  // Catch-all
  'other',
];

const CUSTOMER_TYPES = [
  'potential_buyer',
  'hot_lead',
  'lead',
  'existing_customer',
  'collaborator',
  'casual_fan',
  'spammer',
  'scammer',
  'unknown',
];

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

const LEGACY_CATEGORY_MAP = {
  'Brand/Collab': 'brand_deal',
  Business: 'service_inquiry',
  Question: 'general_question',
  question: 'general_question',
  business_inquiry: 'service_inquiry',
  Fan: 'fan',
  Spam: 'spam',
  Other: 'other',
  support: 'support_request',
};

function normalizeCategory(category) {
  if (!category) return 'other';
  if (CATEGORIES.includes(category)) return category;
  if (LEGACY_CATEGORY_MAP[category]) return LEGACY_CATEGORY_MAP[category];
  return 'other';
}

const PRIORITIES = ['critical', 'high', 'normal', 'low'];

// Base priority weight per category before user preferences / signals are applied.
const CATEGORY_BASE_SCORE = {
  hot_lead: 95,
  brand_deal: 90,
  product_inquiry: 80,
  service_inquiry: 80,
  pricing_inquiry: 75,
  availability_inquiry: 70,
  collaboration: 68,
  customer: 65,
  support_request: 65,
  delivery_inquiry: 60,
  lead: 60,
  general_question: 45,
  fan: 25,
  other: 20,
  spam: 0,
  scam: 5,
  abusive: 5,
};

const PREFERENCE_WEIGHT_KEY_BY_CATEGORY = {
  hot_lead: 'customersPriority',
  product_inquiry: 'customersPriority',
  service_inquiry: 'customersPriority',
  pricing_inquiry: 'customersPriority',
  availability_inquiry: 'customersPriority',
  delivery_inquiry: 'customersPriority',
  customer: 'customersPriority',
  support_request: 'customersPriority',
  lead: 'customersPriority',
  brand_deal: 'brandDealsPriority',
  collaboration: 'collaborationsPriority',
  general_question: 'questionsPriority',
  fan: 'fanPriority',
  spam: 'spamPriority',
  scam: 'spamPriority',
  abusive: 'spamPriority',
  other: 'questionsPriority',
};

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
  'new_lead',
  'new_brand_deal',
  'high_priority_conversation',
  'important_customer',
  'ai_analysis_completed',
  'scam_alert',
  'needs_human_escalation',
  'instagram_connection_problem',
];

const BRAND_DEAL_STATUSES = ['new', 'contacted', 'negotiating', 'confirmed', 'declined', 'expired'];

const SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due', 'cancelled', 'expired'];

const AI_MESSAGE_STATUSES = ['pending', 'processing', 'completed', 'failed', 'skipped'];

module.exports = {
  CATEGORIES,
  CUSTOMER_TYPES,
  RISK_LEVELS,
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
