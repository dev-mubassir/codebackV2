/**
 * The AI ALLOWLIST (Gate 4): the only providers and models Siffty will call.
 *
 * The admin panel can pick a provider + model ONLY from this list. There are
 * no custom model names, no custom base URLs and no free-text endpoints: each
 * provider's endpoint is a constant in lib/ai/adapters.js, and its key is read
 * from a fixed environment variable — never accepted, stored or returned by
 * any endpoint. The panel sees only "key configured: yes/no".
 *
 * Prices are USD per 1 million tokens, for cost ESTIMATES only (health page,
 * cost comparison, alerts) — never to bill a customer.
 *   - Anthropic: from the Claude API reference bundled with Claude Code
 *     (cached 2026-06-24): Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25.
 *   - Gemini, OpenAI: provider list prices at the time of writing — UNVERIFIED
 *     against today's pages; re-check before relying on the cost numbers.
 *
 * xAI (Grok) was removed in Gate 4 (owner decision).
 */

const PROVIDERS = Object.freeze({
  gemini: {
    name: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    models: {
      'gemini-flash-lite-latest': { label: 'Gemini Flash-Lite (latest)', input: 0.1, output: 0.4 },
      'gemini-flash-latest': { label: 'Gemini Flash (latest)', input: 0.3, output: 2.5 },
    },
  },
  openai: {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: {
      'gpt-4o-mini': { label: 'GPT-4o mini', input: 0.15, output: 0.6 },
      'gpt-4o': { label: 'GPT-4o', input: 2.5, output: 10 },
    },
  },
  anthropic: {
    name: 'Anthropic Claude',
    envKey: 'ANTHROPIC_API_KEY',
    models: {
      'claude-haiku-4-5': { label: 'Claude Haiku 4.5', input: 1, output: 5 },
      'claude-sonnet-5': { label: 'Claude Sonnet 5', input: 2, output: 10 },
      'claude-opus-5': { label: 'Claude Opus 5', input: 5, output: 25 },
    },
  },
});

/** The behaviour before any admin choice: what production ran before Gate 4. */
const DEFAULT_ACTIVE = Object.freeze({ provider: 'gemini', model: 'gemini-flash-lite-latest' });

function isAllowed(provider, model) {
  return (
    typeof provider === 'string' &&
    typeof model === 'string' &&
    Object.prototype.hasOwnProperty.call(PROVIDERS, provider) &&
    Object.prototype.hasOwnProperty.call(PROVIDERS[provider].models, model)
  );
}

/** The key for a provider, or null. Read at call time, never cached or returned. */
function apiKeyFor(provider) {
  const def = PROVIDERS[provider];
  if (!def) return null;
  const value = (process.env[def.envKey] || '').trim();
  return value || null;
}

const keyConfigured = (provider) => apiKeyFor(provider) !== null;

function priceOf(provider, model) {
  if (!isAllowed(provider, model)) return null;
  const { input, output } = PROVIDERS[provider].models[model];
  return { input, output };
}

/** Estimated USD cost of one call, or null when tokens or the price are unknown. */
function estimateCost(provider, model, inputTokens, outputTokens) {
  const price = priceOf(provider, model);
  if (!price || inputTokens == null || outputTokens == null) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

/** The allowlist as the admin panel sees it: names, models, prices, key yes/no. Never a key. */
function catalogue() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    name: p.name,
    envKey: p.envKey, // the variable's NAME, so the owner knows what to set — never its value
    keyConfigured: keyConfigured(id),
    models: Object.entries(p.models).map(([modelId, m]) => ({ id: modelId, label: m.label, inputPrice: m.input, outputPrice: m.output })),
  }));
}

module.exports = { PROVIDERS, DEFAULT_ACTIVE, isAllowed, apiKeyFor, keyConfigured, priceOf, estimateCost, catalogue };
