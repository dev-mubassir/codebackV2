/**
 * AI Price Table and Cost Estimation
 *
 * Prices are in USD per 1 million tokens.
 * Groq: console.groq.com/docs/models
 *   - openai/gpt-oss-20b: $0.075 in / $0.30 out / $0.0375 cached-in, per 1M tokens
 * Gemini: current prices from lib/ai/models.js
 *   - gemini-flash-lite-latest: $0.10 in / $0.40 out, per 1M tokens
 *   - gemini-flash-latest: $0.30 in / $2.50 out, per 1M tokens
 */

const AI_PRICE_TABLE = Object.freeze({
  groq: {
    'openai/gpt-oss-20b': { input: 0.075, output: 0.30, cachedInput: 0.0375 },
    default: { input: 0.075, output: 0.30, cachedInput: 0.0375 },
  },
  gemini: {
    'gemini-flash-lite-latest': { input: 0.10, output: 0.40, cachedInput: 0.025 },
    'gemini-flash-latest': { input: 0.30, output: 2.50, cachedInput: 0.075 },
    default: { input: 0.10, output: 0.40, cachedInput: 0.025 },
  },
  cloudflare: {
    '@cf/cloudflare/clef-flash': { input: 0.0, output: 0.0, cachedInput: 0.0 },
    default: { input: 0.0, output: 0.0, cachedInput: 0.0 },
  },
  clef: {
    '@cf/cloudflare/clef-flash': { input: 0.0, output: 0.0, cachedInput: 0.0 },
    default: { input: 0.0, output: 0.0, cachedInput: 0.0 },
  },
  openai: {
    'gpt-4o-mini': { input: 0.15, output: 0.60, cachedInput: 0.075 },
    'gpt-4o': { input: 2.50, output: 10.0, cachedInput: 1.25 },
    default: { input: 0.15, output: 0.60, cachedInput: 0.075 },
  },
  anthropic: {
    'claude-haiku-4-5': { input: 1.0, output: 5.0, cachedInput: 0.10 },
    'claude-sonnet-5': { input: 2.0, output: 10.0, cachedInput: 0.20 },
    'claude-opus-5': { input: 5.0, output: 25.0, cachedInput: 0.50 },
    default: { input: 1.0, output: 5.0, cachedInput: 0.10 },
  },
});

function getPriceFor(provider, model) {
  const normProvider = (provider || '').toLowerCase();
  const providerPrices = AI_PRICE_TABLE[normProvider];
  if (!providerPrices) return null;
  return providerPrices[model] || providerPrices.default || null;
}

/**
 * Compute estimated USD cost for a given call
 */
function estimateCostUsd({ provider, model, promptTokens, completionTokens, cachedTokens = 0 }) {
  const price = getPriceFor(provider, model);
  if (!price) return null;

  const prompt = Number.isFinite(promptTokens) ? Math.max(0, promptTokens) : 0;
  const completion = Number.isFinite(completionTokens) ? Math.max(0, completionTokens) : 0;
  const cached = Number.isFinite(cachedTokens) ? Math.max(0, Math.min(cachedTokens, prompt)) : 0;
  const uncachedPrompt = Math.max(0, prompt - cached);

  const cachedRate = price.cachedInput !== undefined ? price.cachedInput : price.input;
  const totalCost = (uncachedPrompt * price.input + cached * cachedRate + completion * price.output) / 1e6;
  return totalCost;
}

function getUsdInrRate() {
  const envVal = parseFloat(process.env.USD_INR);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 84.0;
}

function usdToInr(usd) {
  if (usd == null || !Number.isFinite(usd)) return null;
  return usd * getUsdInrRate();
}

module.exports = {
  AI_PRICE_TABLE,
  getPriceFor,
  estimateCostUsd,
  getUsdInrRate,
  usdToInr,
};

