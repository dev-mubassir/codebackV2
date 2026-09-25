/**
 * Admin rebuild, Gate 4 — multi-provider AI switching, security first.
 *
 * All provider HTTP is mocked at axios (no real OpenAI / Anthropic / Gemini
 * call is ever made). Keys are recognisable fake strings so "never in a
 * response or a log" can be asserted literally.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createAdmin } from './helpers/db.js';
import { VALID_CLASSIFICATION, geminiResponse, openaiResponse, anthropicResponse, providerOfUrl } from './helpers/ai.js';

const require = createRequire(import.meta.url);
const axios = require('axios');
const aiService = require('../src/services/aiService.js');
const aiRouter = require('../src/lib/ai/router.js');
const mailer = require('../src/lib/email/index.js');
const adminRoutes = require('../src/routes/admin.js');

const ORIGIN = 'https://app.test.local';
const KEYS = {
  GEMINI_API_KEY: 'gemini-KEY-must-never-leak',
  OPENAI_API_KEY: 'openai-KEY-must-never-leak',
  ANTHROPIC_API_KEY: 'anthropic-KEY-must-never-leak',
};

let app;
let ipSeq = 0;
beforeAll(() => {
  app = buildTestApp({ admin: adminRoutes });
});

let logged;
beforeEach(async () => {
  await resetDb();
  await prisma.aiConfig.deleteMany({});
  Object.assign(process.env, KEYS);
  aiRouter._resetRouterState();
  aiRouter._setBackoff([0, 0]);
  logged = [];
  for (const level of ['log', 'warn', 'error', 'info']) {
    vi.spyOn(console, level).mockImplementation((...args) => logged.push(args.map(String).join(' ')));
  }
  vi.spyOn(mailer, 'sendAdminOpsAlert').mockResolvedValue({ id: 'mock' });
});

afterEach(() => {
  for (const k of Object.keys(KEYS)) delete process.env[k];
  vi.restoreAllMocks();
});

const noKeyIn = (...texts) => {
  for (const t of [...texts, ...logged]) expect(String(t)).not.toContain('must-never-leak');
};

/** axios.post answering per provider. */
function mockProviders(answers) {
  return vi.spyOn(axios, 'post').mockImplementation(async (url, body, config) => {
    const p = providerOfUrl(url);
    const handler = answers[p];
    if (!handler) throw new Error(`unexpected call to ${p}`);
    return handler(url, body, config);
  });
}

async function adminAgent() {
  const { admin, password } = await createAdmin();
  const agent = request.agent(app).set('Origin', ORIGIN).set('X-Forwarded-For', `10.95.0.${(ipSeq++ % 250) + 1}`);
  expect((await agent.post('/api/admin/login').send({ email: admin.email, password })).status).toBe(200);
  return { agent, password };
}

async function stepUp(agent, password) {
  expect((await agent.post('/api/admin/step-up').send({ password })).status).toBe(200);
}

async function setActive(provider, model, extra = {}) {
  await prisma.aiConfig.upsert({
    where: { id: 'active' },
    create: { id: 'active', activeProvider: provider, activeModel: model, ...extra },
    update: { activeProvider: provider, activeModel: model, ...extra },
  });
  aiRouter.clearAiConfigCache();
}

