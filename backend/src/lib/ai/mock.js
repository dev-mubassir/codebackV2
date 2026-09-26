/**
 * AI_MOCK=true — a deterministic stand-in for every AI provider.
 *
 * For LOCAL testing and load tests only: no network call, no API key, no cost.
 * The same prompt always gets the same answer (a hash of the prompt picks the
 * category), and every answer passes the production validators, so the whole
 * pipeline — classification, brand deals, summaries, the inbox — runs exactly
 * as it would with a real model.
 *
 * should_auto_reply is always false: a mock must never cause a real Instagram
 * send. NEVER set this in production secrets — src/index.js logs a loud
 * warning at boot whenever it is on.
 */

const crypto = require('crypto');
const { CATEGORIES, CUSTOMER_TYPES } = require('../constants');

function isAiMock() {
  return String(process.env.AI_MOCK || '').trim().toLowerCase() === 'true';
}

function pick(list, hash, salt) {
  return list[parseInt(hash.slice(salt, salt + 8), 16) % list.length];
}

/** Adapter-shaped: resolves { text, usage }. */
async function mockComplete({ prompt = '', isJson = true, jobType = 'unknown' }) {
  const hash = crypto.createHash('sha256').update(String(prompt)).digest('hex');
  const usage = { input: 0, output: 0 };

  if (!isJson) return { text: 'Thanks for your message — we will get back to you shortly. (AI mock)', usage };

  if (jobType === 'summary') {
    return { text: JSON.stringify({ summary: 'Mock summary of the conversation (AI_MOCK).', stage: 'new' }), usage };
  }

  const n = parseInt(hash.slice(0, 8), 16);
  return {
    text: JSON.stringify({
      category: pick(CATEGORIES, hash, 0),
      intent: 'mock intent',
      customer_type: pick(CUSTOMER_TYPES, hash, 8),
      purchase_intent: n % 101,
      lead_quality: (n >>> 3) % 101,
      scam_probability: (n >>> 6) % 30,
      commercial_relevance: (n >>> 9) % 101,
      urgency: (n >>> 12) % 101,
      risk_level: 'LOW',
      confidence: 0.9,
      should_auto_reply: false,
      requires_human_attention: false,
      summary: 'Mock classification (AI_MOCK).',
      reasoning: 'Deterministic mock — no model was called.',
      recommended_action: 'Review when convenient.',
      sentiment: 'neutral',
      brand_deal: null,
    }),
    usage,
  };
}

module.exports = { isAiMock, mockComplete };
