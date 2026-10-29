/**
 * Groq Cloud Text Generation Provider (`openai/gpt-oss-20b`)
 *
 * Primary text generation provider for Siffty (auto-reply, draft reply, summaries).
 * Transparent fallback to Google Gemini on ANY failure: customer never sees an error.
 *
 * Features:
 * - OpenAI-compatible Chat Completions API at https://api.groq.com/openai/v1/chat/completions
 * - Default model: openai/gpt-oss-20b (REASONING model)
 * - Reasoning effort parameter + reasoning token isolation (reasoning kept out of output)
 * - Concurrency limiter (GROQ_MAX_CONCURRENCY, default 10)
 * - Circuit breaker (5 consecutive failures -> 60s cooldown, auto-recovering)
 * - 429 retry: at most once, and only if Retry-After <= 2000ms
 * - Captures rate limit headers for admin dashboard
 * - Never prints, logs, echoes or commits secret keys
 */

const { logAiUsage, normalizeStatus } = require('./aiUsageLogger');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_REASONING_EFFORT = 'low';
const CIRCUIT_BREAKER_FAILURES = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60 * 1000;
const ROLLING_WINDOW_SIZE = 500;

// Rate limit headers cache & shared state across modules/tests
const sharedState = globalThis.__groqTextGenState || (globalThis.__groqTextGenState = {
  latestRateLimits: {
    remainingRequests: null,
    remainingTokens: null,
    resetRequests: null,
    resetTokens: null,
    lastUpdated: null,
  },
  rollingCalls: [],
  lastGroqSuccessAt: null,
  lastGroqFailureAt: null,
  lastGroqFailureReason: null,
  circuitState: {
    consecutiveFailures: 0,
    circuitOpenUntil: 0,
  },
  cachedOverride: { value: null, expiresAt: 0 },
  customFetchImpl: null,
  limiter: null,
});

const latestRateLimits = sharedState.latestRateLimits;
const rollingCalls = sharedState.rollingCalls;
const circuitState = sharedState.circuitState;

// Concurrency limiter
class ConcurrencyLimiter {
  constructor(max = 10) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }

  setMax(newMax) {
    if (Number.isInteger(newMax) && newMax > 0) {
      this.max = newMax;
      this._drain();
    }
  }

  async run(fn) {
    if (this.active >= this.max) {
      await new Promise((resolve) => this.queue.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this._drain();
    }
  }

  _drain() {
    while (this.active < this.max && this.queue.length > 0) {
      this.active += 1;
      const next = this.queue.shift();
      next();
    }
  }

  reset() {
    this.active = 0;
    this.queue = [];
  }
}

function getLimiter() {
  const envVal = parseInt(process.env.GROQ_MAX_CONCURRENCY, 10);
  const max = Number.isInteger(envVal) && envVal > 0 ? envVal : 10;
  if (!sharedState.limiter) {
    sharedState.limiter = new ConcurrencyLimiter(max);
  } else {
    sharedState.limiter.setMax(max);
  }
  return sharedState.limiter;
}

// Circuit breaker
function isCircuitOpen(now = Date.now()) {
  return circuitState.circuitOpenUntil > now;
}

function recordSuccess() {
  circuitState.consecutiveFailures = 0;
  circuitState.circuitOpenUntil = 0;
}

function recordFailure(now = Date.now()) {
  circuitState.consecutiveFailures += 1;
  if (circuitState.consecutiveFailures >= CIRCUIT_BREAKER_FAILURES) {
    circuitState.circuitOpenUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS;
    circuitState.consecutiveFailures = 0;
  }
}

function _resetCircuitBreaker() {
  circuitState.consecutiveFailures = 0;
  circuitState.circuitOpenUntil = 0;
}