describe('adapters normalise to one output', () => {
  const answer = JSON.stringify(VALID_CLASSIFICATION);

  it.each([
    ['gemini', 'gemini-flash-lite-latest', geminiResponse],
    ['openai', 'gpt-4o-mini', openaiResponse],
    ['anthropic', 'claude-haiku-4-5', anthropicResponse],
  ])('%s produces the same normalised classification', async (provider, model, shape) => {
    await setActive(provider, model);
    const post = mockProviders({ [provider]: async () => shape(answer) });

    const out = await aiService.analyzeConversation({ messageText: 'How much for one reel?' });
    expect(out.failed).toBe(false);
    expect(out).toMatchObject({ provider, model, category: 'pricing_inquiry', customerType: 'potential_buyer', riskLevel: 'LOW', shouldAutoReply: true });

    // Keys travel in headers, never in the URL.
    const [url, , config] = post.mock.calls[0];
    expect(url).not.toContain('must-never-leak');
    const headers = config.headers;
    if (provider === 'gemini') expect(headers['x-goog-api-key']).toBe(KEYS.GEMINI_API_KEY);
    if (provider === 'openai') expect(headers.Authorization).toBe(`Bearer ${KEYS.OPENAI_API_KEY}`);
    if (provider === 'anthropic') {
      expect(headers['x-api-key']).toBe(KEYS.ANTHROPIC_API_KEY);
      expect(headers['anthropic-version']).toBe('2023-06-01');
    }
    noKeyIn();
  });

  it('an Anthropic refusal is a failed call, not an answer', async () => {
    await setActive('anthropic', 'claude-sonnet-5');
    mockProviders({ anthropic: async () => anthropicResponse('', 10, 0, 'refusal') });
    const out = await aiService.analyzeConversation({ messageText: 'hello?' });
    expect(out.failed).toBe(true);
  });
});

describe('keys', () => {
  it('a provider with no key shows "not configured" and never crashes a call', async () => {
    delete process.env.OPENAI_API_KEY;
    await setActive('openai', 'gpt-4o-mini');
    const post = vi.spyOn(axios, 'post');
    const out = await aiService.analyzeConversation({ messageText: 'price please?' });
    expect(out.failed).toBe(true);
    expect(out.billable, 'no network call happened').toBe(false);
    expect(post).not.toHaveBeenCalled();

    const { agent } = await adminAgent();
    const cfg = await agent.get('/api/admin/ai/config');
    expect(cfg.status).toBe(200);
    const openai = cfg.body.providers.find((p) => p.id === 'openai');
    expect(openai.keyConfigured).toBe(false);
    expect(openai.envKey).toBe('OPENAI_API_KEY');
    expect(cfg.body.providers.map((p) => p.id).sort()).toEqual(['anthropic', 'gemini', 'openai']);
  });

  it('no endpoint response or log line ever carries a key', async () => {
    mockProviders({ gemini: async () => { throw Object.assign(new Error('Request failed'), { response: { status: 400, data: { error: { message: `bad ${KEYS.GEMINI_API_KEY}` } } } }); } });
    await aiService.analyzeConversation({ messageText: 'price?' });
    const { agent, password } = await adminAgent();
    const bodies = [
      (await agent.get('/api/admin/ai/config')).body,
      (await agent.get('/api/admin/health')).body,
      (await agent.post('/api/admin/ai/test').send({ provider: 'gemini', model: 'gemini-flash-lite-latest' })).body,
    ];
    await stepUp(agent, password);
    bodies.push((await agent.post('/api/admin/ai/rollback').send({ reason: 'check' })).body);
    noKeyIn(...bodies.map((b) => JSON.stringify(b)));
  });
});

