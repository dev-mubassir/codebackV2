/**
 * AI call logging (ai_call_logs) and the stats the admin health page reads.
 *
 * One row per provider HTTP call — including a model fallback inside one
 * provider and a provider failover — because each one is a separate cost and
 * a separate latency. Written fire-and-forget: logging must never slow or
 * fail the AI path it describes.
 *
 * METADATA ONLY. Nothing here ever sees the prompt, the customer's message,
 * or the model's answer; errorCode is a provider status / network code
 * reduced to a safe token, never an error message (Gemini's key travels in
 * the URL, and an axios error message can carry it).
 */

const prisma = require('../prisma');
const { estimateCost } = require('./models');

/** A provider/network error reduced to a short, safe code. */
function errorCodeOf(err) {
  const raw =
    err?.response?.data?.error?.status || // Gemini: RESOURCE_EXHAUSTED, INVALID_ARGUMENT…
    err?.response?.data?.error?.code || // OpenAI: rate_limit_exceeded…
    err?.response?.data?.error?.type ||
    err?.code || // ECONNABORTED, ETIMEDOUT…
    err?.aiErrorCode || // our own: EMPTY_RESPONSE, UNPARSEABLE
    'ERROR';
  const safe = String(raw).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
  return safe || 'ERROR';
}

function recordAiCall({ provider, model, jobType, tenantId, latencyMs, success, error, inputTokens, outputTokens }) {
  const data = {
    provider,
    model,
    jobType: jobType || 'unknown',
    tenantId: tenantId || null,
    latencyMs: Math.max(0, Math.round(latencyMs || 0)),
    success: Boolean(success),
    errorCode: success ? null : errorCodeOf(error),
    httpStatus: error?.response?.status ?? null,
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
  };
  data.estimatedCost = estimateCost(provider, model, data.inputTokens, data.outputTokens);
  return prisma.aiCallLog.create({ data }).catch((err) => {
    console.error('[AiCallLog] Could not record an AI call:', err.message);
  });
}

function p95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
}

/** calls, error rate, p95 latency and estimated cost since `since`. */
async function aiStatsSince(since) {
  const rows = await prisma.aiCallLog.findMany({
    where: { createdAt: { gte: since } },
    select: { success: true, latencyMs: true, estimatedCost: true },
  });
  const calls = rows.length;
  const failures = rows.filter((r) => !r.success).length;
  return {
    calls,
    failures,
    errorRate: calls ? failures / calls : 0,
    p95LatencyMs: p95(rows.map((r) => r.latencyMs)),
    estimatedCostUsd: rows.reduce((sum, r) => sum + (r.estimatedCost || 0), 0),
  };
}

module.exports = { recordAiCall, aiStatsSince, errorCodeOf, p95 };
