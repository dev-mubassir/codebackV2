/**
 * Admin AI Provider Controls & Usage Dashboard Routes
 *
 * Provides:
 * 1. Text generation provider controls (Groq / Gemini toggle, circuit breaker reset, live test)
 * 2. Groq operational health (circuit state, rate limits, latency metrics)
 * 3. AI Usage Tracking Dashboard APIs (summary, breakdowns, user stats, traces, CSV export)
 *
 * Security:
 * - Mounted behind requireAdmin middleware (admin-only)
 * - Metadata only: NEVER exposes or stores DM text or prompts
 * - DB aggregation only: Never loads entire table into memory
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const settings = require('../lib/settings');
const { createRateLimiter } = require('../lib/rateLimit');
const { recordAdminAudit } = require('../lib/adminAudit');
const groqTextGen = require('../lib/ai/groqTextGen');
const aiRouter = require('../lib/ai/router');
const { getUsdInrRate } = require('../lib/ai/aiPricing');

/**
 * CSV helpers with formula injection guard
 */
function csvCell(value) {
  let s = value instanceof Date ? value.toISOString() : String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
const csvRow = (cells) => `${cells.map(csvCell).join(',')}\n`;

function onlyFields(req, res, allowed) {
  const extra = Object.keys(req.body || {}).filter((k) => !allowed.includes(k));
  if (extra.length) {
    res.status(400).json({ error: 'Unexpected field in the request.', code: 'UNEXPECTED_FIELD' });
    return false;
  }
  return true;
}

/**
 * Resolve date bounds from query parameters (today / 7d / 30d / custom)
 */
function resolveDateRange(query) {
  const now = new Date();
  const range = query.range || '7d';

  if (range === 'today') {
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    return { from: startOfToday, to: now };
  }

  if (range === '7d') {
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from, to: now };
  }

  if (range === '30d') {
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from, to: now };
  }

  // Custom date range
  let from = query.from ? new Date(query.from) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let to = query.to ? new Date(query.to) : now;

  if (isNaN(from.getTime())) from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (isNaN(to.getTime())) to = now;

  return { from, to };
}

// ============================================
// 1. Text Generation Provider Controls
// ============================================

// GET /api/admin/text-gen/status
router.get('/text-gen/status', async (req, res) => {
  try {
    const stats = groqTextGen.getGroqTextGenStats();
    const effective = await groqTextGen.resolveTextProvider();
    res.json({
      ...stats,
      effectiveProvider: effective.provider,
      source: effective.source,
      killSwitchActive: (process.env.TEXT_PROVIDER_FORCE || '').trim().toLowerCase() === 'gemini',
    });
  } catch (error) {
    console.error('[Admin] Text-gen status error:', error.message);
    res.status(500).json({ error: "Couldn't load text generation status." });
  }
});

// POST /api/admin/text-gen/provider
router.post('/text-gen/provider', async (req, res) => {
  if (!onlyFields(req, res, ['provider', 'reason'])) return undefined;
  const rawProvider = req.body && req.body.provider;
  const provider = typeof rawProvider === 'string' ? rawProvider.trim().toLowerCase() : '';
  if (!['groq', 'gemini'].includes(provider)) {
    return res.status(400).json({ error: 'Provider must be "groq" or "gemini".', code: 'INVALID_PROVIDER' });
  }

  const rawReason = req.body && req.body.reason;
  const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, 500) : null;

  try {
    const before = await settings.getSetting('text_generation_provider');
    await settings.setSetting('text_generation_provider', provider, req.admin.id);
    groqTextGen.clearTextProviderOverrideCache();

    await recordAdminAudit(req, {
      action: 'TEXT_GEN_PROVIDER_SET',
      targetType: 'APP_SETTING',
      targetId: 'text_generation_provider',
      reason,
      before: { provider: before },
      after: { provider },
    });

    const stats = groqTextGen.getGroqTextGenStats();
    const effective = await groqTextGen.resolveTextProvider();
    res.json({
      success: true,
      provider,
      stats: {
        ...stats,
        effectiveProvider: effective.provider,
        source: effective.source,
      },
    });
  } catch (error) {
    console.error('[Admin] Set text-gen provider error:', error.message);
    res.status(500).json({ error: "Couldn't update text generation provider." });
  }
});

