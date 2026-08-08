/**
 * Smart DM Classification & AI Reply Suggestion Service
 * 
 * Uses fast keyword pre-filtering to save API costs & latency.
 * Uses Google Gemini 1.5 Flash (gemini-1.5-flash) with flexible provider switching (OpenAI gpt-4o-mini).
 */

const axios = require('axios');

const BRAND_COLLAB_KEYWORDS = [
  'collab', 'collaboration', 'sponsorship', 'sponsor', 'brand deal',
  'paid partnership', 'ugc', 'ambassador', 'campaign', 'budget',
  'affiliate', 'gifted', 'promote', 'partnership', 'media kit', 'rate sheet', 'rates'
];

const SPAM_KEYWORDS = [
  'crypto', 'bitcoin', 'forex', 'grow your account', 'buy followers',
  'buy likes', 'telegram', 'whatsapp me', 'whatsapp group', 'investment opportunity',
  'invest', 'page manager', 'boost followers', 'dm to feature', 'dm @'
];

const CATEGORY_PRIORITY = {
  'Brand/Collab': 1,
  'Business': 2,
  'Question': 3,
  'Fan': 4,
  'Spam': 5,
  'Other': 6
};

/**
 * Determine if new category has higher or equal priority to override existing category
 */
function shouldUpdateCategory(existingCategory, newCategory) {
  if (!existingCategory) return newCategory;
  if (!newCategory) return existingCategory;

  const existingPriority = CATEGORY_PRIORITY[existingCategory] || 6;
  const newPriority = CATEGORY_PRIORITY[newCategory] || 6;

  // Lower number = Higher priority (e.g. Brand/Collab (1) overrides Fan (4))
  return newPriority <= existingPriority ? newCategory : existingCategory;
}

// In-memory AI call monitoring counters
const aiStats = {
  totalCalls: 0,
  keywordMatches: 0,
  aiSuccess: 0,
  aiFailures: 0,
  categoryCounts: {
    'Brand/Collab': 0,
    'Business': 0,
    'Question': 0,
    'Fan': 0,
    'Spam': 0,
    'Other': 0,
  }
};

function getAIStats() {
  return aiStats;
}

/**
 * Perform keyword-based classification before calling AI
 */
function classifyByKeywords(messageText, username) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const kw of SPAM_KEYWORDS) {
    if (lower.includes(kw)) {
      aiStats.keywordMatches++;
      aiStats.categoryCounts['Spam']++;
      return { category: 'Spam', reply: '' };
    }
  }

  for (const kw of BRAND_COLLAB_KEYWORDS) {
    if (lower.includes(kw)) {
      aiStats.keywordMatches++;
      aiStats.categoryCounts['Brand/Collab']++;
      const handle = username ? `@${username}` : 'there';
      return {
        category: 'Brand/Collab',
        reply: `Hi ${handle}! Thanks for reaching out. I'd love to learn more about your brand and discuss collaboration opportunities. Please share your campaign brief or details!`
      };
    }
  }

  return null;
}

/**
 * Call Google Gemini API (with fallback models)
 */
async function callGemini(messageText, username) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('GEMINI_API_KEY is missing in backend/.env');
  }

  if (!apiKey.startsWith('AIza')) {
    console.warn('[AIService] Warning: GEMINI_API_KEY does not start with AIza. Ensure you copied a valid key from Google AI Studio (aistudio.google.com).');
  }

  const prompt = `You are an expert assistant helping Instagram creators manage their DMs.

Classify the following Instagram direct message into exactly one of these categories:
- Brand/Collab
- Business
- Fan
- Question
- Spam
- Other

Then write only ONE natural and high-quality reply that the creator can copy-paste.

Rules:
- If the message is about sponsorship, brand deal, collaboration, paid partnership, or UGC → category must be "Brand/Collab" and write a professional, interested reply.
- If it is spam, scam, crypto, or fake growth offers → category = "Spam" and reply should be empty string.
- Keep the reply short, human, and natural.
- Do not explain anything. Only return the JSON.

Return only valid JSON in this format:
{
  "category": "",
  "reply": ""
}

Message: "${messageText.replace(/"/g, '\\"')}"
Sender: @${username || 'user'}`;

  // Try candidate models in order (cheapest model gemini-flash-lite-latest first)
  const models = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        },
        { timeout: 10000 }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return JSON.parse(text);
      }
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      if (status === 404 || status === 429) {
        console.warn(`[AIService] Model ${model} returned status ${status}, trying fallback model...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Failed to generate content with Gemini API');
}

/**
 * Call OpenAI API (gpt-4o-mini) as alternative provider
 */
async function callOpenAI(messageText, username) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const prompt = `You are an expert assistant helping Instagram creators manage their DMs.

Classify the following Instagram direct message into exactly one of these categories:
- Brand/Collab
- Business
- Fan
- Question
- Spam
- Other

Then write only ONE natural and high-quality reply that the creator can copy-paste.

Rules:
- If the message is about sponsorship, brand deal, collaboration, paid partnership, or UGC → category must be "Brand/Collab" and write a professional, interested reply.
- If it is spam, scam, crypto, or fake growth offers → category = "Spam" and reply should be empty string.
- Keep the reply short, human, and natural.
- Do not explain anything. Only return the JSON.

Return only valid JSON in this format:
{
  "category": "",
  "reply": ""
}

Message: "${messageText.replace(/"/g, '\\"')}"
Sender: @${username || 'user'}`;

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    }
  );

  const content = response.data?.choices?.[0]?.message?.content;
  return JSON.parse(content);
}

/**
 * Main entry point: Classify message and generate reply suggestion
 */
async function classifyAndSuggest(messageText, username = '') {
  if (!messageText || typeof messageText !== 'string') {
    return { category: 'Other', reply: null };
  }

  // 1. Try instant keyword classifier first (Free & Fast)
  const keywordResult = classifyByKeywords(messageText, username);
  if (keywordResult) {
    return keywordResult;
  }

  // 2. Fall back to AI Model (Gemini 1.5 Flash by default)
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  aiStats.totalCalls++;

  try {
    let result;
    if (provider === 'openai') {
      result = await callOpenAI(messageText, username);
    } else {
      result = await callGemini(messageText, username);
    }

    const validCategories = ['Brand/Collab', 'Business', 'Fan', 'Question', 'Spam', 'Other'];
    const category = validCategories.includes(result.category) ? result.category : 'Other';
    const reply = category === 'Spam' ? '' : (result.reply || null);

    aiStats.aiSuccess++;
    if (aiStats.categoryCounts[category] !== undefined) {
      aiStats.categoryCounts[category]++;
    }

    return { category, reply };
  } catch (error) {
    aiStats.aiFailures++;
    console.warn(`[AIService] AI classification failed (${error.message}). Falling back to Other.`);
    return { category: 'Other', reply: null };
  }
}

module.exports = {
  classifyAndSuggest,
  classifyByKeywords,
  shouldUpdateCategory,
  getAIStats,
};
