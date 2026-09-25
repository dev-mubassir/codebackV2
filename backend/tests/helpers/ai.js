/**
 * Provider response fixtures for the AI tests (Gate 4). Provider HTTP is
 * mocked at the axios boundary; these build each provider's own response
 * shape around the SAME classification answer, so a test can show that every
 * adapter normalises to one output.
 */

/** A classification answer that passes lib/ai/schema.js. */
export const VALID_CLASSIFICATION = Object.freeze({
  category: 'pricing_inquiry',
  intent: 'price_for_reel_edit',
  customer_type: 'potential_buyer',
  purchase_intent: 70,
  lead_quality: 60,
  commercial_relevance: 80,
  urgency: 30,
  risk_level: 'LOW',
  scam_probability: 0,
  sentiment: 'neutral',
  confidence: 0.9,
  should_auto_reply: true,
  requires_human_attention: false,
  summary: 'Asks the price of one reel edit.',
  reasoning: 'They ask directly what one edit costs.',
  recommended_action: 'ANSWER_PRICING',
  brand_deal: null,
});

export const geminiResponse = (text, input = 120, output = 30) => ({
  data: { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: input, candidatesTokenCount: output } },
});

export const openaiResponse = (text, input = 110, output = 28) => ({
  data: { choices: [{ message: { content: text } }], usage: { prompt_tokens: input, completion_tokens: output } },
});

export const anthropicResponse = (text, input = 130, output = 35, stopReason = 'end_turn') => ({
  data: {
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
    stop_reason: stopReason,
    usage: { input_tokens: input, output_tokens: output },
  },
});

/** Pick the provider from the URL axios.post was called with. */
export function providerOfUrl(url) {
  if (url.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (url.includes('api.openai.com')) return 'openai';
  if (url.includes('api.anthropic.com')) return 'anthropic';
  return 'unknown';
}
