/**
 * Codeback AI Service — conversation understanding, priority scoring, brand
 * deal extraction, conversation summaries, and on-demand reply drafting.
 *
 * Hard rules enforced by this module (do not relax these):
 *   1. AI NEVER sends a message. This service only ever returns text/data;
 *      only routes/api.js's POST /conversations/:id/reply (an explicit
 *      creator action) calls the Instagram send API.
 *   2. AI failure must never break messaging. Every public function here
 *      degrades to a safe, clearly-marked fallback instead of throwing.
 *   3. Model output is never trusted blindly — validateAnalysisResult()
 *      coerces/validates every field before it is allowed to reach the DB.
 *   4. Cost control — a free keyword pre-filter short-circuits obvious spam,
 *      replies are only ever generated on explicit creator request, and
 *      conversation summaries are only regenerated periodically (by the
 *      caller), never on every single message.
 */

const axios = require('axios');
const {
  CATEGORIES,
  CATEGORY_BASE_SCORE,
  PREFERENCE_WEIGHT_KEY_BY_CATEGORY,
  PREFERENCE_MULTIPLIER,
  scoreToPriorityBucket,
} = require('../lib/constants');

const SPAM_KEYWORDS = [
  'crypto', 'bitcoin', 'forex', 'grow your account', 'buy followers',
  'buy likes', 'telegram', 'whatsapp me', 'whatsapp group', 'investment opportunity',
  'invest', 'page manager', 'boost followers', 'dm to feature', 'dm @',
];

const BRAND_COLLAB_KEYWORDS = [
  'collab', 'collaboration', 'sponsorship', 'sponsor', 'brand deal',
  'paid partnership', 'ugc', 'ambassador', 'campaign', 'budget',
  'affiliate', 'gifted', 'promote', 'partnership', 'media kit', 'rate sheet', 'rates',
];

// ---- In-memory AI call / usage monitoring (surfaced in the admin panel) ----
const aiStats = {
  totalCalls: 0,
  keywordMatches: 0,
  aiSuccess: 0,
  aiFailures: 0,
  messagesAnalyzed: 0,
  brandDealsDetected: 0,
  summariesGenerated: 0,
  replyGenerations: 0,
  categoryCounts: Object.fromEntries(CATEGORIES.map((c) => [c, 0])),
};

function getAIStats() {
  return aiStats;
}

// ============================================
// Cheap pre-filter (no AI call, near-zero latency)
// ============================================
function classifyByKeywords(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const kw of SPAM_KEYWORDS) {
    if (lower.includes(kw)) {
      return { category: 'spam', confidence: 0.9, reason: `Matched spam keyword "${kw}"` };
    }
  }

  for (const kw of BRAND_COLLAB_KEYWORDS) {
    if (lower.includes(kw)) {
      // Strong signal, but we still run the full AI pass for brand-deal
      // conversations so we can extract structured deal fields (spec: brand
      // deal detection). We just flag the hint so the caller can prioritize.
      return { hint: 'brand_deal', matchedKeyword: kw };
    }
  }

  return null;
}

// ============================================
// Structured output validation — never trust the model blindly
// ============================================
function clamp(n, min, max) {
  const num = Number(n);
  if (Number.isNaN(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function truncate(str, max) {
  if (!str || typeof str !== 'string') return null;
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function sanitizeBrandDeal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Only keep a brand deal object if the model actually found a brand name
  // or campaign — otherwise there's nothing structured worth storing.
  if (!raw.brand_name && !raw.campaign) return null;

  return {
    brandName: truncate(raw.brand_name, 200) || null,
    campaign: truncate(raw.campaign, 300) || null,
    budgetAmount: typeof raw.budget_amount === 'number' ? raw.budget_amount : null,
    budgetCurrency: truncate(raw.budget_currency, 10) || null,
    deliverables: truncate(raw.deliverables, 500) || null,
    deadline: truncate(raw.deadline, 100) || null,
    contactEmail: truncate(raw.contact_email, 200) || null,
    website: truncate(raw.website, 300) || null,
    usageRights: truncate(raw.usage_rights, 300) || null,
    confidence: clamp(raw.confidence ?? 0.5, 0, 1),
  };
}

function validateAnalysisResult(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const category = CATEGORIES.includes(safe.category) ? safe.category : 'other';

  return {
    category,
    confidence: clamp(safe.confidence ?? 0.5, 0, 1),
    needsCreatorAttention: Boolean(safe.needs_creator_attention),
    summary: truncate(safe.summary, 400),
    reason: truncate(safe.reason, 300),
    brandDeal: category === 'brand_deal' || category === 'collaboration' ? sanitizeBrandDeal(safe.brand_deal) : null,
  };
}

// ============================================
// Deterministic priority scoring (spec 12) — AI signals blended with
// creator preferences so the score stays explainable and controllable
// without needing a fresh AI call whenever preferences change.
// ============================================
function computePriorityScore({ category, confidence = 0.5, needsCreatorAttention = false }, preferences = null) {
  const base = CATEGORY_BASE_SCORE[category] ?? CATEGORY_BASE_SCORE.other;
  const prefKey = PREFERENCE_WEIGHT_KEY_BY_CATEGORY[category] || 'questionsPriority';
  const prefLevel = preferences?.[prefKey] || 'normal';
  const multiplier = PREFERENCE_MULTIPLIER[prefLevel] ?? 1;

  let score = base * multiplier * (0.6 + 0.4 * clamp(confidence, 0, 1));
  if (needsCreatorAttention) score += 10;

  score = Math.round(clamp(score, 0, 100));
  return { score, priority: scoreToPriorityBucket(score) };
}

// ============================================
// Conversation context builder — bounded, compact, no unbounded history
// ============================================
function buildContextBlock(recentMessages = [], creatorUsername = 'the creator') {
  return recentMessages
    .slice(-10)
    .map((m) => `${m.direction === 'inbound' ? 'Sender' : creatorUsername}: ${m.content || `[${m.messageType || 'attachment'}]`}`)
    .join('\n');
}

// ============================================
// Provider calls — Gemini (default) with OpenAI as an alternative
// ============================================
async function callGeminiJSON(prompt, { timeout = 12000 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('GEMINI_API_KEY is missing in backend/.env');
  }

  const models = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        },
        { timeout }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return { json: JSON.parse(text), model };
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status === 404 || status === 429) continue;
      throw err;
    }
  }

  throw lastError || new Error('Failed to generate content with Gemini API');
}