function _getCircuitBreakerState() {
  const isOpen = isCircuitOpen();
  const secondsUntilRetry = isOpen ? Math.max(0, Math.ceil((circuitState.circuitOpenUntil - Date.now()) / 1000)) : 0;
  return {
    isOpen,
    consecutiveFailures: circuitState.consecutiveFailures,
    circuitOpenUntil: circuitState.circuitOpenUntil,
    secondsUntilRetry,
    state: isOpen ? 'OPEN' : 'CLOSED',
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function _setFetchImpl(impl) {
  sharedState.customFetchImpl = impl;
}

function _resetFetchImpl() {
  sharedState.customFetchImpl = null;
}

function getFetch(fetchParam) {
  return fetchParam || sharedState.customFetchImpl || globalThis.fetch;
}

function captureRateLimits(headers) {
  if (!headers || typeof headers.get !== 'function') return;
  try {
    const remReq = headers.get('x-ratelimit-remaining-requests');
    const remTok = headers.get('x-ratelimit-remaining-tokens');
    const rstReq = headers.get('x-ratelimit-reset-requests');
    const rstTok = headers.get('x-ratelimit-reset-tokens');

    if (remReq !== null) latestRateLimits.remainingRequests = parseInt(remReq, 10);
    if (remTok !== null) latestRateLimits.remainingTokens = parseInt(remTok, 10);
    if (rstReq !== null) latestRateLimits.resetRequests = rstReq;
    if (rstTok !== null) latestRateLimits.resetTokens = rstTok;
    latestRateLimits.lastUpdated = Date.now();
  } catch {
    // Ignore header parsing issues
  }
}

function recordMetric({ provider, latencyMs, fallbackReason = null, timestamp = Date.now() }) {
  const entry = {
    timestamp,
    provider,
    fallbackReason: fallbackReason || null,
    latencyMs: Math.max(0, Math.round(latencyMs)),
  };

  sharedState.rollingCalls.push(entry);
  if (sharedState.rollingCalls.length > ROLLING_WINDOW_SIZE) {
    sharedState.rollingCalls.shift();
  }

  if (provider === 'groq' && !fallbackReason) {
    sharedState.lastGroqSuccessAt = timestamp;
  }
  if (fallbackReason) {
    sharedState.lastGroqFailureAt = timestamp;
    sharedState.lastGroqFailureReason = fallbackReason;
  }
}

function _resetMetrics() {
  sharedState.rollingCalls.length = 0;
  sharedState.lastGroqSuccessAt = null;
  sharedState.lastGroqFailureAt = null;
  sharedState.lastGroqFailureReason = null;
}

function getGroqApiKey() {
  return (process.env.GROQ_API_KEY || '').trim() || null;
}

function isGroqConfigured() {
  return getGroqApiKey() !== null;
}

/**
 * Remove reasoning blocks from text to keep customer output clean.
 */
function stripReasoning(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Single HTTP call to Groq with abort signal
 */
async function callGroqOnce({ apiKey, model, prompt, isJson, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const reasoningEffort = (process.env.GROQ_REASONING_EFFORT || DEFAULT_REASONING_EFFORT).trim();

  const payload = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: 4096,
    reasoning_effort: reasoningEffort,
  };

  if (isJson) {
    payload.response_format = { type: 'json_object' };
  }

  try {
    const res = await fetchImpl(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Call Groq with 429 retry (at most 1 retry, only if retry-after <= 2s)
 */
async function callGroqWithRetry({ apiKey, model, prompt, isJson, timeoutMs, fetchImpl }) {
  let lastResponse = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callGroqOnce({ apiKey, model, prompt, isJson, timeoutMs, fetchImpl });
    lastResponse = res;
    captureRateLimits(res.headers);

    if (res.status === 429 && attempt === 0) {
      const retryHeader = res.headers.get('retry-after');
      let waitMs = null;
      if (retryHeader) {
        const secs = Number(retryHeader);
        if (Number.isFinite(secs)) {
          waitMs = secs * 1000;
        } else {
          const parsed = new Date(retryHeader).getTime();
          if (!isNaN(parsed)) waitMs = parsed - Date.now();
        }
      }

      // Retry at most once, and ONLY if retry-after is short (about 2s or less)
      if (waitMs !== null && waitMs > 0 && waitMs <= 2000) {
        await sleep(waitMs);
        continue;
      }
      // Otherwise fall back immediately
      break;
    }

    // Success or other status code
    break;
  }

  return lastResponse;
}

/**
 * Map error or bad response to safe fallback reason
 */
function determineFallbackReason(err, httpStatus) {
  if (err && err.fallbackReason) return err.fallbackReason;
  if (httpStatus === 401) return 'auth_error_401';
  if (httpStatus === 403) return 'auth_error_403';
  if (httpStatus === 429) return 'rate_limited';
  if (httpStatus >= 500) return `http_${httpStatus}`;
  if (err && (err.name === 'AbortError' || /timeout/i.test(err.message || ''))) return 'timeout';
  if (err && (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || /network/i.test(err.message || ''))) return 'network_error';
  return 'groq_error';
}

const OVERRIDE_CACHE_TTL_MS = 15 * 1000;
let cachedOverride = { value: null, expiresAt: 0 };

function clearTextProviderOverrideCache() {
  sharedState.cachedOverride.value = null;
  sharedState.cachedOverride.expiresAt = 0;
}

async function getTextProviderOverride() {
  const now = Date.now();
  if (sharedState.cachedOverride.expiresAt > now) {
    return sharedState.cachedOverride.value;
  }
  try {
    const settings = require('../settings');
    const val = await settings.getSetting('text_generation_provider');
    sharedState.cachedOverride.value = val;
    sharedState.cachedOverride.expiresAt = now + OVERRIDE_CACHE_TTL_MS;
    return val;
  } catch {
    return sharedState.cachedOverride.value;
  }
}

/**
 * Determine effective text generation provider (kill switch > admin override > default groq)
 */
async function resolveTextProvider() {
  const force = (process.env.TEXT_PROVIDER_FORCE || '').trim().toLowerCase();
  if (force === 'gemini') {
    return { provider: 'gemini', source: 'kill_switch' };
  }
  const override = await getTextProviderOverride();
  if (override === 'gemini') {
    return { provider: 'gemini', source: 'admin_setting' };
  }
  if (override === 'groq') {
    return { provider: 'groq', source: 'admin_setting' };
  }
  return { provider: 'groq', source: 'default' };
}

/**
 * Core text generation with Groq and automatic Gemini fallback.
 *
 * @param {object} args
 * @param {string} args.prompt
 * @param {boolean} [args.isJson=false]
 * @param {string} [args.feature='other'] - auto_reply | draft_reply | summary | other
 * @param {string} [args.userId]
 * @param {string} [args.tenantId]
 * @param {string} [args.conversationId]
 * @param {string} [args.messageId]
 * @param {Function} args.fallbackFn - async () => ({ text, json?, model, provider, usage? })
 * @param {Function} [args.validate] - optional schema validator for JSON output
 */
async function generateTextWithGroqOrFallback({
  prompt,
  isJson = false,
  feature = 'other',
  userId = null,
  tenantId = null,
  conversationId = null,
  messageId = null,
  fallbackFn,
  validate = null,
}) {
  const effective = await resolveTextProvider();
  const apiKey = getGroqApiKey();
  const model = process.env.GROQ_TEXT_MODEL || DEFAULT_MODEL;
  const timeoutMs = parseInt(process.env.GROQ_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;
  const fetchImpl = getFetch();

  // If switched to Gemini or kill switch active, call fallback directly
  if (effective.provider === 'gemini') {
    const startedFallback = Date.now();
    try {
      const fbResult = await fallbackFn();
      logAiUsage({
        userId,
        tenantId,
        feature,
        provider: fbResult.provider || 'gemini',
        model: fbResult.model || 'gemini-flash-lite-latest',
        attemptNo: 1,
        isFallback: false,
        status: 'success',
        latencyMs: Date.now() - startedFallback,
        promptTokens: fbResult.usage?.input,
        completionTokens: fbResult.usage?.output,
        totalTokens: fbResult.usage ? (fbResult.usage.input || 0) + (fbResult.usage.output || 0) : null,
        conversationId,
        messageId,
      });
      return fbResult;
    } catch (fbErr) {
      logAiUsage({
        userId,
        tenantId,
        feature,
        provider: 'gemini',
        model: 'gemini-flash-lite-latest',
        attemptNo: 1,
        isFallback: false,
        status: 'error',
        error: fbErr,
        latencyMs: Date.now() - startedFallback,
        conversationId,
        messageId,
      });
      throw fbErr;
    }
  }

  // Pre-call validation for Groq
  let skipGroqReason = null;
  if (!apiKey) {
    skipGroqReason = 'missing_key';
  } else if (isCircuitOpen()) {
    skipGroqReason = 'circuit_open';
  }

  if (skipGroqReason) {
    recordMetric({ provider: 'gemini', latencyMs: 0, fallbackReason: skipGroqReason });
    // Log skipped Groq attempt as fallback trigger
    logAiUsage({
      userId,
      tenantId,
      feature,
      provider: 'groq',
      model,
      attemptNo: 1,
      isFallback: false,
      status: skipGroqReason === 'circuit_open' ? 'error' : 'error',
      fallbackReason: skipGroqReason,
      latencyMs: 0,
      errorMessage: `Groq skipped: ${skipGroqReason}`,
      conversationId,
      messageId,
    });

    // Execute fallback
    return executeFallback({
      fallbackFn,
      fallbackReason: skipGroqReason,
      userId,
      tenantId,
      feature,
      conversationId,
      messageId,
      attemptNo: 2,
    });
  }

  // Run through concurrency limiter
  const limiter = getLimiter();
  const groqStarted = Date.now();

  try {
    const result = await limiter.run(async () => {
      const res = await callGroqWithRetry({ apiKey, model, prompt, isJson, timeoutMs, fetchImpl });
      const latencyMs = Date.now() - groqStarted;

      if (!res.ok) {
        let errBody;
        try { errBody = await res.json(); } catch { /* ignore */ }
        const errMsg = errBody?.error?.message || `Groq HTTP ${res.status}`;
        const reason = determineFallbackReason(new Error(errMsg), res.status);
        throw Object.assign(new Error(errMsg), {
          status: res.status,
          fallbackReason: reason,
          latencyMs,
          requestId: res.headers.get('x-request-id'),
        });
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const finishReason = choice?.finish_reason;

      if (finishReason === 'length') {
        throw Object.assign(new Error('Groq output truncated by length limit'), {
          fallbackReason: 'finish_reason_length',
          latencyMs,
          status: 'empty',
          httpStatus: 200,
          requestId: res.headers.get('x-request-id'),
          usage: data.usage,
        });
      }

      const rawText = choice?.message?.content || '';
      const cleanText = stripReasoning(rawText);

      if (!cleanText.trim()) {
        throw Object.assign(new Error('Groq returned empty text response'), {
          fallbackReason: 'empty_content',
          latencyMs,
          status: 'empty',
          httpStatus: 200,
          requestId: res.headers.get('x-request-id'),
          usage: data.usage,
        });
      }

      let parsedJson = null;
      if (isJson) {
        try {
          parsedJson = JSON.parse(cleanText);
        } catch {
          // Fall back to JSON extraction fence or curly braces
          const fence = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
          if (fence) {
            try { parsedJson = JSON.parse(fence[1].trim()); } catch { /* ignore */ }
          }
          if (!parsedJson) {
            const a = cleanText.indexOf('{');
            const b = cleanText.lastIndexOf('}');
            if (a !== -1 && b > a) {
              try { parsedJson = JSON.parse(cleanText.slice(a, b + 1)); } catch { /* ignore */ }
            }
          }
          if (!parsedJson) {
            throw Object.assign(new Error('Groq returned invalid JSON'), {
              fallbackReason: 'unparseable_json',
              latencyMs,
              requestId: res.headers.get('x-request-id'),
              usage: data.usage,
            });
          }
        }

        if (validate) {
          const verdict = validate(parsedJson);
          if (!verdict.valid) {
            throw Object.assign(new Error(`Groq JSON failed validation: ${verdict.errors?.join(', ')}`), {
              fallbackReason: 'schema_invalid',
              latencyMs,
              requestId: res.headers.get('x-request-id'),
              usage: data.usage,
            });
          }
        }
      }

      return {
        text: cleanText,
        json: parsedJson,
        model,
        provider: 'groq',
        latencyMs,
        requestId: res.headers.get('x-request-id'),
        usage: data.usage,
      };
    });

    // Groq succeeded!
    recordSuccess();
    recordMetric({ provider: 'groq', latencyMs: result.latencyMs });

    const pTokens = result.usage?.prompt_tokens ?? null;
    const cTokens = result.usage?.completion_tokens ?? null;
    const rTokens = result.usage?.completion_tokens_details?.reasoning_tokens ?? null;
    const cachedTokens = result.usage?.prompt_tokens_details?.cached_tokens ?? null;
    const totalTokens = result.usage?.total_tokens ?? (pTokens + cTokens);

    logAiUsage({
      userId,
      tenantId,
      feature,
      provider: 'groq',
      model,
      attemptNo: 1,
      isFallback: false,
      status: 'success',
      latencyMs: result.latencyMs,
      promptTokens: pTokens,
      completionTokens: cTokens,
      reasoningTokens: rTokens,
      cachedTokens,
      totalTokens,
      providerRequestId: result.requestId,
      conversationId,
      messageId,
    });

    return {
      text: result.text,
      json: result.json,
      model,
      provider: 'groq',
      latencyMs: result.latencyMs,
      usage: result.usage,
    };
  } catch (groqErr) {
    const latencyMs = groqErr.latencyMs || (Date.now() - groqStarted);
    recordFailure();
    const fallbackReason = groqErr.fallbackReason || determineFallbackReason(groqErr, groqErr.status);
    recordMetric({ provider: 'gemini', latencyMs, fallbackReason });

    logAiUsage({
      userId,
      tenantId,
      feature,
      provider: 'groq',
      model,
      attemptNo: 1,
      isFallback: false,
      status: groqErr.status === 'empty' ? 'empty' : normalizeStatus({ httpStatus: groqErr.httpStatus || groqErr.status, error: groqErr }),
      httpStatus: typeof groqErr.httpStatus === 'number' ? groqErr.httpStatus : (typeof groqErr.status === 'number' ? groqErr.status : null),
      fallbackReason,
      latencyMs,
      promptTokens: groqErr.usage?.prompt_tokens,
      completionTokens: groqErr.usage?.completion_tokens,
      totalTokens: groqErr.usage?.total_tokens,
      providerRequestId: groqErr.requestId,
      error: groqErr,
      conversationId,
      messageId,
    });

    console.warn(`[GroqTextGen] Groq call failed (${fallbackReason}), falling back to Gemini: ${groqErr.message}`);

    // Transparently fall back to Gemini
    return executeFallback({
      fallbackFn,
      fallbackReason,
      userId,
      tenantId,
      feature,
      conversationId,
      messageId,
      attemptNo: 2,
    });
  }
}

/**
 * Execute fallback function and log usage.
 */
async function executeFallback({
  fallbackFn,
  fallbackReason,
  userId,
  tenantId,
  feature,
  conversationId,
  messageId,
  attemptNo = 2,
}) {
  const started = Date.now();
  try {
    const out = await fallbackFn();
    const latencyMs = Date.now() - started;

    logAiUsage({
      userId,
      tenantId,
      feature,
      provider: out.provider || 'gemini',
      model: out.model || 'gemini-flash-lite-latest',
      attemptNo,
      isFallback: true,
      fallbackReason,
      status: 'success',
      latencyMs,
      promptTokens: out.usage?.input,
      completionTokens: out.usage?.output,
      totalTokens: out.usage ? (out.usage.input || 0) + (out.usage.output || 0) : null,
      conversationId,
      messageId,
    });

    return {
      ...out,
      isFallback: true,
      fallbackReason,
    };
  } catch (fbErr) {
    const latencyMs = Date.now() - started;
    logAiUsage({
      userId,
      tenantId,
      feature,
      provider: 'gemini',
      model: 'gemini-flash-lite-latest',
      attemptNo,
      isFallback: true,
      fallbackReason,
      status: 'error',
      error: fbErr,
      latencyMs,
      conversationId,
      messageId,
    });
    throw fbErr;
  }
}

/**
 * Status stats for admin health view
 */
function getGroqTextGenStats() {
  const totalCalls = rollingCalls.length;
  const groqCalls = rollingCalls.filter((c) => c.provider === 'groq').length;
  const fallbackCalls = rollingCalls.filter((c) => c.fallbackReason !== null).length;
  const errorRate = totalCalls > 0 ? (fallbackCalls / totalCalls) * 100 : 0;

  const groqLatencies = rollingCalls
    .filter((c) => c.provider === 'groq')
    .map((c) => c.latencyMs)
    .sort((a, b) => a - b);

  const p50 = groqLatencies.length ? groqLatencies[Math.floor(groqLatencies.length * 0.5)] : null;
  const p95 = groqLatencies.length ? groqLatencies[Math.min(groqLatencies.length - 1, Math.floor(groqLatencies.length * 0.95))] : null;

  const fallbackReasons = {};
  for (const c of rollingCalls) {
    if (c.fallbackReason) {
      fallbackReasons[c.fallbackReason] = (fallbackReasons[c.fallbackReason] || 0) + 1;
    }
  }

  const breaker = _getCircuitBreakerState();

  return {
    isConfigured: isGroqConfigured(),
    model: process.env.GROQ_TEXT_MODEL || DEFAULT_MODEL,
    circuitBreaker: breaker,
    rateLimits: { ...latestRateLimits },
    lastSuccessAt: sharedState.lastGroqSuccessAt,
    lastFailureAt: sharedState.lastGroqFailureAt,
    lastFailureReason: sharedState.lastGroqFailureReason,
    totalCalls,
    groqCalls,
    fallbackCalls,
    errorRate: Number(errorRate.toFixed(1)),
    latency: { p50, p95 },
    fallbackReasons,
  };
}

module.exports = {
  generateTextWithGroqOrFallback,
  resolveTextProvider,
  getGroqTextGenStats,
  isGroqConfigured,
  clearTextProviderOverrideCache,
  stripReasoning,
  determineFallbackReason,
  _resetCircuitBreaker,
  _getCircuitBreakerState,
  _setFetchImpl,
  _resetFetchImpl,
  _resetMetrics,
  getLimiter,
};
