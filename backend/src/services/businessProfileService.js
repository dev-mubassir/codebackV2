/**
 * Business Profile Service — manages persistent business context
 * that grounds AI DM analysis and safe auto-reply decisions.
 */

const prisma = require('../lib/prisma');

const DEFAULT_PROFILE = {
  businessName: '',
  businessTypes: JSON.stringify(['other']),
  primaryCategory: 'other',
  description: '',
  productsServices: '',
  pricingInfo: '',
  targetAudience: '',
  locationDelivery: '',
  paymentMethods: '',
  faqData: '',
  policies: '',
  contactPreferences: '',
  aiInstructions: '',
  prohibitedTopics: '',
  tone: 'friendly',
  // Auto-sending is opt-in. See the note on BusinessProfile.autoReplyMode in
  // prisma/schema.prisma — this must stay in sync with that @default and with
  // the profile created at registration in routes/auth.js.
  autoReplyMode: 'human_only',
  minConfidenceScore: 75,
};

async function getOrCreateBusinessProfile(userId) {
  if (!userId) throw new Error('userId is required');

  let profile = await prisma.businessProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    profile = await prisma.businessProfile.create({
      data: {
        userId,
        businessName: user?.name || '',
        ...DEFAULT_PROFILE,
      },
    });
  }

  return profile;
}

function sanitizeBusinessProfileUpdate(raw = {}) {
  const clean = {};

  if (typeof raw.businessName === 'string') clean.businessName = raw.businessName.slice(0, 200).trim();
  if (raw.businessTypes) {
    clean.businessTypes = Array.isArray(raw.businessTypes)
      ? JSON.stringify(raw.businessTypes)
      : String(raw.businessTypes).slice(0, 500);
  }
  if (typeof raw.primaryCategory === 'string') clean.primaryCategory = raw.primaryCategory.slice(0, 100).trim();
  if (typeof raw.description === 'string') clean.description = raw.description.slice(0, 2000).trim();
  if (typeof raw.productsServices === 'string') clean.productsServices = raw.productsServices.slice(0, 3000).trim();
  if (typeof raw.pricingInfo === 'string') clean.pricingInfo = raw.pricingInfo.slice(0, 1500).trim();
  if (typeof raw.targetAudience === 'string') clean.targetAudience = raw.targetAudience.slice(0, 1000).trim();
  if (typeof raw.locationDelivery === 'string') clean.locationDelivery = raw.locationDelivery.slice(0, 1000).trim();
  if (typeof raw.paymentMethods === 'string') clean.paymentMethods = raw.paymentMethods.slice(0, 1000).trim();
  if (typeof raw.faqData === 'string') clean.faqData = raw.faqData.slice(0, 4000).trim();
  if (typeof raw.policies === 'string') clean.policies = raw.policies.slice(0, 2000).trim();
  if (typeof raw.contactPreferences === 'string') clean.contactPreferences = raw.contactPreferences.slice(0, 1000).trim();
  if (typeof raw.aiInstructions === 'string') clean.aiInstructions = raw.aiInstructions.slice(0, 2500).trim();
  if (typeof raw.prohibitedTopics === 'string') clean.prohibitedTopics = raw.prohibitedTopics.slice(0, 1500).trim();

  const validTones = ['friendly', 'professional', 'casual', 'concise', 'warm', 'custom'];
  if (typeof raw.tone === 'string' && validTones.includes(raw.tone.toLowerCase())) {
    clean.tone = raw.tone.toLowerCase();
  }

  const validModes = ['smart', 'suggest_only', 'human_only'];
  if (typeof raw.autoReplyMode === 'string' && validModes.includes(raw.autoReplyMode)) {
    clean.autoReplyMode = raw.autoReplyMode;
  }

  if (typeof raw.minConfidenceScore === 'number') {
    clean.minConfidenceScore = Math.max(50, Math.min(99, Math.round(raw.minConfidenceScore)));
  }

  return clean;
}

module.exports = {
  getOrCreateBusinessProfile,
  sanitizeBusinessProfileUpdate,
  DEFAULT_PROFILE,
};
