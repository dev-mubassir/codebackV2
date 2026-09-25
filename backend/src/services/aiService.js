/**
 * Codeback Generalized AI Service — multi-tenant customer intelligence,
 * lead qualification, brand deal extraction, conversation summaries,
 * and safe auto-reply generation.
 *
 * Supports Creators, Video/Photo Editors, Product Sellers, Freelancers, Local Businesses,
 * Coaches, E-Commerce, Agencies, and more.
 */

const router = require('../lib/ai/router');
const { keyConfigured } = require('../lib/ai/models');
const { validateClassification, validateSummary } = require('../lib/ai/schema');
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
  'get 10k followers', 'free followers', 'send pic on @', 'promote it on @',
  'shoutout on @', 'growth agency', 'dm us on @', 'check my bio link',
  'passive income crypto', 'investment platform', 'earn 500$ daily',
];

const SCAM_KEYWORDS = [
  'send otp', 'share password', 'send verification code', 'login to this link',
  'account suspended click here', 'claim prize send fee', 'transfer bitcoin',
  'seed phrase', 'send bank login', 'overpaid refund difference',
  'hacked account recovery', 'unban your account', 'copyright is violated',
  'copyright violation click', 'urgent: your account', 'send your login',
  'verification code otp', 'whatsapp me +', 'contact on whatsapp +',
  'western union', 'send gift card', 'apple gift card', 'wire transfer to',
];

const GREETING_ONLY_PATTERNS = [
  /^[\p{Emoji}\s]+$/u, // Emojis only e.g. "🔥", "❤️😍", "👏🙌"
  /^(hi|hello|hey|hy|hlo|yo|hola|gm|gn|good morning|good night|good evening|wassup|sup|bro|sir|mam|madam)$/i,
  /^(nice|great|awesome|super|cool|fire|legend|goat|super work|great work|nice work|love this|love your work|nice reel|nice video|great video|super inspiring)$/i,
];

const COMMERCIAL_QUESTION_INDICATORS = [
  'price', 'pricing', 'cost', 'rate', 'rates', 'how much', 'kitna', 'fee', 'fees',
  'buy', 'purchase', 'order', 'book', 'booking', 'slot', 'slots', 'available', 'availability',
  'stock', 'specs', 'specification', 'specs', 'deliver', 'delivery', 'ship', 'shipping',
  'edit', 'editing', 'service', 'services', 'package', 'packages', 'bundle', 'pay', 'payment',
  'upi', 'qr', 'discount', 'turnaround', 'warranty', 'revision', 'revisions', 'quote',
  '?', 'where do i', 'can i', 'do you', 'how do i', 'what is', 'when will',
];

// ============================================
// Output style contract
//
// `summary`, `reasoning`, and generated reply text are all rendered verbatim
// in the product — in the inbox insights panel, in notification bodies, and in
// the message itself. Without an explicit contract the model narrates its own
// reasoning ("The user appears to be inquiring about..."), which reads nothing
// like the rest of the interface.
//
// This governs tone, length, and vocabulary only. It never changes what is
// classified, the JSON shape, or any threshold.
// ============================================
const OUTPUT_STYLE_CONTRACT = `=== OUTPUT STYLE (applies to every text field you return) ===
- Write for the business owner reading their own inbox. Use "they" for the customer.
- Sentence case. No headings, no bullet points, no markdown, no emoji.
- Present tense. State what is true now, not what you did to work it out.
- Never narrate your own process. Do not write "the message appears to", "I have
  classified", "based on the context", "it seems likely", or "this conversation
  suggests". Lead with the fact.
- Never use these words: hallucination, grounding, prompt, token, model,
  inference, embedding, classifier, LLM, payload, endpoint, valid, invalid,
  null, undefined, true, false.
- Never quote a price, date, or policy that is not written in the business
  context above.
- Plain words over jargon. If a shorter word works, use it.`;

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
  lastSuccessfulModel: null,
};

function getAIStats() {
  return aiStats;
}

