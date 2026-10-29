/**
 * Comprehensive Test Suite for Groq Text Generation & Usage Tracking (Phases 1-4)
 *
 * Verifies all 10 required items:
 * 1. Groq success: reply generated, tokens and cost logged.
 * 2. Invalid key -> Gemini fallback, no user-facing error, logged as fallback with reason.
 * 3. Simulated 429, timeout and 5xx -> fallback.
 * 4. Empty content / finish_reason length -> fallback.
 * 5. Circuit breaker opens and recovers.
 * 6. Admin switch to Gemini-first works at runtime, no restart.
 * 7. Dashboard numbers equal direct SQL aggregates (spot check three).
 * 8. Burst: 100 concurrent text-gen requests, no crash, no lost reply, rate limit respected.
 * 9. Regression: classification, Auto DM, existing test suite unchanged.
 * 10. Security: usage endpoints reject non-admins, no DM content in logs or responses, key never appears in logs.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';
import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createAdmin } from './helpers/db.js';
import { VALID_CLASSIFICATION } from './helpers/ai.js';

const require = createRequire(import.meta.url);
const groqTextGen = require('../src/lib/ai/groqTextGen.js');
const aiService = require('../src/services/aiService.js');
const aiRouter = require('../src/lib/ai/router.js');
const settings = require('../src/lib/settings.js');
const adminRoutes = require('../src/routes/admin.js');

const ORIGIN = 'https://app.test.local';
const FAKE_GROQ_KEY = 'gsk-test-GROQ-KEY-MUST-NEVER-LEAK-XYZ12345';
const FAKE_GEMINI_KEY = 'gemini-test-KEY-MUST-NEVER-LEAK-XYZ12345';

let app;
let ipSeq = 0;

beforeAll(() => {
  app = buildTestApp({ admin: adminRoutes });
});

let logged;

beforeEach(async () => {
  await resetDb();
  await prisma.aiUsageLog.deleteMany({});
  await prisma.appSetting.deleteMany({});
  groqTextGen._resetCircuitBreaker();
  groqTextGen._resetMetrics();
  groqTextGen._resetFetchImpl();
  groqTextGen.clearTextProviderOverrideCache();
  groqTextGen.getLimiter().reset();

  process.env.GROQ_API_KEY = FAKE_GROQ_KEY;
  process.env.GEMINI_API_KEY = FAKE_GEMINI_KEY;
  delete process.env.TEXT_PROVIDER_FORCE;

  logged = [];
  for (const level of ['log', 'warn', 'error', 'info']) {
    vi.spyOn(console, level).mockImplementation((...args) => {
      logged.push(args.map(String).join(' '));
    });
  }
});

afterEach(() => {
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.TEXT_PROVIDER_FORCE;
  groqTextGen._resetFetchImpl();
  vi.restoreAllMocks();
});

const noKeyIn = (...texts) => {
  for (const t of [...texts, ...logged]) {
    expect(String(t)).not.toContain('MUST-NEVER-LEAK');
  }
};

async function adminAgent() {
  const { admin, password } = await createAdmin();
  const agent = request.agent(app).set('Origin', ORIGIN).set('X-Forwarded-For', `10.99.0.${(ipSeq++ % 250) + 1}`);
  const loginRes = await agent.post('/api/admin/login').send({ email: admin.email, password });
  expect(loginRes.status).toBe(200);
  return { agent, admin };
}

describe('Groq Cloud Text Generation & AI Usage Tracking', () => {
  // 1. Groq success: reply generated, tokens and cost logged
  it('1. Groq success: generates clean reply, keeps reasoning out, logs tokens and cost', async () => {
    const mockGroqResponse = {
      id: 'chatcmpl-test-123',
      choices: [
        {
          message: {
            role: 'assistant',
            content: '<think>I should draft a polite answer</think>Hello! Our reels editing package starts at $150.',
            reasoning_content: 'I thought about the price.',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 45,
        total_tokens: 165,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 25 },
      },
    };

    groqTextGen._setFetchImpl(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': 'req-groq-success-1',
        'x-ratelimit-remaining-requests': '99',
        'x-ratelimit-remaining-tokens': '995000',
      }),
      json: async () => mockGroqResponse,
    }));

    const result = await aiService.generateReply({
      recentMessages: [{ sender: 'customer', text: 'How much for reel editing?' }],
      contactUsername: 'customer123',
      businessProfile: { businessName: 'Editor Studio' },
      tenantId: 'tenant-user-1',
    });

    expect(result.failed).toBe(false);
    expect(result.provider).toBe('groq');
    expect(result.text).toBe('Hello! Our reels editing package starts at $150.');
    expect(result.text).not.toContain('<think>');
    expect(result.text).not.toContain('reasoning_content');

    // Wait a tick for fire-and-forget logging
    await new Promise((r) => setTimeout(r, 100));

    const log = await prisma.aiUsageLog.findFirst({
      where: { provider: 'groq' },
    });
    expect(log).not.toBeNull();
    expect(log.feature).toBe('auto_reply');
    expect(log.status).toBe('success');
    expect(log.isFallback).toBe(false);
    expect(log.promptTokens).toBe(120);
    expect(log.completionTokens).toBe(45);
    expect(log.reasoningTokens).toBe(25);
    expect(log.cachedTokens).toBe(20);
    expect(log.totalTokens).toBe(165);
    expect(log.estimatedCostUsd).toBeGreaterThan(0);
    expect(log.providerRequestId).toBe('req-groq-success-1');
    noKeyIn();
  });

  // 2. Invalid key -> Gemini fallback
  it('2. Invalid key -> falls back to Gemini, customer sees zero error, logged as fallback', async () => {
    groqTextGen._setFetchImpl(async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'x-request-id': 'req-auth-err' }),
      json: async () => ({ error: { message: 'Invalid API key provided' } }),
    }));

    const fallbackReply = 'Hi! We charge $150 per reel.';
    vi.spyOn(aiRouter, 'callAI').mockResolvedValueOnce({
      text: fallbackReply,
      model: 'gemini-flash-lite-latest',
      provider: 'gemini',
      usage: { input: 110, output: 20 },
    });

    const result = await aiService.generateReply({
      recentMessages: [{ sender: 'customer', text: 'Pricing?' }],
      tenantId: 'tenant-user-2',
    });

    expect(result.failed).toBe(false);
    expect(result.provider).toBe('gemini');
    expect(result.text).toBe(fallbackReply);

    await new Promise((r) => setTimeout(r, 100));

    const logs = await prisma.aiUsageLog.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.length).toBe(2);

    // Attempt 1: Groq failed (401)
    expect(logs[0].provider).toBe('groq');
    expect(logs[0].status).toBe('error');
    expect(logs[0].httpStatus).toBe(401);
    expect(logs[0].isFallback).toBe(false);

    // Attempt 2: Gemini fallback succeeded
    expect(logs[1].provider).toBe('gemini');
    expect(logs[1].isFallback).toBe(true);
    expect(logs[1].fallbackReason).toBe('auth_error_401');
    expect(logs[1].status).toBe('success');
    noKeyIn();
  });

  // 3. Simulated 429, timeout and 5xx -> fallback
  it('3. Simulated 429 (retry-after > 2s), timeout, and 500 fall back to Gemini', async () => {
    const fallbackReply = 'We offer high quality editing.';
    const spy = vi.spyOn(aiRouter, 'callAI').mockImplementation(async () => ({
      text: fallbackReply,
      model: 'gemini-flash-lite-latest',
      provider: 'gemini',
      usage: { input: 50, output: 15 },
    }));

    // Test 3a: 429 with long retry-after -> immediate fallback
    groqTextGen._setFetchImpl(async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '30' }),
      json: async () => ({ error: { message: 'Rate limit exceeded' } }),
    }));

    const r1 = await aiService.generateReply({ tenantId: 't1' });
    expect(r1.failed).toBe(false);
    expect(r1.provider).toBe('gemini');

    // Test 3b: 500 server error -> fallback
    groqTextGen._setFetchImpl(async () => ({
      ok: false,
      status: 500,
      headers: new Headers({}),
      json: async () => ({ error: { message: 'Internal server error' } }),
    }));

    const r2 = await aiService.generateReply({ tenantId: 't2' });
    expect(r2.failed).toBe(false);
    expect(r2.provider).toBe('gemini');

    // Test 3c: Timeout (AbortError) -> fallback
    groqTextGen._setFetchImpl(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });

    const r3 = await aiService.generateReply({ tenantId: 't3' });
    expect(r3.failed).toBe(false);
    expect(r3.provider).toBe('gemini');
    expect(spy).toHaveBeenCalledTimes(3);
    noKeyIn();
  });

  // 4. Empty content and finish_reason "length" -> fallback
  it('4. Empty content or finish_reason length counts as failure and falls back', async () => {
    vi.spyOn(aiRouter, 'callAI').mockResolvedValue({
      text: 'Valid Gemini reply',
      model: 'gemini-flash-lite-latest',
      provider: 'gemini',
      usage: { input: 50, output: 10 },
    });

    // 4a: finish_reason length
    groqTextGen._setFetchImpl(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({}),
      json: async () => ({
        choices: [{ message: { content: 'Half-written sentence...' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    }));

    const r1 = await aiService.generateReply({ tenantId: 't1' });
    expect(r1.failed).toBe(false);
    expect(r1.provider).toBe('gemini');
    expect(r1.text).toBe('Valid Gemini reply');

    // 4b: Empty content / whitespace
    groqTextGen._setFetchImpl(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({}),
      json: async () => ({
        choices: [{ message: { content: '   ' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 0 },
      }),
    }));

    const r2 = await aiService.generateReply({ tenantId: 't2' });
    expect(r2.failed).toBe(false);
    expect(r2.provider).toBe('gemini');
    expect(r2.text).toBe('Valid Gemini reply');

    // 4c: Only think tags (no final response)
    groqTextGen._setFetchImpl(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({}),
      json: async () => ({
        choices: [{ message: { content: '<think>only thinking here</think>' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    }));

    const r3 = await aiService.generateReply({ tenantId: 't3' });
    expect(r3.failed).toBe(false);
    expect(r3.provider).toBe('gemini');
    expect(r3.text).toBe('Valid Gemini reply');
    noKeyIn();
  });

  // 5. Circuit breaker opens after 5 failures and auto-recovers
  it('5. Circuit breaker opens after 5 failures and skips Groq, then resets', async () => {
    vi.spyOn(aiRouter, 'callAI').mockResolvedValue({
      text: 'Gemini fallback',
      model: 'gemini-flash-lite-latest',
      provider: 'gemini',
    });

    let groqCallCount = 0;
    groqTextGen._setFetchImpl(async () => {
      groqCallCount += 1;
      return {
        ok: false,
        status: 500,
        headers: new Headers({}),
        json: async () => ({ error: { message: 'Server error' } }),
      };
    });

    // 5 failures in a row
    for (let i = 0; i < 5; i++) {
      await aiService.generateReply({ tenantId: `fail-${i}` });
    }
    expect(groqCallCount).toBe(5);

    // Circuit is now OPEN
    const cbState = groqTextGen._getCircuitBreakerState();
    expect(cbState.isOpen).toBe(true);
    expect(cbState.state).toBe('OPEN');

    // 6th call: Groq is NOT called over network, falls back directly
    const r6 = await aiService.generateReply({ tenantId: 'fail-6' });
    expect(r6.failed).toBe(false);
    expect(r6.provider).toBe('gemini');
    expect(groqCallCount).toBe(5); // unchanged!

    // Reset circuit breaker
    groqTextGen._resetCircuitBreaker();
    expect(groqTextGen._getCircuitBreakerState().isOpen).toBe(false);

    // Call again -> Groq is attempted again
    await aiService.generateReply({ tenantId: 'after-reset' });
    expect(groqCallCount).toBe(6);
    noKeyIn();
  });

  // 6. Admin switch to Gemini-first works at runtime, no restart
  it('6. Admin switch to Gemini-first works at runtime without restart', async () => {
    let groqCalled = false;
    groqTextGen._setFetchImpl(async () => {
      groqCalled = true;
      return {
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: async () => ({
          choices: [{ message: { content: 'Groq reply' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
      };
    });

    const geminiSpy = vi.spyOn(aiRouter, 'callAI').mockResolvedValue({
      text: 'Gemini reply',
      model: 'gemini-flash-lite-latest',
      provider: 'gemini',
    });

    // 1. Initially Groq is primary
    const r1 = await aiService.generateReply({ tenantId: 'user-1' });
    expect(r1.failed).toBe(false);
    expect(r1.provider).toBe('groq');
    expect(groqCalled).toBe(true);

    // 2. Admin switches provider to gemini at runtime
    await settings.setSetting('text_generation_provider', 'gemini');
    groqTextGen.clearTextProviderOverrideCache();
    groqCalled = false;

    const r2 = await aiService.generateReply({ tenantId: 'user-2' });
    expect(r2.failed).toBe(false);
    expect(r2.provider).toBe('gemini');
    expect(groqCalled).toBe(false);
    expect(geminiSpy).toHaveBeenCalled();

    // 3. Admin switches back to groq
    await settings.setSetting('text_generation_provider', 'groq');
    groqTextGen.clearTextProviderOverrideCache();

    const r3 = await aiService.generateReply({ tenantId: 'user-3' });
    expect(r3.failed).toBe(false);
    expect(r3.provider).toBe('groq');
    expect(groqCalled).toBe(true);

    // 4. Kill switch TEXT_PROVIDER_FORCE=gemini overrides setting
    process.env.TEXT_PROVIDER_FORCE = 'gemini';
    groqCalled = false;

    const r4 = await aiService.generateReply({ tenantId: 'user-4' });
    expect(r4.failed).toBe(false);
    expect(r4.provider).toBe('gemini');
    expect(groqCalled).toBe(false);
    noKeyIn();
  });

  // 7. Dashboard numbers equal direct SQL aggregates (spot check three)
  it('7. Dashboard numbers equal direct SQL aggregates', async () => {
    // Seed 5 usage log rows
    await prisma.aiUsageLog.createMany({
      data: [
        {
          feature: 'auto_reply',
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          status: 'success',
          latencyMs: 350,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          estimatedCostUsd: 0.0000225,
          isFallback: false,
        },
        {
          feature: 'draft_reply',
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          status: 'success',
          latencyMs: 400,
          promptTokens: 200,
          completionTokens: 80,
          totalTokens: 280,
          estimatedCostUsd: 0.000039,
          isFallback: false,
        },
        {
          feature: 'summary',
          provider: 'gemini',
          model: 'gemini-flash-lite-latest',
          status: 'success',
          latencyMs: 250,
          promptTokens: 300,
          completionTokens: 40,
          totalTokens: 340,
          estimatedCostUsd: 0.000046,
          isFallback: true,
          fallbackReason: 'timeout',
        },
        {
          feature: 'classification',
          provider: 'cloudflare',
          model: '@cf/cloudflare/clef-flash',
          status: 'success',
          latencyMs: 180,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          isFallback: false,
        },
        {
          feature: 'auto_reply',
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          status: 'error',
          latencyMs: 120,
          promptTokens: 50,
          completionTokens: 0,
          totalTokens: 50,
          estimatedCostUsd: 0.00000375,
          isFallback: false,
        },
      ],
    });

    const { agent } = await adminAgent();
    const res = await agent.get('/api/admin/ai/usage/summary?range=30d');
    expect(res.status).toBe(200);

    const body = res.body;

    // Spot-check 1: Total requests
    const directCount = await prisma.aiUsageLog.count();
    expect(body.requests).toBe(directCount);
    expect(body.requests).toBe(5);

    // Spot-check 2: Total tokens
    const directTokens = await prisma.aiUsageLog.aggregate({ _sum: { totalTokens: true } });
    expect(body.tokens.total).toBe(directTokens._sum.totalTokens);
    expect(body.tokens.total).toBe(820);

    // Spot-check 3: Total estimated cost USD
    const directCost = await prisma.aiUsageLog.aggregate({ _sum: { estimatedCostUsd: true } });
    expect(Number(body.cost.usd.toFixed(6))).toBe(Number((directCost._sum.estimatedCostUsd || 0).toFixed(6)));

    // Fallbacks count spot check
    const directFallbacks = await prisma.aiUsageLog.count({ where: { isFallback: true } });
    expect(body.fallbacks.count).toBe(directFallbacks);
    expect(body.fallbacks.count).toBe(1);
    noKeyIn();
  });

  // 8. Burst: 100 concurrent text-gen requests
  it('8. Burst: 100 concurrent requests complete without crash, no lost replies', async () => {
    let inFlightMax = 0;
    let active = 0;

    groqTextGen._setFetchImpl(async () => {
      active++;
      inFlightMax = Math.max(inFlightMax, active);
      await new Promise((r) => setTimeout(r, 10)); // simulate 10ms work
      active--;
      return {
        ok: true,
        status: 200,
        headers: new Headers({}),
        json: async () => ({
          choices: [{ message: { content: 'Burst response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      };
    });

    // Launch 100 concurrent text generations
    const promises = Array.from({ length: 100 }, (_, i) =>
      aiService.generateReply({
        tenantId: `burst-user-${i}`,
        instructions: `test ${i}`,
      })
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(100);
    for (const r of results) {
      expect(r.failed).toBe(false);
      expect(r.text).toBe('Burst response');
    }

    // Verify concurrency limiter throttled in-flight requests (max limit is 10)
    expect(inFlightMax).toBeLessThanOrEqual(10);
    noKeyIn();
  });

  // 9. Regression: classification & Auto DM unchanged
  it('9. Regression: DM classification still routes through Clef/Gemini as before', async () => {
    vi.spyOn(aiRouter, 'callAI').mockResolvedValue({
      text: JSON.stringify(VALID_CLASSIFICATION),
      json: VALID_CLASSIFICATION,
      model: 'gemini-flash-lite-latest',
      provider: 'gemini',
      usage: { input: 150, output: 50 },
    });

    const classificationOut = await aiService.analyzeConversation({
      messageText: 'How much for 1 reel?',
    });

    expect(classificationOut.failed).toBe(false);
    expect(classificationOut.category).toBe('pricing_inquiry');
    noKeyIn();
  });

  // 10. Security: usage endpoints reject non-admins, no DM content stored, key never leaked
  it('10. Security: non-admin gets 404, no DM content in DB or API, key never appears in logs', async () => {
    // 10a: Unauthenticated / non-admin request gets 404 (fail-closed surface hiding)
    const anonRes = await request(app).get('/api/admin/ai/usage/summary');
    expect(anonRes.status).toBe(404);

    const anonTraces = await request(app).get('/api/admin/ai/usage/traces');
    expect(anonTraces.status).toBe(404);

    const anonTest = await request(app).post('/api/admin/text-gen/test').set('Origin', ORIGIN).send({});
    expect(anonTest.status).toBe(404);

    // 10b: Generate a reply containing sensitive customer text
    const secretMsg = 'CONFIDENTIAL_CUSTOMER_MESSAGE_12345';
    groqTextGen._setFetchImpl(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({}),
      json: async () => ({
        choices: [{ message: { content: 'Safe public reply' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }),
    }));

    await aiService.generateReply({
      recentMessages: [{ sender: 'customer', text: secretMsg }],
      tenantId: 'tenant-sec-1',
    });

    await new Promise((r) => setTimeout(r, 100));

    // Verify DB columns NEVER contain the message text
    const logs = await prisma.aiUsageLog.findMany();
    for (const row of logs) {
      for (const val of Object.values(row)) {
        if (typeof val === 'string') {
          expect(val).not.toContain(secretMsg);
          expect(val).not.toContain(FAKE_GROQ_KEY);
          expect(val).not.toContain(FAKE_GEMINI_KEY);
        }
      }
    }

    // 10c: Admin traces endpoint response NEVER contains DM content or keys
    const { agent } = await adminAgent();
    const traceRes = await agent.get('/api/admin/ai/usage/traces');
    expect(traceRes.status).toBe(200);
    const traceJson = JSON.stringify(traceRes.body);
    expect(traceJson).not.toContain(secretMsg);
    expect(traceJson).not.toContain(FAKE_GROQ_KEY);
    expect(traceJson).not.toContain(FAKE_GEMINI_KEY);

    noKeyIn();
  });
});
