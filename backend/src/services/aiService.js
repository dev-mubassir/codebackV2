/**
 * Codeback Generalized AI Service — multi-tenant customer intelligence,
 * lead qualification, brand deal extraction, conversation summaries,
 * and safe auto-reply generation.
 *
 * Supports Creators, Video/Photo Editors, Product Sellers, Freelancers, Local Businesses,
 * Coaches, E-Commerce, Agencies, and more.
 */

const axios = require('axios');
const {
  CATEGORIES,
  CUSTOMER_TYPES,
  RISK_LEVELS,
  CATEGORY_BASE_SCORE,
  PREFERENCE_WEIGHT_KEY_BY_CATEGORY,
  PREFERENCE_MULTIPLIER,
  scoreToPriorityBucket,
  normalizeCategory,
} = require('../lib/constants');

const SPAM_KEYWORDS = [
  'buy followers', 'buy likes', 'boost followers', 'grow your account',
  'telegram channel', 'telegram group', 'whatsapp group', 'dm to feature', 'dm @',
  'page manager', 'crypto investment', 'forex trading', 'double your money',
];

const SCAM_KEYWORDS = [
  'send otp', 'share password', 'send verification code', 'login to this link',
  'account suspended click here', 'claim prize send fee', 'transfer bitcoin',
  'seed phrase', 'send bank login', 'overpaid refund difference',
];

const BRAND_COLLAB_KEYWORDS = [
  'collab', 'collaboration', 'sponsorship', 'sponsor', 'brand deal',
  'paid partnership', 'ugc', 'ambassador', 'campaign', 'budget',
  'affiliate', 'gifted', 'promote', 'partnership', 'media kit', 'rate sheet', 'rates',
];

// In-memory AI call monitoring
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
// Cheap pre-filter (no AI call, zero latency)
// ============================================
function classifyByKeywords(messageText) {
  if (!messageText || typeof messageText !== 'string') return null;
  const lower = messageText.toLowerCase();

  for (const kw of SCAM_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        category: 'scam',
        intent: 'scam_attempt',
        customerType: 'scammer',
        confidence: 0.95,
        riskLevel: 'CRITICAL',
        scamProbability: 95,
        requiresHumanAttention: true,
        shouldAutoReply: false,
        recommendedAction: 'BLOCK_OR_WARN_USER',
        reason: `Flagged for potential scam/phishing keyword: "${kw}"`,
      };
    }
  }

  for (const kw of SPAM_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        category: 'spam',
        intent: 'unsolicited_spam',
        customerType: 'spammer',
        confidence: 0.9,
        riskLevel: 'LOW',
        scamProbability: 10,
        requiresHumanAttention: false,
        shouldAutoReply: false,
        recommendedAction: 'IGNORE_SPAM',
        reason: `Matched spam keyword "${kw}"`,
      };
    }
  }

  return null;
}

// ============================================
// Helpers & Sanitizers
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

  // 1. Direct parse
  try {
    return JSON.parse(trimmed);
  } catch (e) {}

  // 2. Markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {}
  }

  // 3. Outermost { ... }
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
  const category = normalizeCategory(safe.category);
  const rawRisk = String(safe.risk_level || safe.riskLevel || 'LOW').toUpperCase();
  const riskLevel = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(rawRisk) ? rawRisk : 'LOW';

  const rawCustomerType = String(safe.customer_type || safe.customerType || 'unknown').toLowerCase();
  const customerType = CUSTOMER_TYPES.includes(rawCustomerType) ? rawCustomerType : 'unknown';

  return {
    category,
    intent: truncate(safe.intent, 100) || category,
    customerType,
    purchaseIntent: Math.round(clamp(safe.purchase_intent ?? safe.purchaseIntent ?? 0, 0, 100)),
    leadQuality: Math.round(clamp(safe.lead_quality ?? safe.leadQuality ?? 0, 0, 100)),
    commercialRelevance: Math.round(clamp(safe.commercial_relevance ?? safe.commercialRelevance ?? 0, 0, 100)),
    urgency: Math.round(clamp(safe.urgency ?? 0, 0, 100)),
    riskLevel,
    scamProbability: Math.round(clamp(safe.scam_probability ?? safe.scamProbability ?? 0, 0, 100)),
    sentiment: truncate(safe.sentiment, 50) || 'neutral',
    confidence: clamp(safe.confidence ?? 0.5, 0, 1),
    needsCreatorAttention: Boolean(safe.requires_human_attention ?? safe.needs_creator_attention ?? safe.needsCreatorAttention),
    shouldAutoReply: Boolean(safe.should_auto_reply ?? safe.shouldAutoReply),
    summary: truncate(safe.summary, 400),
    reason: truncate(safe.reasoning || safe.reason, 300),
    recommendedAction: truncate(safe.recommended_action || safe.recommendedAction, 100) || 'REVIEW_CONVERSATION',
    brandDeal: (category === 'brand_deal' || category === 'collaboration') ? sanitizeBrandDeal(safe.brand_deal) : null,
  };
}

