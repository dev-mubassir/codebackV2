/**
 * The ONE path every AI call takes (Gate 4, building on Gate 3's logging).
 *
 *   callAI({ jobType, tenantId, prompt, isJson, validate, timeout })
 *     -> { text, json?, provider, model }
 *
 * 1. Which model: the admin's AiConfig (cached 30s), validated against the
 *    code allowlist on every read. An invalid or missing row means the code
 *    default. A key that is not configured means "not configured" — a clean
 *    NO_PROVIDERS_CONFIGURED error, never a crash.
 * 2. Per call: a timeout, and up to 2 retries with backoff for TRANSIENT
 *    failures only (network, timeout, 408/429/5xx). A 4xx, an empty answer,
 *    unparseable JSON or a schema-invalid answer is not retried — sending the
 *    same prompt again rarely fixes those and still costs money.
 * 3. Optional fallback: when enabled, 5 consecutive failed calls on the
 *    active model switch traffic to the fallback for 30 minutes, email the
 *    admins (admin email bucket) and write an audit row. The switch is
 *    temporary and in memory — this is a single instance — and ends on its
 *    own; the active model is tried again after it.
 * 4. Every HTTP attempt is logged to ai_call_logs (lib/ai/callLog.js).
 *
 * Keys are read from the environment at call time, used in a header, and
 * never logged, stored or returned.
 */

const prisma = require('../prisma');
const { ADAPTERS } = require('./adapters');
const { DEFAULT_ACTIVE, isAllowed, apiKeyFor } = require('./models');
const { recordAiCall } = require('./callLog');

const CONFIG_TTL_MS = 30 * 1000;
const FALLBACK_AFTER_FAILURES = 5;
const FALLBACK_DURATION_MS = 30 * 60 * 1000;
const MAX_RETRIES = 2;
let backoffMs = [500, 1500]; // test seam: _setBackoff

let cached = null; // { value, expiresAt }
const state = { consecutiveFailures: 0, fallbackUntil: 0, fallbackStartedAt: null };

function sanitizeConfig(row) {
  const active = row && isAllowed(row.activeProvider, row.activeModel)
    ? { provider: row.activeProvider, model: row.activeModel }
    : { ...DEFAULT_ACTIVE };
  const fallback = row && row.fallbackProvider && isAllowed(row.fallbackProvider, row.fallbackModel)
    ? { provider: row.fallbackProvider, model: row.fallbackModel }
    : null;
  const previous = row && row.previousProvider && isAllowed(row.previousProvider, row.previousModel)
    ? { provider: row.previousProvider, model: row.previousModel }
    : null;
  return {
    active,
    fallback,
    fallbackEnabled: Boolean(row && row.fallbackEnabled && fallback),
    previous,
    updatedAt: row ? row.updatedAt : null,
    updatedBy: row ? row.updatedBy : null,
    isDefault: !row,
  };
}

async function getAiConfig({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cached && cached.expiresAt > now) return cached.value;
  let row = null;
  try {
    row = await prisma.aiConfig.findUnique({ where: { id: 'active' } });
  } catch (err) {
    console.error('[AiRouter] Could not read ai_config; using the last known or default config:', err.message);
    if (cached) return cached.value;
  }
  const value = sanitizeConfig(row);
  cached = { value, expiresAt: now + CONFIG_TTL_MS };
  return value;
}

function clearAiConfigCache() {
  cached = null;
}

function fallbackActive(now = Date.now()) {
  return state.fallbackUntil > now;
}

function fallbackState() {
  return {
    active: fallbackActive(),
    until: fallbackActive() ? new Date(state.fallbackUntil).toISOString() : null,
    startedAt: fallbackActive() ? state.fallbackStartedAt : null,
    consecutiveFailures: state.consecutiveFailures,
  };
}

const isTransient = (err) => {
  if (err && err.aiErrorCode) return false;
  const status = err && err.response && err.response.status;
  if (!status) return true; // network error / timeout
  return status === 408 || status === 429 || status >= 500;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_RETRY_AFTER_MS = 10 * 1000; // a provider asking for longer is better served by the queue's own retry

/**
 * How long to wait before retry number `attempt` (1-based).
 *
 * A 429/503 that names its own wait (Retry-After, seconds or an HTTP date) is
 * obeyed, capped. Otherwise the fixed backoff step is jittered to 50–150%, so
 * a burst of workers that failed together does not retry together — lockstep
 * retries against a rate-limited provider just fail again as a group.
 */
function retryDelayMs(attempt, err) {
  const header = err && err.response && err.response.headers && err.response.headers['retry-after'];
  if (header !== undefined && header !== null && header !== '') {
    const seconds = Number(header);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : new Date(header).getTime() - Date.now();
    if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
  }
  const base = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1];
  return Math.round(base * (0.5 + Math.random()));
}

function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* fall through */ } }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

/**
 * One provider/model, with retries. Every attempt is logged.
 * Resolves { text, json? } or throws the last error.
 */
