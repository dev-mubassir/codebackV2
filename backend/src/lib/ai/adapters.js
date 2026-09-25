/**
 * Provider adapters (Gate 4). Same input, same output, for every provider:
 *
 *   complete({ model, prompt, isJson, timeout, apiKey })
 *     -> { text, usage: { input, output } }
 *
 * Throws on a transport/HTTP failure (the router decides whether to retry),
 * or an Error with aiErrorCode 'EMPTY_RESPONSE' / 'REFUSAL' when the call
 * succeeded but produced nothing usable. Parsing JSON and validating the
 * classification schema happen ONCE, above this layer (lib/ai/router.js +
 * lib/ai/schema.js), so every provider is held to the same contract.
 *
 * HTTP via axios, not the providers' SDKs: axios is already a dependency and
 * already carries the Gemini and OpenAI calls, so this adds no package and
 * leaves a single HTTP boundary to mock in tests. (The official Anthropic SDK
 * is the vendor-recommended client; it would add a dependency for one POST.)
 *
 * Endpoints are CONSTANTS. There is no base-URL setting anywhere.
 *
 * Keys travel in HEADERS only — including Gemini (x-goog-api-key), which the
 * old code put in the URL query string, where any logged request URL or
 * axios error config would carry it.
 */

const axios = require('axios');

const ENDPOINTS = Object.freeze({
  gemini: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  openai: () => 'https://api.openai.com/v1/chat/completions',
  anthropic: () => 'https://api.anthropic.com/v1/messages',
});

function emptyResponse(code = 'EMPTY_RESPONSE') {
  return Object.assign(new Error('The provider returned no usable text'), { aiErrorCode: code });
}

const gemini = {
  async complete({ model, prompt, isJson, timeout, apiKey }) {
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    if (isJson) payload.generationConfig = { responseMimeType: 'application/json' };
    const { data } = await axios.post(ENDPOINTS.gemini(model), payload, {
      timeout,
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    });
    const usage = { input: data?.usageMetadata?.promptTokenCount, output: data?.usageMetadata?.candidatesTokenCount };
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text.trim()) throw Object.assign(emptyResponse(), { usage });
    return { text, usage };
  },
};

const openai = {
  async complete({ model, prompt, isJson, timeout, apiKey }) {
    const payload = { model, messages: [{ role: 'user', content: prompt }] };
    if (isJson) payload.response_format = { type: 'json_object' };
    const { data } = await axios.post(ENDPOINTS.openai(), payload, {
      timeout,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    const usage = { input: data?.usage?.prompt_tokens, output: data?.usage?.completion_tokens };
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text.trim()) throw Object.assign(emptyResponse(), { usage });
    return { text, usage };
  },
};

// Sonnet 5 and Opus 5 think adaptively by default; for short classification
// and reply work, low effort keeps cost and latency down. Haiku 4.5 rejects
// the effort parameter, so it is sent only where supported.
const ANTHROPIC_EFFORT_MODELS = new Set(['claude-sonnet-5', 'claude-opus-5']);

const anthropic = {
  async complete({ model, prompt, timeout, apiKey }) {
    const payload = {
      model,
      max_tokens: 4096, // room for adaptive thinking plus a short JSON answer
      messages: [{ role: 'user', content: prompt }],
      ...(ANTHROPIC_EFFORT_MODELS.has(model) ? { output_config: { effort: 'low' } } : {}),
    };
    const { data } = await axios.post(ENDPOINTS.anthropic(), payload, {
      timeout,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    });
    const usage = { input: data?.usage?.input_tokens, output: data?.usage?.output_tokens };
    if (data?.stop_reason === 'refusal') throw Object.assign(emptyResponse('REFUSAL'), { usage });
    // Only text blocks: thinking blocks (empty by default) are skipped.
    const text = (Array.isArray(data?.content) ? data.content : [])
      .filter((b) => b && b.type === 'text')
      .map((b) => b.text || '')
      .join('');
    if (!text.trim()) throw Object.assign(emptyResponse(), { usage });
    return { text, usage };
  },
};

const ADAPTERS = Object.freeze({ gemini, openai, anthropic });

module.exports = { ADAPTERS, ENDPOINTS };
