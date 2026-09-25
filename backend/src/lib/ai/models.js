/**
 * AI models Siffty may call, with token prices for cost ESTIMATES.
 *
 * Prices are USD per 1 million tokens, taken from each provider's public
 * price list at the time of writing. They are ESTIMATES — used for the admin
 * dashboard's cost figures and alerts, never for billing a customer. Verify
 * them against the provider's page when a price changes; the admin health
 * page labels every cost as estimated.
 *
 * Gate 4 turns this into the ALLOWLIST: the admin can only pick a provider +
 * model listed here. No free-text model names, no custom base URLs.
 */

const PRICES_PER_MILLION = Object.freeze({
  gemini: {
    'gemini-flash-lite-latest': { input: 0.1, output: 0.4 },
    'gemini-flash-latest': { input: 0.3, output: 2.5 },
    'gemini-3-flash-preview': { input: 0.3, output: 2.5 },
    'gemini-3.1-flash-lite-preview': { input: 0.1, output: 0.4 },
  },
  openai: {
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4o': { input: 2.5, output: 10 },
  },
  xai: {
    'grok-3-mini': { input: 0.3, output: 0.5 },
    'grok-2-latest': { input: 2, output: 10 },
    'grok-beta': { input: 5, output: 15 },
  },
});

function priceOf(provider, model) {
  return (PRICES_PER_MILLION[provider] && PRICES_PER_MILLION[provider][model]) || null;
}

/** Estimated USD cost of one call, or null when tokens or the price are unknown. */
function estimateCost(provider, model, inputTokens, outputTokens) {
  const price = priceOf(provider, model);
  if (!price || inputTokens == null || outputTokens == null) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

module.exports = { PRICES_PER_MILLION, priceOf, estimateCost };