async function callTarget({ provider, model }, { prompt, isJson, validate, timeout, jobType, tenantId }) {
  const apiKey = apiKeyFor(provider);
  if (!apiKey) {
    throw Object.assign(new Error(`${provider} is not configured`), { code: 'NO_PROVIDERS_CONFIGURED' });
  }
  const adapter = ADAPTERS[provider];
  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs(attempt, lastErr));
    const started = Date.now();
    let out;
    try {
      out = await adapter.complete({ model, prompt, isJson, timeout, apiKey });
    } catch (err) {
      lastErr = err;
      recordAiCall({
        provider, model, jobType, tenantId, latencyMs: Date.now() - started, success: false, error: err,
        inputTokens: err.usage?.input, outputTokens: err.usage?.output,
      });
      if (!isTransient(err)) break;
      continue;
    }

    const log = (success, aiErrorCode) =>
      recordAiCall({
        provider, model, jobType, tenantId, latencyMs: Date.now() - started, success,
        error: success ? null : { aiErrorCode }, inputTokens: out.usage.input, outputTokens: out.usage.output,
      });

    if (!isJson) {
      log(true);
      return { text: out.text.trim() };
    }
    const json = extractJSON(out.text);
    if (!json) {
      log(false, 'UNPARSEABLE');
      lastErr = Object.assign(new Error('The provider returned unparseable JSON'), { aiErrorCode: 'UNPARSEABLE' });
      break;
    }
    if (validate) {
      const verdict = validate(json);
      if (!verdict.valid) {
        log(false, 'SCHEMA_INVALID');
        lastErr = Object.assign(new Error(`Schema-invalid answer (${verdict.errors.slice(0, 5).join(', ')})`), {
          aiErrorCode: 'SCHEMA_INVALID',
        });
        break;
      }
    }
    log(true);
    return { text: out.text, json };
  }
  throw lastErr || new Error('AI call failed');
}

async function onFallbackTriggered(config) {
  // Lazily required: adminAlerts → email → … must not load at module init.
  const { sendAdminOpsAlert } = require('../adminAlerts');
  const until = new Date(state.fallbackUntil).toISOString();
  await prisma.adminAuditLog
    .create({
      data: {
        action: 'AI_FALLBACK_ACTIVATED',
        targetType: 'SYSTEM',
        after: { from: config.active, to: config.fallback, consecutiveFailures: FALLBACK_AFTER_FAILURES, until },
      },
    })
    .catch((err) => console.error('[AiRouter] Could not audit the fallback switch:', err.message));
  console.error(`[AiRouter] ${config.active.provider}/${config.active.model} failed ${FALLBACK_AFTER_FAILURES} times in a row; using fallback ${config.fallback.provider}/${config.fallback.model} until ${until}.`);
  await sendAdminOpsAlert({
    title: 'AI fallback activated',
    lead: `The active AI model failed ${FALLBACK_AFTER_FAILURES} times in a row, so traffic moved to the fallback for 30 minutes. The active model is tried again after that.`,
    facts: [
      `active: ${config.active.provider} / ${config.active.model}`,
      `fallback: ${config.fallback.provider} / ${config.fallback.model}`,
      `until: ${until}`,
    ],
  });
}

/**
 * @param {object} args
 * @param {string} args.jobType  classification | summary | reply | admin_test
 * @param {string} [args.tenantId]
 * @param {string} args.prompt
 * @param {boolean} [args.isJson=true]
 * @param {(json) => {valid: boolean, errors: string[]}} [args.validate]
 * @param {number} [args.timeout=14000]
 * @param {{provider, model}} [args.target]  force a target (admin model test) — must be allowlisted
 */
async function callAI({ jobType = 'unknown', tenantId = null, prompt, isJson = true, validate, timeout = 14000, target }) {
  const opts = { prompt, isJson, validate, timeout, jobType, tenantId };

  if (target) {
    if (!isAllowed(target.provider, target.model)) {
      throw Object.assign(new Error('Not an allowed provider/model'), { code: 'NOT_ALLOWED' });
    }
    const out = await callTarget(target, opts);
    return { ...out, ...target };
  }

  // KILL SWITCH (Gate 7): no customer AI call while AI is turned off. The
  // admin model test (target set, above) still works, so a provider can be
  // checked before AI is turned back on.
  const { getSetting } = require('../settings');
  if (!(await getSetting('ai_classification_enabled'))) {
    throw Object.assign(new Error('AI is turned off by an admin'), { code: 'AI_DISABLED' });
  }

  const config = await getAiConfig();
  const useFallback = config.fallbackEnabled && fallbackActive();
  const chosen = useFallback ? config.fallback : config.active;

  try {
    const out = await callTarget(chosen, opts);
    if (!useFallback) state.consecutiveFailures = 0;
    return { ...out, ...chosen };
  } catch (err) {
    if (useFallback || err.code === 'NO_PROVIDERS_CONFIGURED') throw err;

    state.consecutiveFailures += 1;
    if (config.fallbackEnabled && state.consecutiveFailures >= FALLBACK_AFTER_FAILURES && apiKeyFor(config.fallback.provider)) {
      state.fallbackUntil = Date.now() + FALLBACK_DURATION_MS;
      state.fallbackStartedAt = new Date().toISOString();
      state.consecutiveFailures = 0;
      await onFallbackTriggered(config).catch((e) => console.error('[AiRouter] Fallback alert failed:', e.message));
      // This call is retried on the fallback straight away.
      const out = await callTarget(config.fallback, opts);
      return { ...out, ...config.fallback };
    }
    throw err;
  }
}

/** Test seams. */
function _resetRouterState() {
  state.consecutiveFailures = 0;
  state.fallbackUntil = 0;
  state.fallbackStartedAt = null;
  cached = null;
}
function _setBackoff(values) {
  backoffMs = values;
}

module.exports = {
  callAI,
  getAiConfig,
  clearAiConfigCache,
  fallbackState,
  extractJSON,
  isTransient,
  FALLBACK_AFTER_FAILURES,
  FALLBACK_DURATION_MS,
  _resetRouterState,
  _setBackoff,
  retryDelayMs,
};