// ============================================
// Cheap pre-filter (no AI call, zero tokens, zero latency)
// ============================================
function classifyByKeywords(messageText) {
  if (!messageText || typeof messageText !== 'string') return null;
  const trimmed = messageText.trim();
  const lower = trimmed.toLowerCase();

  // 1. Critical Scams & Security Attacks (0ms, 0 tokens)
  for (const kw of SCAM_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        category: 'scam',
        intent: 'scam_or_phishing_attempt',
        customerType: 'scammer',
        confidence: 0.98,
        purchaseIntent: 0,
        leadQuality: 0,
        commercialRelevance: 0,
        urgency: 90,
        riskLevel: 'CRITICAL',
        scamProbability: 100,
        sentiment: 'negative',
        requiresHumanAttention: true,
        shouldAutoReply: false,
        recommendedAction: 'BLOCK_OR_WARN_USER',
        summary: 'This looks like a scam. Do not share codes, passwords, or payment details.',
        reason: 'The message matches a known phishing pattern.',
        brandDeal: null,
      };
    }
  }

  // 2. Unsolicited Spam & Bot Promotions (0ms, 0 tokens)
  for (const kw of SPAM_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        category: 'spam',
        intent: 'unsolicited_spam',
        customerType: 'spammer',
        confidence: 0.95,
        purchaseIntent: 0,
        leadQuality: 0,
        commercialRelevance: 0,
        urgency: 0,
        riskLevel: 'LOW',
        scamProbability: 10,
        sentiment: 'neutral',
        requiresHumanAttention: false,
        shouldAutoReply: false,
        recommendedAction: 'IGNORE_SPAM',
        summary: 'Unsolicited promotion. Safe to ignore.',
        reason: 'The message matches a known bulk-promotion pattern.',
        brandDeal: null,
      };
    }
  }

  // 3. Casual Fan Greetings / Pure Emojis (Token-Saver: 0 tokens used)
  // Only apply if the message does NOT contain any commercial inquiry terms or question marks
  const hasCommercialTerms = COMMERCIAL_QUESTION_INDICATORS.some((term) => lower.includes(term));
  if (!hasCommercialTerms) {
    for (const pattern of GREETING_ONLY_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          category: 'fan',
          intent: 'casual_greeting_or_compliment',
          customerType: 'casual_fan',
          confidence: 0.92,
          purchaseIntent: 5,
          leadQuality: 5,
          commercialRelevance: 5,
          urgency: 0,
          riskLevel: 'LOW',
          scamProbability: 0,
          sentiment: 'positive',
          requiresHumanAttention: false,
          shouldAutoReply: false,
          recommendedAction: 'AWAIT_CUSTOMER_INQUIRY',
          summary: 'A friendly hello with no question in it.',
          reason: 'The message is a greeting or compliment, with nothing to answer.',
          brandDeal: null,
        };
      }
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
// Context Formatter (Optimized for low token footprint)
// ============================================
function buildContextBlock(recentMessages = [], businessName = 'Business Owner') {
  return recentMessages
    .slice(-4)
    .map((m) => {
      const role = m.direction === 'inbound' ? 'Customer' : businessName;
      const text = truncate(m.content, 200) || `[${m.messageType || 'attachment'}]`;
      return `${role}: ${text}`;
    })
    .join('\n');
}

function formatBusinessProfileContext(profile) {
  if (!profile) return 'Business Type: General Instagram Business/Creator';

  const parts = [];
  if (profile.businessName) parts.push(`Business Name: ${profile.businessName}`);
  if (profile.primaryCategory || profile.businessTypes) {
    parts.push(`Category: ${profile.primaryCategory || ''} ${profile.businessTypes || ''}`.trim());
  }
  if (profile.description) parts.push(`Description: ${truncate(profile.description, 300)}`);
  if (profile.productsServices) parts.push(`Products/Services:\n${truncate(profile.productsServices, 500)}`);
  if (profile.pricingInfo) parts.push(`Pricing & Rates:\n${truncate(profile.pricingInfo, 400)}`);
  if (profile.locationDelivery) parts.push(`Location/Delivery: ${truncate(profile.locationDelivery, 200)}`);
  if (profile.paymentMethods) parts.push(`Payment Methods: ${truncate(profile.paymentMethods, 150)}`);
  if (profile.policies) parts.push(`Policies: ${truncate(profile.policies, 250)}`);
  if (profile.faqData) parts.push(`FAQs:\n${truncate(profile.faqData, 500)}`);
  if (profile.aiInstructions) parts.push(`Special Instructions: ${truncate(profile.aiInstructions, 200)}`);
  if (profile.prohibitedTopics) parts.push(`STRICTLY PROHIBITED:\n${truncate(profile.prohibitedTopics, 200)}`);

  return parts.join('\n\n');
}

// ============================================
// The AI call path (Gate 4)
//
// Every call goes through lib/ai/router.js: the admin-selected provider and
// model from the code allowlist, per-call timeout, limited retries, optional
// fallback, and one ai_call_logs row per HTTP attempt. Provider-specific HTTP
// lives in lib/ai/adapters.js. Classification answers are checked against
// the one schema in lib/ai/schema.js; an answer that fails it is a failed
// call, never patched up.
// ============================================

