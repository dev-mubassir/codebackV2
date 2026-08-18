/**
 * Creator preference helpers — used by the AI pipeline (to personalize
 * prioritization/tone) and by the /api/settings/ai route (to read/update
 * them). Every new user gets sane defaults on first access instead of
 * requiring an explicit setup step.
 */

const prisma = require('../lib/prisma');

async function getOrCreatePreferences(userId) {
  let prefs = await prisma.creatorPreference.findUnique({ where: { userId } });
  if (!prefs) {
    prefs = await prisma.creatorPreference.create({ data: { userId } });
  }
  return prefs;
}

const ALLOWED_LEVELS = ['critical', 'high', 'normal', 'low', 'off'];
const ALLOWED_TONES = ['friendly', 'professional', 'casual', 'custom'];

function sanitizePreferenceUpdate(body = {}) {
  const update = {};

  for (const key of ['brandDealsPriority', 'collaborationsPriority', 'customersPriority', 'fanPriority', 'questionsPriority', 'spamPriority']) {
    if (body[key] !== undefined && ALLOWED_LEVELS.includes(body[key])) {
      update[key] = body[key];
    }
  }

  if (body.tone !== undefined && ALLOWED_TONES.includes(body.tone)) {
    update.tone = body.tone;
  }

  if (body.customInstructions !== undefined) {
    update.customInstructions = typeof body.customInstructions === 'string' ? body.customInstructions.slice(0, 1000) : null;
  }

  if (body.autoGenerateSummary !== undefined) {
    update.autoGenerateSummary = Boolean(body.autoGenerateSummary);
  }

  return update;
}

module.exports = { getOrCreatePreferences, sanitizePreferenceUpdate, ALLOWED_LEVELS, ALLOWED_TONES };
