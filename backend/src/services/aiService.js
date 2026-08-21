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
  providerFailovers: 0,
  messagesAnalyzed: 0,
  brandDealsDetected: 0,
  summariesGenerated: 0,
  replyGenerations: 0,
  categoryCounts: Object.fromEntries(CATEGORIES.map((c) => [c, 0])),
  lastSuccessfulProvider: null,
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

function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  // 1. Try direct parse
  try {
    return JSON.parse(trimmed);
  } catch (e) {}

  // 2. Try extracting from markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {}
  }

  // 3. Try finding outermost { ... }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (e) {}
  }

  return null;
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
// AI Provider Implementations
// ============================================

/**
 * 1. Google Gemini Provider
 */
async function callGemini(apiKey, { prompt, isJson, timeout = 15000 }) {
  if (!apiKey || !apiKey.trim()) throw new Error('GEMINI_API_KEY is not configured');

  const models = [
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemma-4-26b-a4b-it',
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
      };
      if (isJson) {
        payload.generationConfig = { responseMimeType: 'application/json' };
      }

      const response = await axios.post(url, payload, { timeout });
      const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;

      if (isJson) {
        const parsed = extractJSON(rawText);
        if (!parsed) continue;
        return { json: parsed, text: rawText, model, provider: 'gemini' };
      }

      return { text: rawText.trim(), model, provider: 'gemini' };
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      // If invalid API key (400 with API_KEY_INVALID), immediately stop this provider so failover happens quickly
      if (status === 400 && (err.response?.data?.error?.message?.includes('API key not valid') || err.response?.data?.error?.message?.includes('API_KEY_INVALID'))) {
        throw err;
      }
      // On transient issues (503, 500, 429, 404, timeouts), try next Gemini model
      continue;
    }
  }

  throw lastError || new Error('All Gemini models failed');
}

/**
 * 2. xAI (Grok) Provider
 */
async function callXAI(apiKey, { prompt, isJson, timeout = 15000 }) {
  if (!apiKey || !apiKey.trim()) throw new Error('GROK/xAI API key is not configured');

  const models = ['grok-3-mini', 'grok-2-latest', 'grok-beta'];
  let lastError = null;

  for (const model of models) {
    try {
      const payload = {
        model,
        messages: [{ role: 'user', content: prompt }],
      };
      if (isJson) {
        payload.response_format = { type: 'json_object' };
      }

      const response = await axios.post('https://api.x.ai/v1/chat/completions', payload, {
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        timeout,
      });

      const rawText = response.data?.choices?.[0]?.message?.content;
      if (!rawText) continue;

      if (isJson) {
        const parsed = extractJSON(rawText);
        if (!parsed) continue;
        return { json: parsed, text: rawText, model, provider: 'xai' };
      }

      return { text: rawText.trim(), model, provider: 'xai' };
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      // If bad API key (400/401 with Incorrect API key), immediately stop this provider
      if (status === 400 && err.response?.data?.error?.includes('Incorrect API key provided')) {
        throw err;
      }
      if (status === 401) {
        throw err;
      }
      // Otherwise try next xAI model
      continue;
    }
  }

  throw lastError || new Error('All xAI Grok models failed');
}

/**
 * 3. OpenAI Provider
 */
async function callOpenAI(apiKey, { prompt, isJson, timeout = 15000 }) {
  if (!apiKey || !apiKey.trim()) throw new Error('OPENAI_API_KEY is not configured');

  const models = ['gpt-4o-mini', 'gpt-4o'];
  let lastError = null;

  for (const model of models) {
    try {
      const payload = {
        model,
        messages: [{ role: 'user', content: prompt }],
      };
      if (isJson) {
        payload.response_format = { type: 'json_object' };
      }

      const response = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        timeout,
      });

      const rawText = response.data?.choices?.[0]?.message?.content;
      if (!rawText) continue;

      if (isJson) {
        const parsed = extractJSON(rawText);
        if (!parsed) continue;
        return { json: parsed, text: rawText, model, provider: 'openai' };
      }

      return { text: rawText.trim(), model, provider: 'openai' };
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status === 401) throw err;
      continue;
    }
  }

  throw lastError || new Error('All OpenAI models failed');
}

