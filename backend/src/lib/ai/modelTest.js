/**
 * The admin "test this model" run (Gate 4).
 *
 * TEN SYNTHETIC DMs, written for this file — no customer's message, name or
 * business is ever used. The business profile is invented too. Each sample is
 * classified by the candidate provider/model with the exact production prompt
 * (aiService.buildClassificationPrompt) and checked against the one schema
 * (lib/ai/schema.js). Activation (routes/admin.js) is refused unless all ten
 * came back schema-valid.
 *
 * The run is recorded as an admin_audit_logs row (action AI_MODEL_TEST,
 * targetId = testRunId) holding the per-sample verdicts — no provider text —
 * so activation can check it in the database, and it survives a restart.
 */

const crypto = require('crypto');
const prisma = require('../prisma');
const router = require('./router');
const { validateClassification } = require('./schema');
const { isAllowed, priceOf } = require('./models');

const SYNTHETIC_BUSINESS = Object.freeze({
  businessName: 'Sample Studio',
  primaryCategory: 'video_editor',
  description: 'Short-form video editing for creators and small brands.',
  productsServices: 'Reel editing, YouTube Shorts, thumbnail design.',
  pricingInfo: 'Reels from INR 1,500. Monthly packages from INR 12,000.',
  locationDelivery: 'Remote, worldwide. Turnaround 2-3 days.',
  paymentMethods: 'UPI, bank transfer.',
});

const SAMPLES = Object.freeze([
  { id: 's1', text: 'Hi! How much do you charge to edit one reel?', expected: 'pricing_inquiry' },
  { id: 's2', text: 'Can you deliver 10 reels by Friday? I want to book the monthly package now.', expected: 'hot_lead' },
  { id: 's3', text: 'We are a skincare brand and would like to sponsor 2 reels. Budget is 20k, please share your rate card.', expected: 'brand_deal' },
  { id: 's4', text: 'Your editing style is amazing 🔥 keep it up', expected: 'fan' },
  { id: 's5', text: 'Your account will be suspended, verify now at bit.ly/xyz and send the OTP you receive', expected: 'scam' },
  { id: 's6', text: 'Get 10k real followers for just $5, DM us on telegram', expected: 'spam' },
  { id: 's7', text: 'I paid yesterday but have not received the edited video yet, what is the status?', expected: 'support_request' },
  { id: 's8', text: 'Do you also design YouTube thumbnails?', expected: 'service_inquiry' },
  { id: 's9', text: 'Are you available for a project next week?', expected: 'availability_inquiry' },
  { id: 's10', text: 'This is the worst service ever, I want my money back or I will report you', expected: 'support_request' },
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Last 30 days of production classification volume and average tokens. */
async function productionVolume() {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const agg = await prisma.aiCallLog.aggregate({
    where: { jobType: 'classification', success: true, createdAt: { gte: since } },
    _count: { _all: true },
    _avg: { inputTokens: true, outputTokens: true },
  });
  return { calls30d: agg._count._all, avgInput: agg._avg.inputTokens, avgOutput: agg._avg.outputTokens };
}

const monthlyCost = (price, calls, avgIn, avgOut) =>
  price && avgIn != null && avgOut != null ? (calls * (avgIn * price.input + avgOut * price.output)) / 1e6 : null;

/**
 * @returns {Promise<{testRunId, provider, model, allSchemaValid, results, cost}>}
 */
async function runModelTest({ provider, model, adminId, req }) {
  if (!isAllowed(provider, model)) {
    throw Object.assign(new Error('Not an allowed provider/model'), { code: 'NOT_ALLOWED' });
  }
  const aiService = require('../../services/aiService');
  const results = [];
  let inTok = 0;
  let outTok = 0;
  let counted = 0;

  for (const sample of SAMPLES) {
    const started = Date.now();
    const prompt = aiService.buildClassificationPrompt({
      messageText: sample.text,
      contactUsername: 'sample_customer',
      businessProfile: SYNTHETIC_BUSINESS,
    });
    try {
      const out = await router.callAI({ prompt, isJson: true, jobType: 'admin_test', target: { provider, model }, validate: undefined });
      const verdict = validateClassification(out.json);
      results.push({
        id: sample.id,
        sample: sample.text,
        expected: sample.expected,
        category: typeof out.json?.category === 'string' ? out.json.category.slice(0, 40) : null,
        schemaValid: verdict.valid,
        schemaErrors: verdict.errors.slice(0, 8),
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      results.push({
        id: sample.id,
        sample: sample.text,
        expected: sample.expected,
        category: null,
        schemaValid: false,
        errorCode: err.aiErrorCode || (err.response?.status ? `HTTP_${err.response.status}` : err.code === 'NO_PROVIDERS_CONFIGURED' ? 'NOT_CONFIGURED' : 'NETWORK'),
        latencyMs: Date.now() - started,
      });
    }
  }

  // Token averages for the candidate come from this run's logged calls.
  const logged = await prisma.aiCallLog.aggregate({
    where: { jobType: 'admin_test', provider, model, success: true, createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
    _avg: { inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  counted = logged._count._all;
  inTok = logged._avg.inputTokens;
  outTok = logged._avg.outputTokens;

  const current = await router.getAiConfig();
  const volume = await productionVolume();
  const cost = {
    basis: volume.calls30d > 0 ? 'last 30 days of production classifications' : 'no production classifications in the last 30 days',
    classifications30d: volume.calls30d,
    currentModel: current.active,
    currentMonthlyUsd: monthlyCost(priceOf(current.active.provider, current.active.model), volume.calls30d, volume.avgInput, volume.avgOutput),
    candidateMonthlyUsd: monthlyCost(priceOf(provider, model), volume.calls30d, counted ? inTok : volume.avgInput, counted ? outTok : volume.avgOutput),
    candidatePer1000Usd: monthlyCost(priceOf(provider, model), 1000, inTok, outTok),
    estimated: true,
  };

  const allSchemaValid = results.every((r) => r.schemaValid);
  const testRunId = crypto.randomUUID();
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: 'AI_MODEL_TEST',
      targetType: 'AI_CONFIG',
      targetId: testRunId,
      after: {
        provider,
        model,
        allSchemaValid,
        results: results.map((r) => ({ id: r.id, schemaValid: r.schemaValid, category: r.category, errorCode: r.errorCode || null })),
      },
      ip: req?.ip || null,
    },
  });

  return { testRunId, provider, model, allSchemaValid, results, cost };
}

/** A passing test of exactly this provider/model within the last 30 minutes, or null. */
async function findPassingTest(testRunId, { provider, model }) {
  if (typeof testRunId !== 'string' || !/^[0-9a-f-]{36}$/i.test(testRunId)) return null;
  const row = await prisma.adminAuditLog.findFirst({
    where: { action: 'AI_MODEL_TEST', targetId: testRunId, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
  });
  if (!row || !row.after) return null;
  const a = row.after;
  return a.provider === provider && a.model === model && a.allSchemaValid === true ? row : null;
}

module.exports = { runModelTest, findPassingTest, SAMPLES, SYNTHETIC_BUSINESS };