// POST /api/admin/text-gen/circuit-breaker/reset
router.post('/text-gen/circuit-breaker/reset', async (req, res) => {
  if (!onlyFields(req, res, ['reason'])) return undefined;
  const rawReason = req.body && req.body.reason;
  const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, 500) : 'Admin manual reset';

  try {
    groqTextGen._resetCircuitBreaker();

    await recordAdminAudit(req, {
      action: 'GROQ_CIRCUIT_BREAKER_RESET',
      targetType: 'CIRCUIT_BREAKER',
      targetId: 'groq',
      reason,
      before: { state: 'OPEN' },
      after: { state: 'CLOSED' },
    });

    const stats = groqTextGen.getGroqTextGenStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('[Admin] Reset Groq circuit breaker error:', error.message);
    res.status(500).json({ error: "Couldn't reset Groq circuit breaker." });
  }
});

const textGenTestLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 6,
  message: 'Rate limit: at most 6 text generation tests per minute.',
});

// POST /api/admin/text-gen/test
router.post('/text-gen/test', textGenTestLimiter, async (req, res) => {
  if (!onlyFields(req, res, [])) return undefined;

  const t0 = Date.now();
  const testPrompt = 'Say "Siffty AI is operational." in 5 words or fewer.';
  try {
    const fallbackFn = async () => {
      const result = await aiRouter.callAI({
        prompt: testPrompt,
        isJson: false,
        timeout: 10000,
        jobType: 'admin_test',
      });
      return {
        text: result.text,
        model: result.model,
        provider: result.provider,
        usage: result.usage,
      };
    };

    const out = await groqTextGen.generateTextWithGroqOrFallback({
      prompt: testPrompt,
      isJson: false,
      feature: 'other',
      fallbackFn,
    });

    res.json({
      success: true,
      provider: out.provider,
      model: out.model,
      text: out.text,
      isFallback: Boolean(out.isFallback),
      fallbackReason: out.fallbackReason || null,
      latencyMs: Date.now() - t0,
    });
  } catch (error) {
    console.error('[Admin] Text-gen test error:', error.message);
    res.status(500).json({ error: "Couldn't complete text generation test.", message: error.message });
  }
});

// ============================================
// 2. AI Usage Tracking Dashboard APIs
// ============================================

// Build where clause from filters
function buildWhereClause(query) {
  const { from, to } = resolveDateRange(query);
  const where = {
    createdAt: {
      gte: from,
      lte: to,
    },
  };

  if (query.feature && query.feature !== 'all') {
    where.feature = query.feature;
  }
  if (query.provider && query.provider !== 'all') {
    where.provider = query.provider.toLowerCase();
  }
  if (query.status && query.status !== 'all') {
    where.status = query.status;
  }
  if (query.fallback === 'true') {
    where.isFallback = true;
  } else if (query.fallback === 'false') {
    where.isFallback = false;
  }

  return { where, from, to };
}

// GET /api/admin/ai/usage/summary
router.get('/ai/usage/summary', async (req, res) => {
  try {
    const { where, from, to } = buildWhereClause(req.query);

    const [agg, fallbacksCount, errorsCount, p95Result] = await Promise.all([
      prisma.aiUsageLog.aggregate({
        where,
        _count: { id: true },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          reasoningTokens: true,
          cachedTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          latencyMs: true,
        },
        _avg: {
          latencyMs: true,
        },
      }),
      prisma.aiUsageLog.count({
        where: { ...where, isFallback: true },
      }),
      prisma.aiUsageLog.count({
        where: { ...where, status: { not: 'success' } },
      }),
      // PostgreSQL percentile calculation
      prisma.$queryRaw`
        SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
        FROM ai_usage_logs
        WHERE created_at >= ${from} AND created_at <= ${to}
      `.catch(() => [{ p95: null }]),
    ]);

    const totalRequests = agg._count?.id || 0;
    const fallbackRate = totalRequests > 0 ? (fallbacksCount / totalRequests) * 100 : 0;
    const errorRate = totalRequests > 0 ? (errorsCount / totalRequests) * 100 : 0;
    const p95LatencyMs = p95Result?.[0]?.p95 != null ? Math.round(Number(p95Result[0].p95)) : null;

    const usdInrRate = getUsdInrRate();
    const totalCostUsd = agg._sum?.estimatedCostUsd || 0;
    const totalCostInr = totalCostUsd * usdInrRate;

    res.json({
      period: { from: from.toISOString(), to: to.toISOString() },
      requests: totalRequests,
      tokens: {
        total: agg._sum?.totalTokens || 0,
        prompt: agg._sum?.promptTokens || 0,
        completion: agg._sum?.completionTokens || 0,
        reasoning: agg._sum?.reasoningTokens || 0,
        cached: agg._sum?.cachedTokens || 0,
      },
      cost: {
        usd: totalCostUsd,
        inr: totalCostInr,
        usdInrRate,
      },
      fallbacks: {
        count: fallbacksCount,
        rate: Number(fallbackRate.toFixed(1)),
      },
      errors: {
        count: errorsCount,
        rate: Number(errorRate.toFixed(1)),
      },
      latency: {
        avg: agg._avg?.latencyMs ? Math.round(agg._avg.latencyMs) : null,
        p95: p95LatencyMs,
      },
    });
  } catch (error) {
    console.error('[Admin] AI usage summary error:', error.message);
    res.status(500).json({ error: "Couldn't load AI usage summary." });
  }
});