describe('the allowlist', () => {
  it('refuses a non-allowlisted model, an unknown provider, and any extra field (baseUrl, apiKey)', async () => {
    const { agent, password } = await adminAgent();
    await stepUp(agent, password);
    const cases = [
      ['/api/admin/ai/test', { provider: 'openai', model: 'gpt-5-custom' }, 'NOT_ALLOWED'],
      ['/api/admin/ai/test', { provider: 'xai', model: 'grok-3-mini' }, 'NOT_ALLOWED'],
      ['/api/admin/ai/test', { provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://evil.example' }, 'UNEXPECTED_FIELD'],
      ['/api/admin/ai/activate', { provider: 'openai', model: 'gpt-4o-mini', testRunId: 'x', reason: 'switch', apiKey: 'sk-x' }, 'UNEXPECTED_FIELD'],
      ['/api/admin/ai/activate', { provider: 'openai', model: 'my-model', testRunId: 'x', reason: 'switch' }, 'NOT_ALLOWED'],
    ];
    for (const [url, body, code] of cases) {
      const res = await agent.post(url).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe(code);
    }
    expect(await prisma.aiConfig.count()).toBe(0);
  });

  it('a stored config outside the allowlist is ignored in favour of the default', async () => {
    await prisma.aiConfig.create({ data: { id: 'active', activeProvider: 'openai', activeModel: 'totally-custom' } });
    aiRouter.clearAiConfigCache();
    expect((await aiRouter.getAiConfig()).active).toEqual({ provider: 'gemini', model: 'gemini-flash-lite-latest' });
  });
});

describe('test → activate → rollback', () => {
  it('runs the 10 synthetic samples, then activation needs step-up, a reason and a passing test', async () => {
    const post = mockProviders({ openai: async () => openaiResponse(JSON.stringify(VALID_CLASSIFICATION)) });
    const { agent, password } = await adminAgent();

    const test = await agent.post('/api/admin/ai/test').send({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(test.status).toBe(200);
    expect(test.body.results).toHaveLength(10);
    expect(test.body.allSchemaValid).toBe(true);
    expect(test.body.results.every((r) => typeof r.latencyMs === 'number')).toBe(true);
    expect(test.body.cost).toHaveProperty('candidatePer1000Usd');
    expect(post).toHaveBeenCalledTimes(10);

    const body = { provider: 'openai', model: 'gpt-4o-mini', testRunId: test.body.testRunId, reason: 'cheaper and passed' };
    const noStepUp = await agent.post('/api/admin/ai/activate').send(body);
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body.code).toBe('STEP_UP_REQUIRED');

    await stepUp(agent, password);
    expect((await agent.post('/api/admin/ai/activate').send({ ...body, reason: '' })).status, 'reason required').toBe(400);
    const ok = await agent.post('/api/admin/ai/activate').send(body);
    expect(ok.status).toBe(200);
    expect((await aiRouter.getAiConfig({ fresh: true })).active).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });

    const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'AI_PROVIDER_ACTIVATE' } });
    expect(audit.reason).toBe('cheaper and passed');
    expect(audit.before.active).toEqual({ provider: 'gemini', model: 'gemini-flash-lite-latest' });

    // Rollback: one click back to the previous model, audited.
    const back = await agent.post('/api/admin/ai/rollback').send({ reason: 'quality dropped' });
    expect(back.status).toBe(200);
    expect((await aiRouter.getAiConfig({ fresh: true })).active).toEqual({ provider: 'gemini', model: 'gemini-flash-lite-latest' });
    expect(await prisma.adminAuditLog.count({ where: { action: 'AI_PROVIDER_ROLLBACK' } })).toBe(1);
  });

  it('refuses activation when any sample came back schema-invalid', async () => {
    let n = 0;
    mockProviders({
      anthropic: async () => {
        n += 1;
        return anthropicResponse(n === 7 ? JSON.stringify({ category: 'pricing_inquiry' }) : JSON.stringify(VALID_CLASSIFICATION));
      },
    });
    const { agent, password } = await adminAgent();
    const test = await agent.post('/api/admin/ai/test').send({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(test.body.allSchemaValid).toBe(false);
    expect(test.body.results.filter((r) => !r.schemaValid)).toHaveLength(1);

    await stepUp(agent, password);
    const res = await agent.post('/api/admin/ai/activate').send({ provider: 'anthropic', model: 'claude-haiku-4-5', testRunId: test.body.testRunId, reason: 'try it' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TEST_REQUIRED');
    expect(await prisma.aiConfig.count()).toBe(0);
  });

  it('a passing test of a DIFFERENT model cannot be reused to activate another', async () => {
    mockProviders({ openai: async () => openaiResponse(JSON.stringify(VALID_CLASSIFICATION)) });
    const { agent, password } = await adminAgent();
    const test = await agent.post('/api/admin/ai/test').send({ provider: 'openai', model: 'gpt-4o-mini' });
    await stepUp(agent, password);
    const res = await agent.post('/api/admin/ai/activate').send({ provider: 'openai', model: 'gpt-4o', testRunId: test.body.testRunId, reason: 'sneaky' });
    expect(res.status).toBe(409);
  });

  it('only a provider with a configured key can be tested or activated', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { agent } = await adminAgent();
    const res = await agent.post('/api/admin/ai/test').send({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_CONFIGURED');
  });
});

describe('retries and fallback', () => {
  it('retries a transient failure with backoff, and not a 4xx', async () => {
    let calls = 0;
    mockProviders({
      gemini: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('Request failed'), { response: { status: 503, data: {} } });
        return geminiResponse(JSON.stringify(VALID_CLASSIFICATION));
      },
    });
    expect((await aiService.analyzeConversation({ messageText: 'price?' })).failed).toBe(false);
    expect(calls).toBe(2);

    calls = 0;
    axios.post.mockImplementation(async () => {
      calls += 1;
      throw Object.assign(new Error('Request failed'), { response: { status: 400, data: {} } });
    });
    expect((await aiService.analyzeConversation({ messageText: 'price?' })).failed).toBe(true);
    expect(calls, 'a 400 is not retried').toBe(1);
  });

  it('after 5 consecutive failures, switches to the fallback, alerts once, and audits it', async () => {
    await createAdmin();
    await setActive('gemini', 'gemini-flash-lite-latest', { fallbackProvider: 'anthropic', fallbackModel: 'claude-haiku-4-5', fallbackEnabled: true });
    const seen = [];
    mockProviders({
      gemini: async () => {
        seen.push('gemini');
        throw Object.assign(new Error('Request failed'), { response: { status: 400, data: {} } });
      },
      anthropic: async () => {
        seen.push('anthropic');
        return anthropicResponse(JSON.stringify(VALID_CLASSIFICATION));
      },
    });

    for (let i = 0; i < 4; i += 1) {
      expect((await aiService.analyzeConversation({ messageText: 'price?' })).failed).toBe(true);
    }
    expect(seen.includes('anthropic'), 'no fallback before 5 failures').toBe(false);

    const fifth = await aiService.analyzeConversation({ messageText: 'price?' });
    expect(fifth.failed, 'the 5th call is served by the fallback').toBe(false);
    expect(fifth.provider).toBe('anthropic');

    const sixth = await aiService.analyzeConversation({ messageText: 'price?' });
    expect(sixth.provider, 'and traffic stays on it').toBe('anthropic');
    expect(seen.filter((p) => p === 'gemini')).toHaveLength(5);

    expect(mailer.sendAdminOpsAlert).toHaveBeenCalledTimes(1);
    expect(await prisma.adminAuditLog.count({ where: { action: 'AI_FALLBACK_ACTIVATED' } })).toBe(1);
    expect(aiRouter.fallbackState().active).toBe(true);
  });

  it('with fallback disabled (the default), failures never switch provider', async () => {
    await setActive('gemini', 'gemini-flash-lite-latest', { fallbackProvider: 'anthropic', fallbackModel: 'claude-haiku-4-5', fallbackEnabled: false });
    const seen = [];
    mockProviders({
      gemini: async () => { seen.push('gemini'); throw Object.assign(new Error('x'), { response: { status: 400, data: {} } }); },
      anthropic: async () => { seen.push('anthropic'); return anthropicResponse(JSON.stringify(VALID_CLASSIFICATION)); },
    });
    for (let i = 0; i < 7; i += 1) await aiService.analyzeConversation({ messageText: 'price?' });
    expect(seen.includes('anthropic')).toBe(false);
    expect(mailer.sendAdminOpsAlert).not.toHaveBeenCalled();
  });
});
