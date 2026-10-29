/**
 * Centralized AI Usage Tracking Logger (AiUsageLog)
 *
 * FIRE-AND-FORGET: A logging failure must never break or delay AI generation.
 * PRIVACY CONTRACT: NEVER stores DM text, prompts, responses, or API keys.
 * Metadata only (tokens, latency, model, user, feature, cost, errors).
 *
 * HARDENED: Fails open if `ai_usage_logs` table does not exist yet. Warns once,
 * buffers up to 100 entries in memory, and never throws or blocks customer responses.
 */

const prisma = require('../prisma');
const { estimateCostUsd } = require('./aiPricing');

let hasWarnedTableMissing = false;
const memoryBuffer = [];
const MAX_MEMORY_BUFFER = 100;

function isTableMissingError(err) {
  if (!err) return false;
  return (
    err.code === 'P2021' ||
    err.code === '42P01' ||
    /relation .*ai_usage_logs.* does not exist/i.test(err.message || '') ||
    /table .*ai_usage_logs.* does not exist/i.test(err.message || '')
  );
}

/**
 * Truncate error message safely to avoid huge payloads and prevent leaking sensitive data.
 */
function sanitizeErrorMessage(err) {
  if (!err) return null;
  const msg = typeof err === 'string' ? err : err.message || String(err);
  // Redact potential api keys or tokens in error message
  const cleaned = msg.replace(/(?:key|token|bearer|authorization)=?[\s:"]*[a-zA-Z0-9_\-\.]{10,}/gi, '[REDACTED_SECRET]');
  return cleaned.slice(0, 500);
}

/**
 * Normalise status to: success | error | timeout | rate_limited | empty
 */
function normalizeStatus({ status, httpStatus, error }) {
  if (status) return status;
  if (!error) return 'success';
  if (httpStatus === 429 || error.status === 429 || error.code === 'RATE_LIMITED') return 'rate_limited';
  if (
    error.name === 'AbortError' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ECONNABORTED' ||
    /timeout/i.test(error.message || '')
  ) {
    return 'timeout';
  }
  if (error.aiErrorCode === 'EMPTY_RESPONSE' || error.code === 'EMPTY_RESPONSE') return 'empty';
  return 'error';
}

/**
 * Record an AI usage event into `ai_usage_logs` asynchronously (fire-and-forget).
 *
 * @param {object} params
 * @param {string} [params.userId]
 * @param {string} [params.tenantId]
 * @param {string} params.feature - auto_reply | draft_reply | summary | classification | other
 * @param {string} params.provider - groq | gemini | cloudflare | openai | anthropic
 * @param {string} params.model
 * @param {number} [params.attemptNo=1]
 * @param {boolean} [params.isFallback=false]
 * @param {string} [params.fallbackReason]
 * @param {string} [params.status] - success | error | timeout | rate_limited | empty
 * @param {number} [params.httpStatus]
 * @param {number} params.latencyMs
 * @param {number} [params.promptTokens]
 * @param {number} [params.completionTokens]
 * @param {number} [params.reasoningTokens]
 * @param {number} [params.cachedTokens]
 * @param {number} [params.totalTokens]
 * @param {number} [params.estimatedCostUsd]
 * @param {string} [params.providerRequestId]
 * @param {Error|string} [params.error]
 * @param {string} [params.errorMessage]
 * @param {string} [params.conversationId]
 * @param {string} [params.messageId]
 */
function logAiUsage(params) {
  try {
    const promptTokens = Number.isFinite(params.promptTokens) ? Math.max(0, Math.round(params.promptTokens)) : null;
    const completionTokens = Number.isFinite(params.completionTokens) ? Math.max(0, Math.round(params.completionTokens)) : null;
    const reasoningTokens = Number.isFinite(params.reasoningTokens) ? Math.max(0, Math.round(params.reasoningTokens)) : null;
    const cachedTokens = Number.isFinite(params.cachedTokens) ? Math.max(0, Math.round(params.cachedTokens)) : null;
    
    let totalTokens = Number.isFinite(params.totalTokens) ? Math.max(0, Math.round(params.totalTokens)) : null;
    if (totalTokens == null && (promptTokens != null || completionTokens != null)) {
      totalTokens = (promptTokens || 0) + (completionTokens || 0);
    }

    const estimatedCostUsd = params.estimatedCostUsd !== undefined
      ? params.estimatedCostUsd
      : estimateCostUsd({
          provider: params.provider,
          model: params.model,
          promptTokens,
          completionTokens,
          cachedTokens,
        });

    const status = normalizeStatus({
      status: params.status,
      httpStatus: params.httpStatus,
      error: params.error,
    });

    const errorMessage = params.errorMessage || (params.error ? sanitizeErrorMessage(params.error) : null);

    const rawHttpStatus = params.httpStatus ?? (params.error?.status || params.error?.response?.status || null);
    const safeHttpStatus = typeof rawHttpStatus === 'number' && Number.isInteger(rawHttpStatus) ? rawHttpStatus : null;

    const data = {
      userId: params.userId || null,
      tenantId: params.tenantId || null,
      feature: params.feature || 'other',
      provider: (params.provider || 'unknown').toLowerCase(),
      model: params.model || 'unknown',
      attemptNo: params.attemptNo || 1,
      isFallback: Boolean(params.isFallback),
      fallbackReason: params.fallbackReason || null,
      status,
      httpStatus: safeHttpStatus,
      latencyMs: Math.max(0, Math.round(params.latencyMs || 0)),
      promptTokens,
      completionTokens,
      reasoningTokens,
      cachedTokens,
      totalTokens,
      estimatedCostUsd,
      providerRequestId: params.providerRequestId || null,
      errorMessage,
      conversationId: params.conversationId || null,
      messageId: params.messageId || null,
    };

    // Non-blocking fire-and-forget write to DB
    prisma.aiUsageLog.create({ data }).then(() => {
      // If write succeeded and we have buffered rows, flush them!
      if (memoryBuffer.length > 0) {
        const toFlush = memoryBuffer.splice(0, memoryBuffer.length);
        prisma.aiUsageLog.createMany({ data: toFlush }).catch(() => {});
      }
    }).catch((err) => {
      if (isTableMissingError(err)) {
        if (!hasWarnedTableMissing) {
          console.warn('[AiUsageLog] Table "ai_usage_logs" does not exist in the database yet. Migration is pending; buffering logs in memory until table is created.');
          hasWarnedTableMissing = true;
        }
        if (memoryBuffer.length < MAX_MEMORY_BUFFER) {
          memoryBuffer.push(data);
        }
        return;
      }
      console.error('[AiUsageLog] Non-blocking write failed:', err.message);
    });
  } catch (err) {
    console.error('[AiUsageLog] Error preparing log entry:', err.message);
  }
}

function _getMemoryBuffer() {
  return [...memoryBuffer];
}

function _clearMemoryBuffer() {
  memoryBuffer.length = 0;
}

function _resetWarnedTableMissing() {
  hasWarnedTableMissing = false;
}

module.exports = {
  logAiUsage,
  sanitizeErrorMessage,
  normalizeStatus,
  isTableMissingError,
  _getMemoryBuffer,
  _clearMemoryBuffer,
  _resetWarnedTableMissing,
};