// ============================================
// Deterministic Priority Calculation
// ============================================
function computePriorityScore(analysis, preferences = null) {
  const category = analysis.category || 'other';
  const base = CATEGORY_BASE_SCORE[category] ?? CATEGORY_BASE_SCORE.other;
  const prefKey = PREFERENCE_WEIGHT_KEY_BY_CATEGORY[category] || 'questionsPriority';
  const prefLevel = preferences?.[prefKey] || 'normal';
  const multiplier = PREFERENCE_MULTIPLIER[prefLevel] ?? 1;

  let score = base * multiplier * (0.6 + 0.4 * clamp(analysis.confidence, 0, 1));

  // Blend commercial intent and lead signals
  if (analysis.purchaseIntent > 60) score += (analysis.purchaseIntent - 60) * 0.2;
  if (analysis.leadQuality > 60) score += (analysis.leadQuality - 60) * 0.2;
  if (analysis.needsCreatorAttention) score += 10;

  // Penalize spam and scams
  if (analysis.category === 'spam') score = Math.min(score, 10);
  if (analysis.scamProbability > 50) score = Math.min(score, 15);
  if (analysis.category === 'abusive') score = Math.min(score, 10);

  score = Math.round(clamp(score, 0, 100));
  return { score, priority: scoreToPriorityBucket(score) };
}

// ============================================
// Context Formatter
// ============================================
function buildContextBlock(recentMessages = [], businessName = 'Business Owner') {
  return recentMessages
    .slice(-10)
    .map((m) => `${m.direction === 'inbound' ? 'Customer' : businessName}: ${m.content || `[${m.messageType || 'attachment'}]`}`)
    .join('\n');
}

function formatBusinessProfileContext(profile) {
  if (!profile) return 'Business Type: General Instagram Business/Creator';

  const parts = [];
  if (profile.businessName) parts.push(`Business Name: ${profile.businessName}`);
  if (profile.primaryCategory || profile.businessTypes) {
    parts.push(`Business Category / Types: ${profile.primaryCategory || ''} ${profile.businessTypes || ''}`.trim());
  }
  if (profile.description) parts.push(`Description: ${profile.description}`);
  if (profile.productsServices) parts.push(`Products/Services Offered:\n${profile.productsServices}`);
  if (profile.pricingInfo) parts.push(`Pricing & Rates:\n${profile.pricingInfo}`);
  if (profile.targetAudience) parts.push(`Target Customers: ${profile.targetAudience}`);
  if (profile.locationDelivery) parts.push(`Location / Delivery / Service Area: ${profile.locationDelivery}`);
  if (profile.paymentMethods) parts.push(`Payment Methods: ${profile.paymentMethods}`);
  if (profile.policies) parts.push(`Policies (Warranty/Turnaround/Refunds): ${profile.policies}`);
  if (profile.faqData) parts.push(`Business FAQs:\n${profile.faqData}`);
  if (profile.aiInstructions) parts.push(`Special Business Instructions: ${profile.aiInstructions}`);
  if (profile.prohibitedTopics) parts.push(`STRICTLY PROHIBITED (Never promise/invent):\n${profile.prohibitedTopics}`);

  return parts.join('\n\n');
}

