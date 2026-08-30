/**
 * Creator preference helpers — used by the AI pipeline (to personalize
 * prioritization/tone) and by the /api/settings/ai route (to read/update
 * them). Every new user gets sane defaults on first access instead of
 * requiring an explicit setup step.
 */

const prisma = require('../lib/prisma');

async function getOrCreatePreferences(userId) {
  const existing = await prisma.creatorPreference.findUnique({ where: { userId } });
  if (existing) return existing;

  // upsert, not create — concurrent callers would otherwise race and one
  // would fail with P2002 on the unique userId.
  return prisma.creatorPreference.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
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