// GET /api/admin/ai/usage/breakdown
router.get('/ai/usage/breakdown', async (req, res) => {
  try {
    const { where, from, to } = buildWhereClause(req.query);

    const [byModel, byFeature, dailyRaw] = await Promise.all([
      prisma.aiUsageLog.groupBy({
        by: ['provider', 'model'],
        where,
        _count: { id: true },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          reasoningTokens: true,
          cachedTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
        },
        _avg: { latencyMs: true },
      }),
      prisma.aiUsageLog.groupBy({
        by: ['feature'],
        where,
        _count: { id: true },
        _sum: {
          totalTokens: true,
          estimatedCostUsd: true,
        },
        _avg: { latencyMs: true },
      }),
      // Daily aggregates for chart
      prisma.$queryRaw`
        SELECT 
          DATE(created_at) as day,
          COUNT(*)::int as requests,
          COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
          COALESCE(SUM(estimated_cost_usd), 0)::float as cost_usd,
          COUNT(CASE WHEN is_fallback THEN 1 END)::int as fallbacks,
          COUNT(CASE WHEN status != 'success' THEN 1 END)::int as errors
        FROM ai_usage_logs
        WHERE created_at >= ${from} AND created_at <= ${to}
        GROUP BY DATE(created_at)
        ORDER BY day ASC
      `.catch((err) => {
        console.error('[Admin] Daily aggregate query failed:', err.message);
        return [];
      }),
    ]);

    // Format models breakdown
    const models = byModel.map((m) => ({
      provider: m.provider,
      model: m.model,
      requests: m._count.id,
      promptTokens: m._sum.promptTokens || 0,
      completionTokens: m._sum.completionTokens || 0,
      reasoningTokens: m._sum.reasoningTokens || 0,
      cachedTokens: m._sum.cachedTokens || 0,
      totalTokens: m._sum.totalTokens || 0,
      costUsd: m._sum.estimatedCostUsd || 0,
      avgLatencyMs: m._avg.latencyMs ? Math.round(m._avg.latencyMs) : null,
    }));

    // Format feature breakdown
    const features = byFeature.map((f) => ({
      feature: f.feature,
      requests: f._count.id,
      totalTokens: f._sum.totalTokens || 0,
      costUsd: f._sum.estimatedCostUsd || 0,
      avgLatencyMs: f._avg.latencyMs ? Math.round(f._avg.latencyMs) : null,
    }));

    // Format daily timeline
    const daily = (dailyRaw || []).map((d) => ({
      date: d.day instanceof Date ? d.day.toISOString().slice(0, 10) : String(d.day),
      requests: Number(d.requests || 0),
      totalTokens: Number(d.total_tokens || 0),
      costUsd: Number(d.cost_usd || 0),
      fallbacks: Number(d.fallbacks || 0),
      errors: Number(d.errors || 0),
    }));

    res.json({ models, features, daily });
  } catch (error) {
    console.error('[Admin] AI usage breakdown error:', error.message);
    res.status(500).json({ error: "Couldn't load AI usage breakdown." });
  }
});