// ============================================
// AI Provider Implementations
// ============================================
async function callGemini(apiKey, { prompt, isJson, timeout = 15000 }) {
  if (!apiKey || !apiKey.trim()) throw new Error('GEMINI_API_KEY is not configured');

  const models = [
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
      const payload = { contents: [{ parts: [{ text: prompt }] }] };
      if (isJson) payload.generationConfig = { responseMimeType: 'application/json' };

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
      if (err.response?.status === 400 && (err.response?.data?.error?.message?.includes('API key not valid') || err.response?.data?.error?.message?.includes('API_KEY_INVALID'))) {
        throw err;
      }
      continue;
    }
  }

  throw lastError || new Error('All Gemini models failed');
}

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
      if (isJson) payload.response_format = { type: 'json_object' };

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
      if (err.response?.status === 400 || err.response?.status === 401) throw err;
      continue;
    }
  }

  throw lastError || new Error('All xAI Grok models failed');
}

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
      if (isJson) payload.response_format = { type: 'json_object' };

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
      if (err.response?.status === 401) throw err;
      continue;
    }
  }

  throw lastError || new Error('All OpenAI models failed');
}

// ============================================
// Multi-Provider Auto-Failover Orchestrator
// ============================================
function getProviderChain() {
  const primaryPref = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const grokKey = (process.env.GROK_API_KEY || process.env.XAI_API_KEY || (process.env.OPENAI_API_KEY?.startsWith('xai-') ? process.env.OPENAI_API_KEY : null))?.trim();
  const rawOpenAIKey = process.env.OPENAI_API_KEY?.trim();
  const standardOpenAIKey = (rawOpenAIKey && !rawOpenAIKey.startsWith('xai-') ? rawOpenAIKey : null);

  const available = {};

  if (geminiKey) {
    available.gemini = { name: 'Google Gemini', id: 'gemini', call: (opts) => callGemini(geminiKey, opts) };
  }
  if (grokKey) {
    available.xai = { name: 'xAI (Grok)', id: 'xai', call: (opts) => callXAI(grokKey, opts) };
  }
  if (standardOpenAIKey) {
    available.openai = { name: 'OpenAI', id: 'openai', call: (opts) => callOpenAI(standardOpenAIKey, opts) };
  }

  let order;
  if (primaryPref === 'grok' || primaryPref === 'xai') {
    order = ['xai', 'gemini', 'openai'];
  } else if (primaryPref === 'openai') {
    order = ['openai', 'gemini', 'xai'];
  } else {
    order = ['gemini', 'xai', 'openai'];
  }

  const chain = [];
  for (const key of order) {
    if (available[key]) chain.push(available[key]);
  }

  return chain;
}

async function callAIWithFailover({ prompt, isJson = true, timeout = 14000 }) {
  const chain = getProviderChain();

  if (chain.length === 0) {
    throw new Error('No AI provider keys configured in backend/.env');
  }

  let lastError = null;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    try {
      const result = await provider.call({ prompt, isJson, timeout });
      if (result) {
        aiStats.lastSuccessfulProvider = provider.id;
        return result;
      }
    } catch (err) {
      lastError = err;
      aiStats.providerFailovers++;
      console.warn(`[AIService] ⚠️ Provider "${provider.name}" failed: ${err.message}. Failover continuing...`);
    }
  }

  throw new Error(`All configured AI providers failed. Last error: ${lastError?.message}`);
}