// ============================================
// Multi-Provider Auto-Failover Orchestrator
// If primary AI key fails -> immediately & seamlessly shifts to next provider!
// ============================================
function getProviderChain() {
  const primaryPref = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const grokKey = (process.env.GROK_API_KEY || process.env.XAI_API_KEY || (process.env.OPENAI_API_KEY?.startsWith('xai-') ? process.env.OPENAI_API_KEY : null))?.trim();
  const rawOpenAIKey = process.env.OPENAI_API_KEY?.trim();
  const standardOpenAIKey = (rawOpenAIKey && !rawOpenAIKey.startsWith('xai-') ? rawOpenAIKey : null);

  const available = {};

  if (geminiKey) {
    available.gemini = {
      name: 'Google Gemini',
      id: 'gemini',
      call: (opts) => callGemini(geminiKey, opts),
    };
  }

  if (grokKey) {
    available.xai = {
      name: 'xAI (Grok)',
      id: 'xai',
      call: (opts) => callXAI(grokKey, opts),
    };
  }

  if (standardOpenAIKey) {
    available.openai = {
      name: 'OpenAI',
      id: 'openai',
      call: (opts) => callOpenAI(standardOpenAIKey, opts),
    };
  }

  // Handle generic OPENAI_API_KEY if not already parsed as standard key
  if (rawOpenAIKey && !available.openai && !available.xai) {
    available.openai_or_grok = {
      name: 'xAI Grok / OpenAI Key',
      id: 'openai_or_grok',
      call: async (opts) => {
        try {
          return await callXAI(rawOpenAIKey, opts);
        } catch (xaiErr) {
          return await callOpenAI(rawOpenAIKey, opts);
        }
      },
    };
  }

  // Determine fallback order based on primary preference
  let order;
  if (primaryPref === 'grok' || primaryPref === 'xai') {
    order = ['xai', 'openai_or_grok', 'gemini', 'openai'];
  } else if (primaryPref === 'openai') {
    order = ['openai', 'openai_or_grok', 'gemini', 'xai'];
  } else {
    // Default: Gemini first, then Grok, then OpenAI
    order = ['gemini', 'xai', 'openai_or_grok', 'openai'];
  }

  const chain = [];
  const seen = new Set();
  for (const key of order) {
    if (available[key] && !seen.has(available[key].name)) {
      chain.push(available[key]);
      seen.add(available[key].name);
    }
  }

  return chain;
}

async function callAIWithFailover({ prompt, isJson = true, timeout = 12000 }) {
  const chain = getProviderChain();

  if (chain.length === 0) {
    throw new Error('No AI provider keys configured in backend/.env (set GEMINI_API_KEY, GROK_API_KEY, or OPENAI_API_KEY)');
  }

  let lastError = null;
  const attempted = [];

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    attempted.push(provider.name);

    try {
      const result = await provider.call({ prompt, isJson, timeout });
      if (result) {
        aiStats.lastSuccessfulProvider = provider.id;
        if (i > 0) {
          console.log(`[AIService] 🔄 Auto-failover successful! Recovered using "${provider.name}" (Model: ${result.model})`);
        }
        return result;
      }
    } catch (err) {
      lastError = err;
      aiStats.providerFailovers++;
      const nextProvider = chain[i + 1];
      if (nextProvider) {
        console.warn(`[AIService] ⚠️ Provider "${provider.name}" failed: ${err.message}. Auto-shifting to next provider "${nextProvider.name}"...`);
      } else {
        console.warn(`[AIService] ⚠️ Provider "${provider.name}" failed: ${err.message}.`);
      }
    }
  }

  throw new Error(`All configured AI providers failed [${attempted.join(' ➔ ')}]. Last error: ${lastError?.message}`);
}

// ============================================
// 1. Conversation analysis — classification + priority signal + brand deal
//    extraction, all in a single AI call with automatic failover.
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
    const { json, model, provider } = await callAIWithFailover({ prompt, isJson: true });
    const validated = validateAnalysisResult(json);
    const scored = computePriorityScore(validated, preferences);

    aiStats.aiSuccess++;
    aiStats.categoryCounts[validated.category] = (aiStats.categoryCounts[validated.category] || 0) + 1;
    if (validated.brandDeal) aiStats.brandDealsDetected++;

    return { ...validated, model, provider, priorityScore: scored.score, priority: scored.priority, failed: false, rawResponse: json };
  } catch (error) {
    aiStats.aiFailures++;
    console.warn(`[AIService] Analysis degraded to fallback (${error.message}). Message stays visible; category falls back to "other".`);
    const scored = computePriorityScore({ category: 'other', confidence: 0 }, preferences);
    return {
      category: 'other',
      confidence: 0,
      needsCreatorAttention: false,
      summary: null,
      reason: null,
      brandDeal: null,
      model: null,
      provider: null,
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
    const { json, model, provider } = await callAIWithFailover({ prompt, isJson: true });
    aiStats.summariesGenerated++;
    return {
      summary: truncate(json?.summary, 600) || previousSummary || null,
      stage: truncate(json?.stage, 150),
      model,
      provider,
      failed: false,
    };
  } catch (error) {
    console.warn(`[AIService] Summary generation degraded to fallback: ${error.message}`);
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
    const { text, model, provider } = await callAIWithFailover({ prompt, isJson: false, timeout: 15000 });
    aiStats.replyGenerations++;
    return { text: text?.replace(/^"|"$/g, '') || null, model, provider, failed: false };
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
  callAIWithFailover,
};