async function callOpenAIJSON(prompt, { timeout = 12000 } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout }
  );

  const content = response.data?.choices?.[0]?.message?.content;
  return { json: JSON.parse(content), model: 'gpt-4o-mini' };
}

async function callAIProvider(prompt, opts) {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  return provider === 'openai' ? callOpenAIJSON(prompt, opts) : callGeminiJSON(prompt, opts);
}

// ============================================
// 1. Conversation analysis — classification + priority signal + brand deal
//    extraction, all in a single AI call to keep cost/latency down.
// ============================================
async function analyzeConversation({ messageText, contactUsername, recentMessages = [], preferences = null }) {
  if (!messageText || typeof messageText !== 'string') {
    return { category: 'other', confidence: 0, needsCreatorAttention: false, summary: null, reason: null, brandDeal: null, model: 'keyword-engine', priorityScore: 0, priority: 'low', failed: false };
  }

  // Cheap pre-filter: obvious spam never needs an AI call.
  const keywordHit = classifyByKeywords(messageText);
  if (keywordHit && keywordHit.category === 'spam') {
    aiStats.keywordMatches++;
    aiStats.categoryCounts.spam++;
    const scored = computePriorityScore({ category: 'spam', confidence: keywordHit.confidence }, preferences);
    return {
      category: 'spam',
      confidence: keywordHit.confidence,
      needsCreatorAttention: false,
      summary: null,
      reason: keywordHit.reason,
      brandDeal: null,
      model: 'keyword-engine',
      priorityScore: scored.score,
      priority: scored.priority,
      failed: false,
    };
  }

  aiStats.totalCalls++;
  aiStats.messagesAnalyzed++;

  const contextBlock = buildContextBlock(recentMessages, 'Creator');
  const prompt = `You are an AI assistant that reads Instagram DMs for a content creator so they don't have to read every message themselves.

Recent conversation (oldest first):
${contextBlock || '(no prior messages)'}

Latest message from @${contactUsername || 'user'}: "${messageText.replace(/"/g, '\\"')}"

Classify this conversation into exactly one category:
${CATEGORIES.map((c) => `- ${c}`).join('\n')}

Then decide if it needs the creator's personal attention, write a one-sentence summary of what this conversation is about, and briefly explain why you chose this category.

If (and only if) this looks like a brand/business collaboration or sponsorship, extract any structured deal information that was EXPLICITLY mentioned. Never invent information — use null for anything not stated.

Return ONLY valid JSON in exactly this shape:
{
  "category": "one of: ${CATEGORIES.join(', ')}",
  "confidence": 0.0-1.0,
  "needs_creator_attention": true or false,
  "summary": "short one-sentence summary",
  "reason": "brief reason for the classification",
  "brand_deal": {
    "brand_name": string or null,
    "campaign": string or null,
    "budget_amount": number or null,
    "budget_currency": string or null,
    "deliverables": string or null,
    "deadline": string or null,
    "contact_email": string or null,
    "website": string or null,
    "usage_rights": string or null,
    "confidence": 0.0-1.0
  } or null
}`;

  try {
    const { json, model } = await callAIProvider(prompt);
    const validated = validateAnalysisResult(json);
    const scored = computePriorityScore(validated, preferences);

    aiStats.aiSuccess++;
    aiStats.categoryCounts[validated.category] = (aiStats.categoryCounts[validated.category] || 0) + 1;
    if (validated.brandDeal) aiStats.brandDealsDetected++;

    return { ...validated, model, priorityScore: scored.score, priority: scored.priority, failed: false, rawResponse: json };
  } catch (error) {
    aiStats.aiFailures++;
    console.warn(`[AIService] Analysis failed (${error.message}). Message stays visible; category falls back to "other".`);
    const scored = computePriorityScore({ category: 'other', confidence: 0 }, preferences);
    return {
      category: 'other',
      confidence: 0,
      needsCreatorAttention: false,
      summary: null,
      reason: null,
      brandDeal: null,
      model: null,
      priorityScore: scored.score,
      priority: scored.priority,
      failed: true,
      errorMessage: error.message,
    };
  }
}