// ============================================
// 1. Generalized Conversation Analysis
// ============================================
async function analyzeConversation({
  messageText,
  contactUsername,
  recentMessages = [],
  businessProfile = null,
  preferences = null,
}) {
  if (!messageText || typeof messageText !== 'string') {
    return {
      category: 'other',
      intent: 'unknown',
      customerType: 'unknown',
      purchaseIntent: 0,
      leadQuality: 0,
      commercialRelevance: 0,
      urgency: 0,
      riskLevel: 'LOW',
      scamProbability: 0,
      confidence: 0,
      needsCreatorAttention: false,
      shouldAutoReply: false,
      summary: null,
      reason: null,
      recommendedAction: 'REVIEW',
      brandDeal: null,
      model: 'keyword-engine',
      priorityScore: 0,
      priority: 'low',
      failed: false,
    };
  }

  // Pre-filter
  const keywordHit = classifyByKeywords(messageText);
  if (keywordHit) {
    aiStats.keywordMatches++;
    aiStats.categoryCounts[keywordHit.category] = (aiStats.categoryCounts[keywordHit.category] || 0) + 1;
    const scored = computePriorityScore(keywordHit, preferences);
    return {
      ...keywordHit,
      model: 'keyword-engine',
      priorityScore: scored.score,
      priority: scored.priority,
      failed: false,
    };
  }

  aiStats.totalCalls++;
  aiStats.messagesAnalyzed++;

  const businessContext = formatBusinessProfileContext(businessProfile);
  const contextBlock = buildContextBlock(recentMessages, businessProfile?.businessName || 'Business Owner');

  const prompt = `You are a high-accuracy AI Instagram Customer Intelligence and DM Assistant for a business.
Your job is to understand what the business does, analyze the incoming Instagram conversation, qualify leads, detect risks/scams, and determine the exact customer intent.

=== BUSINESS CONTEXT ===
${businessContext}

=== RECENT CONVERSATION (Oldest First) ===
${contextBlock || '(No prior messages)'}

=== LATEST INBOUND MESSAGE FROM @${contactUsername || 'customer'} ===
"${messageText.replace(/"/g, '\\"')}"

=== CLASSIFICATION & DECISION INSTRUCTIONS ===
1. Understand the message in the context of this specific business.
2. Select EXACTLY ONE category from:
${CATEGORIES.map((c) => `- ${c}`).join('\n')}

3. Select Customer Type from: ${CUSTOMER_TYPES.join(', ')}
4. Calculate Purchase Intent (0-100), Lead Quality (0-100), Commercial Relevance (0-100), Urgency (0-100), and Scam Probability (0-100).
5. Assess Risk Level: "LOW", "MEDIUM", "HIGH", or "CRITICAL".
   - Set HIGH/CRITICAL if the message is abusive, fraudulent, asking for passwords/OTPs, threatening, or requesting unverified refunds.
6. Determine should_auto_reply:
   - TRUE only if: customer is asking a clear, polite product/service/price/availability/shipping/FAQ question that CAN be safely and accurately answered from the Business Context.
   - FALSE if: casual fan greeting, spam, scam, abusive, angry/legal dispute, or if the question requires facts not present in the business context.
7. Determine requires_human_attention:
   - TRUE if high value lead, angry customer, scam/fraud, refund/dispute, or missing information.
8. If (and only if) this is a brand sponsorship or commercial collab, extract structured details.

Return ONLY valid JSON in this exact shape:
{
  "category": "one of the allowed categories",
  "intent": "short specific intent, e.g. price_inquiry_reel_editing",
  "customer_type": "one of the allowed customer types",
  "purchase_intent": 0-100,
  "lead_quality": 0-100,
  "commercial_relevance": 0-100,
  "urgency": 0-100,
  "risk_level": "LOW | MEDIUM | HIGH | CRITICAL",
  "scam_probability": 0-100,
  "sentiment": "positive | neutral | negative | angry",
  "confidence": 0.0-1.0,
  "should_auto_reply": true or false,
  "requires_human_attention": true or false,
  "summary": "1 sentence summarizing conversation status",
  "reasoning": "1-2 sentences explaining why this was classified and what the customer wants",
  "recommended_action": "e.g. ANSWER_PRICING | SEND_PORTFOLIO | HUMAN_ESCALATION | IGNORE_SPAM",
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

    return {
      ...validated,
      model,
      provider,
      priorityScore: scored.score,
      priority: scored.priority,
      failed: false,
      rawResponse: json,
    };
  } catch (error) {
    aiStats.aiFailures++;
    console.warn(`[AIService] Analysis fallback triggered: ${error.message}`);
    const fallback = {
      category: 'other',
      intent: 'general_inquiry',
      customerType: 'unknown',
      purchaseIntent: 30,
      leadQuality: 30,
      commercialRelevance: 30,
      urgency: 20,
      riskLevel: 'LOW',
      scamProbability: 0,
      sentiment: 'neutral',
      confidence: 0,
      needsCreatorAttention: false,
      shouldAutoReply: false,
      summary: null,
      reason: null,
      recommendedAction: 'REVIEW_CONVERSATION',
      brandDeal: null,
      model: null,
      provider: null,
      failed: true,
      errorMessage: error.message,
    };
    const scored = computePriorityScore(fallback, preferences);
    return { ...fallback, priorityScore: scored.score, priority: scored.priority };
  }
}

// ============================================
// 2. Safe Auto-Reply & Draft Generation
// ============================================
async function generateReply({
  recentMessages = [],
  contactUsername,
  businessProfile = null,
  preferences = null,
  instructions = null,
  category = 'other',
  brandDeal = null,
  analysis = null,
}) {
  const businessContext = formatBusinessProfileContext(businessProfile);
  const contextBlock = buildContextBlock(recentMessages, businessProfile?.businessName || 'Business Owner');
  const tone = businessProfile?.tone || preferences?.tone || 'friendly';

  // Anti-hallucination & safety guidelines
  const safetyGuidelines = `
=== STRICT ANTI-HALLUCINATION & PROFESSIONAL SAFETY RULES ===
1. Use ONLY verified facts from the Business Context above (prices, turnaround times, warranty, policies, delivery locations).
2. NEVER INVENT prices, discounts, delivery dates, or policies not explicitly listed in the Business Context.
3. If specific pricing/details are missing, politely ask the customer for their requirements or location rather than making up numbers.
4. Angry / Frustrated Customers: Be empathetic, calm, and de-escalate. NEVER argue, insult, or accept financial/legal liability.
5. Tone: ${tone}. Be natural, professional, concise (1-3 sentences maximum for Instagram DM), and directly helpful.
6. Do NOT include markdown code blocks or quotes around the reply. Return pure text only.
`;

  const prompt = `You are drafting a professional, safe Instagram DM reply for this business.

=== BUSINESS CONTEXT ===
${businessContext}

=== CONVERSATION SO FAR ===
${contextBlock || '(No prior messages)'}

Customer username: @${contactUsername || 'customer'}
Category: ${category}
${instructions ? `Specific user instructions: "${instructions}"\n` : ''}
${safetyGuidelines}

Draft the reply text:`;

  try {
    const { text, model, provider } = await callAIWithFailover({ prompt, isJson: false, timeout: 15000 });
    aiStats.replyGenerations++;
    return {
      text: text?.replace(/^"|"$/g, '').trim() || null,
      model,
      provider,
      failed: false,
    };
  } catch (error) {
    console.warn(`[AIService] Reply generation failed: ${error.message}`);
    return { text: null, model: null, failed: true, errorMessage: error.message };
  }
}

// ============================================
// 3. Conversation Summaries
// ============================================
async function summarizeConversation({ recentMessages = [], previousSummary = null, brandDeal = null, businessProfile = null }) {
  const contextBlock = buildContextBlock(recentMessages, businessProfile?.businessName || 'Business Owner');

  const prompt = `Summarize this Instagram DM conversation for a busy business owner.
${previousSummary ? `Previous summary: "${previousSummary}"\n` : ''}
Conversation so far:
${contextBlock || '(no messages)'}

Return ONLY valid JSON:
{
  "summary": "2-3 sentences summarizing who this customer is, what they requested, and current status",
  "stage": "short phrase e.g. 'Waiting for customer specs' or 'Price quoted'"
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
    return { summary: previousSummary || null, stage: null, failed: true, errorMessage: error.message };
  }
}

module.exports = {
  analyzeConversation,
  generateReply,
  summarizeConversation,
  computePriorityScore,
  classifyByKeywords,
  validateAnalysisResult,
  getAIStats,
  callAIWithFailover,
};