// GET /api/admin/ai/usage/users
router.get('/ai/usage/users', async (req, res) => {
  try {
    const { from, to } = resolveDateRange(req.query);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * limit;

    const sortField = req.query.sort || 'cost';
    let orderBySql = 'cost_usd DESC';
    if (sortField === 'requests') orderBySql = 'requests DESC';
    if (sortField === 'tokens') orderBySql = 'total_tokens DESC';

    const userAggregates = await prisma.$queryRawUnsafe(`
      SELECT 
        user_id,
        COUNT(*)::int as requests,
        COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
        COALESCE(SUM(estimated_cost_usd), 0)::float as cost_usd,
        MAX(created_at) as last_used_at
      FROM ai_usage_logs
      WHERE created_at >= $1 AND created_at <= $2 AND user_id IS NOT NULL
      GROUP BY user_id
      ORDER BY ${orderBySql}
      LIMIT $3 OFFSET $4
    `, from, to, limit, offset);

    const userIds = userAggregates.map((u) => u.user_id).filter(Boolean);

    // Fetch user details & plan info
    const [users, entitlements] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      }),
      prisma.entitlement.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, planCode: true, status: true },
      }),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const entMap = new Map(entitlements.map((e) => [e.userId, e]));

    const rows = userAggregates.map((row) => {
      const u = userMap.get(row.user_id);
      const e = entMap.get(row.user_id);
      return {
        userId: row.user_id,
        email: u?.email || 'unknown',
        name: u?.name || null,
        plan: e?.planCode || 'NONE',
        status: e?.status || 'INACTIVE',
        requests: Number(row.requests),
        totalTokens: Number(row.total_tokens),
        costUsd: Number(row.cost_usd),
        lastUsedAt: row.last_used_at instanceof Date ? row.last_used_at.toISOString() : row.last_used_at,
      };
    });

    res.json({ users: rows, page, limit });
  } catch (error) {
    console.error('[Admin] AI usage users error:', error.message);
    res.status(500).json({ error: "Couldn't load user usage breakdown." });
  }
});

// GET /api/admin/ai/usage/traces
router.get('/ai/usage/traces', async (req, res) => {
  try {
    const { where } = buildWhereClause(req.query);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      prisma.aiUsageLog.count({ where }),
      prisma.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          createdAt: true,
          userId: true,
          tenantId: true,
          feature: true,
          provider: true,
          model: true,
          attemptNo: true,
          isFallback: true,
          fallbackReason: true,
          status: true,
          httpStatus: true,
          latencyMs: true,
          promptTokens: true,
          completionTokens: true,
          reasoningTokens: true,
          cachedTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          providerRequestId: true,
          errorMessage: true,
          conversationId: true,
          messageId: true,
        },
      }),
    ]);

    // Attach user emails for readability
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.email]));

    const traces = rows.map((r) => ({
      ...r,
      userEmail: r.userId ? userMap.get(r.userId) || null : null,
    }));

    res.json({
      traces,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Admin] AI usage traces error:', error.message);
    res.status(500).json({ error: "Couldn't load AI usage traces." });
  }
});

// GET /api/admin/ai/usage/export
router.get('/ai/usage/export', async (req, res) => {
  try {
    const { where } = buildWhereClause(req.query);
    const maxRows = 5000;

    const rows = await prisma.aiUsageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: maxRows,
      select: {
        id: true,
        createdAt: true,
        userId: true,
        tenantId: true,
        feature: true,
        provider: true,
        model: true,
        attemptNo: true,
        isFallback: true,
        fallbackReason: true,
        status: true,
        httpStatus: true,
        latencyMs: true,
        promptTokens: true,
        completionTokens: true,
        reasoningTokens: true,
        cachedTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
        providerRequestId: true,
        errorMessage: true,
        conversationId: true,
        messageId: true,
      },
    });

    const filename = `ai-usage-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const headers = [
      'id',
      'created_at',
      'user_id',
      'tenant_id',
      'feature',
      'provider',
      'model',
      'attempt_no',
      'is_fallback',
      'fallback_reason',
      'status',
      'http_status',
      'latency_ms',
      'prompt_tokens',
      'completion_tokens',
      'reasoning_tokens',
      'cached_tokens',
      'total_tokens',
      'estimated_cost_usd',
      'provider_request_id',
      'error_message',
      'conversation_id',
      'message_id',
    ];

    res.write(csvRow(headers));

    for (const r of rows) {
      res.write(
        csvRow([
          r.id,
          r.createdAt,
          r.userId,
          r.tenantId,
          r.feature,
          r.provider,
          r.model,
          r.attemptNo,
          r.isFallback,
          r.fallbackReason,
          r.status,
          r.httpStatus,
          r.latencyMs,
          r.promptTokens,
          r.completionTokens,
          r.reasoningTokens,
          r.cachedTokens,
          r.totalTokens,
          r.estimatedCostUsd,
          r.providerRequestId,
          r.errorMessage,
          r.conversationId,
          r.messageId,
        ])
      );
    }

    res.end();
  } catch (error) {
    console.error('[Admin] AI usage export error:', error.message);
    res.status(500).json({ error: "Couldn't export AI usage data." });
  }
});

module.exports = router;