/**
 * Kept under its old name for callers and tests; it is now the router.
 * @param {object} args  see lib/ai/router.js callAI
 */
async function callAIWithFailover(args) {
  return router.callAI(args);
}

/**
 * What the admin panel shows as "active": provider/model ids, whether each
 * provider's key is configured (yes/no), and the fallback state. Never a key.
 */
async function activeAiConfig() {
  const config = await router.getAiConfig();
  return {
    primaryProvider: config.active.provider,
    primaryModel: config.active.model,
    keyConfigured: keyConfigured(config.active.provider),
    fallback: config.fallbackEnabled ? config.fallback : null,
    fallbackState: router.fallbackState(),
    lastSuccessfulProvider: aiStats.lastSuccessfulProvider,
    lastSuccessfulModel: aiStats.lastSuccessfulModel,
  };
}

function noteSuccess(result) {
  aiStats.lastSuccessfulProvider = result.provider;
  aiStats.lastSuccessfulModel = result.model;
}

// ============================================
// 1. Generalized Conversation Analysis
// ============================================
/**
 * THE classification prompt — production and the admin model test (Gate 4)
 * both use this, so a candidate model is tested on exactly what it will be
 * asked in production.
 */
function buildClassificationPrompt({ messageText, contactUsername, recentMessages = [], businessProfile = null }) {
  const businessContext = formatBusinessProfileContext(businessProfile);
  const contextBlock = buildContextBlock(recentMessages, businessProfile?.businessName || 'Business Owner');

  return `You read Instagram messages sent to a business and work out what the sender wants, how commercially serious they are, and whether anything about the message is unsafe.

${OUTPUT_STYLE_CONTRACT}

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

Category Guidelines:
- "pricing_inquiry", "product_inquiry", "service_inquiry", "availability_inquiry", "delivery_inquiry": Customer asking about prices, rates, products, services, turnaround, or shipping.
- "hot_lead": High-intent customer ready to buy/book immediately.
- "brand_deal" or "collaboration": Brand, agency, or sponsor offering paid campaigns, sponsorships, or barter collabs (extract structured details into brand_deal object).
- "support_request": Existing customer needing post-purchase help, order status, or revisions.
- "fan": Friendly praise, emojis, or compliment.
- "scam": Phishing, OTP/password theft, fraudulent payment schemes, or fake links.
- "spam": Unsolicited bulk promo (buy followers, telegram crypto).

3. Select Customer Type from: ${CUSTOMER_TYPES.join(', ')}
4. Calculate Purchase Intent (0-100), Lead Quality (0-100), Commercial Relevance (0-100), Urgency (0-100), and Scam Probability (0-100).
5. Assess Risk Level: "LOW", "MEDIUM", "HIGH", or "CRITICAL".
   - Set HIGH/CRITICAL if the message is abusive, fraudulent, asking for passwords/OTPs, threatening, or requesting unverified refunds.
6. Determine should_auto_reply:
   - TRUE only if: customer is asking a clear, polite product/service/price/availability/shipping/FAQ question that CAN be safely and accurately answered from the Business Context.
   - FALSE if: casual fan greeting, spam, scam, abusive, angry/legal dispute, or if the question requires facts not present in the business context.
7. Determine requires_human_attention:
   - TRUE if high value lead, angry customer, scam/fraud, refund/dispute, or missing information.
8. If (and only if) this is a brand sponsorship or commercial collab, extract structured details into brand_deal.

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
  "summary": "Exactly one sentence, 20 words or fewer, naming what they want and where the conversation stands. Written for the business owner, present tense, no preamble.",
  "reasoning": "One sentence, 25 words or fewer, giving the single strongest reason for this classification. State the reason itself, not that you are giving a reason.",
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
}

async function analyzeConversation({
  messageText,
  contactUsername,
  recentMessages = [],
  businessProfile = null,
  preferences = null,
  tenantId = null,
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
      summary: 'Nothing to read in this message.',
      reason: 'The message has no text — it may be an attachment or a reaction.',
      recommendedAction: 'REVIEW',
      brandDeal: null,
      model: 'keyword-engine',
      priorityScore: 0,
      priority: 'low',
      failed: false,
      // No provider was called — nothing was spent, so the billing layer
      // must not charge the tenant a classification for this. See the
      // `billable` note on the AI-call path below.
      billable: false,
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
      billable: false, // keyword pre-filter answered it for free
    };
  }

  aiStats.totalCalls++;
  aiStats.messagesAnalyzed++;

  const prompt = buildClassificationPrompt({ messageText, contactUsername, recentMessages, businessProfile });

  try {
    const result = await router.callAI({ prompt, isJson: true, jobType: 'classification', tenantId, validate: validateClassification });
    noteSuccess(result);
    const { json, model, provider } = result;
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
      // A provider was actually called and charged us. `billable` — not
      // `!failed` — is what the billing layer counts, because a call that
      // returns unparseable output still costs money (see the catch below).
      billable: true,
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
      // Shown in the inbox when analysis fails or times out. Says what
      // happened and what to do, rather than leaving the panel blank.
      summary: 'This conversation has not been read yet.',
      reason: 'Siffty could not review it just now. It will try again shortly — read it yourself in the meantime.',
      recommendedAction: 'REVIEW_CONVERSATION',
      brandDeal: null,
      model: null,
      provider: null,
      failed: true,
      // Every provider in the chain was tried and failed — we were very
      // likely still billed for those attempts, so this counts. The one
      // exception is a chain that was empty to begin with (no keys
      // configured): no network call happened, so nothing is charged.
      billable: error.code !== 'NO_PROVIDERS_CONFIGURED',
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
  tenantId = null,
}) {
  const businessContext = formatBusinessProfileContext(businessProfile);
  const contextBlock = buildContextBlock(recentMessages, businessProfile?.businessName || 'Business Owner');
  const tone = businessProfile?.tone || preferences?.tone || 'friendly';

  // This output is sent to a real customer as a real Instagram message, so the
  // style contract is stricter here than anywhere else: it defines the length,
  // the structure, and what may never be stated.
  const safetyGuidelines = `
=== WHAT YOU MAY SAY ===
1. Use ONLY the facts written in the business context above — prices, turnaround
   times, warranty, policies, delivery areas, payment methods.
2. Never invent a price, discount, delivery date, or policy. If the answer is
   not in the business context, ask them for what you need instead of guessing.
3. If they are angry, stay calm and acknowledge the problem. Never argue, never
   blame them, and never accept financial or legal responsibility.

=== HOW TO WRITE IT ===
4. Tone: ${tone}.
5. Two sentences, three at the very most. This is an Instagram message, not an
   email. No greeting line, no sign-off, no subject.
6. Answer their actual question in the first sentence. If you need something
   from them, ask for exactly one thing in the last sentence.
7. Sentence case. No markdown, no bullet points, no headings, no emoji, no
   surrounding quotes.
8. Never use these words: hallucination, grounding, prompt, token, model,
   inference, embedding, classifier, LLM, payload, endpoint, valid, invalid,
   null, undefined.
9. Never mention that this reply was generated, drafted, or assisted. Write as
   the business.
10. Return the message text only, with nothing before or after it.
`;

  const prompt = `Write the next Instagram message this business should send.

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
    const result = await router.callAI({ prompt, isJson: false, timeout: 15000, jobType: 'reply', tenantId });
    noteSuccess(result);
    const { text, model, provider } = result;
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
async function summarizeConversation({ recentMessages = [], previousSummary = null, brandDeal = null, businessProfile = null, tenantId = null }) {
  // Take only the last 3 messages as requested to save tokens
  const last3 = recentMessages.slice(-3);
  const contextBlock = buildContextBlock(last3, businessProfile?.businessName || 'Business Owner');

  const prompt = `Summarise this Instagram conversation for the business owner who has to answer it.

${OUTPUT_STYLE_CONTRACT}

${previousSummary ? `What you wrote last time: "${previousSummary}"\n` : ''}
Latest messages:
${contextBlock || '(no messages)'}

Return ONLY valid JSON:
{
  "summary": "One or two sentences, 30 words or fewer in total. Say what they want and what is outstanding. Start with the customer's request, not with the word 'The customer'.",
  "stage": "Three words or fewer naming where this stands, e.g. 'Waiting on price', 'Ready to book', 'Needs your answer'. Sentence case."
}`;

  try {
    const result = await router.callAI({ prompt, isJson: true, jobType: 'summary', tenantId, validate: validateSummary });
    noteSuccess(result);
    const { json, model, provider } = result;
    aiStats.summariesGenerated++;
    return {
      summary: truncate(json?.summary, 600) || previousSummary || null,
      stage: truncate(json?.stage, 150),
      model,
      provider,
      failed: false,
    };
  } catch (error) {
    // Keep the last good summary if there is one; otherwise say plainly that
    // there is not one yet rather than rendering an empty panel.
    return {
      summary: previousSummary || 'No summary yet.',
      stage: previousSummary ? null : 'Not read yet',
      failed: true,
      errorMessage: error.message,
    };
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
  buildClassificationPrompt,
  activeAiConfig,
};