// ============================================
// 2. Conversation summary — periodic, not per-message (caller decides when)
// ============================================
async function summarizeConversation({ recentMessages = [], previousSummary = null, brandDeal = null }) {
  const contextBlock = buildContextBlock(recentMessages, 'Creator');
  const brandContext = brandDeal
    ? `\nKnown brand deal info so far: ${JSON.stringify({
        brand: brandDeal.brandName,
        budget: brandDeal.budgetAmount ? `${brandDeal.budgetAmount} ${brandDeal.budgetCurrency || ''}`.trim() : null,
        deliverables: brandDeal.deliverables,
        deadline: brandDeal.deadline,
      })}`
    : '';

  const prompt = `Summarize this Instagram DM conversation for a busy creator who has not read it yet.
${previousSummary ? `Previous summary: "${previousSummary}"\n` : ''}
Conversation so far:
${contextBlock || '(no messages)'}
${brandContext}

Return ONLY valid JSON:
{
  "summary": "2-4 sentences covering who this is, what they want, and current status",
  "stage": "short phrase describing what's needed next, e.g. 'Waiting for campaign details' or null"
}`;

  try {
    const { json } = await callAIProvider(prompt);
    aiStats.summariesGenerated++;
    return {
      summary: truncate(json?.summary, 600) || previousSummary || null,
      stage: truncate(json?.stage, 150),
      failed: false,
    };
  } catch (error) {
    console.warn(`[AIService] Summary generation failed: ${error.message}`);
    return { summary: previousSummary || null, stage: null, failed: true, errorMessage: error.message };
  }
}

// ============================================
// 3. On-demand reply generation — ONLY called from an explicit creator
//    action (POST /api/conversations/:id/generate-reply). Never automatic.
// ============================================
async function generateReply({ recentMessages = [], contactUsername, brandDeal = null, preferences = null, instructions = null, category = 'other' }) {
  const contextBlock = buildContextBlock(recentMessages, 'Creator');
  const tone = preferences?.tone || 'friendly';
  const customInstructions = preferences?.customInstructions ? `\nCreator's personal style notes: ${preferences.customInstructions}` : '';

  const brandContext = brandDeal
    ? `\nThis is a brand collaboration conversation. Known details: brand="${brandDeal.brandName || 'unknown'}", budget="${
        brandDeal.budgetAmount ? `${brandDeal.budgetAmount} ${brandDeal.budgetCurrency || ''}`.trim() : 'unknown'
      }", deliverables="${brandDeal.deliverables || 'unknown'}", deadline="${brandDeal.deadline || 'unknown'}". If key details (budget, deliverables, timeline, usage rights) are missing, politely ask for them.`
    : '';

  const prompt = `You are drafting ONE Instagram DM reply on behalf of a content creator. The creator will review and edit this before sending — you are NOT sending anything yourself.

Conversation category: ${category}
Desired tone: ${tone}${customInstructions}${brandContext}

Conversation so far:
${contextBlock || '(no prior messages)'}
${instructions ? `\nSpecific instruction from the creator for this reply: "${instructions}"` : ''}

Write only the reply text — short, natural, human, no explanations, no quotation marks around it.`;

  try {
    const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
    let text;
    let model;

    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] },
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 }
      );
      text = response.data?.choices?.[0]?.message?.content?.trim();
      model = 'gpt-4o-mini';
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || !apiKey.trim()) throw new Error('GEMINI_API_KEY is missing in backend/.env');
      const models = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];
      let lastError = null;
      for (const m of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey.trim()}`;
          const response = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }] }, { timeout: 15000 });
          text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          model = m;
          if (text) break;
        } catch (err) {
          lastError = err;
          const status = err.response?.status;
          if (status === 404 || status === 429) continue;
          throw err;
        }
      }
      if (!text) throw lastError || new Error('Failed to generate a reply with Gemini API');
    }

    aiStats.replyGenerations++;
    return { text: text?.replace(/^"|"$/g, '') || null, model, failed: false };
  } catch (error) {
    console.warn(`[AIService] Reply generation failed: ${error.message}`);
    return { text: null, model: null, failed: true, errorMessage: error.message };
  }
}

module.exports = {
  analyzeConversation,
  summarizeConversation,
  generateReply,
  computePriorityScore,
  classifyByKeywords,
  validateAnalysisResult,
  getAIStats,
};
