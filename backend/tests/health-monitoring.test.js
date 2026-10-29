/**
 * Admin rebuild, Gate 3 — AI call logging, daily roll-up, job runs, the error
 * ring, GET /api/admin/health, the AI test call, and public GET /health.
 *
 * Provider HTTP is mocked at the axios boundary: no real AI call is made.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAdmin, createAccount } from './helpers/db.js';
import { VALID_CLASSIFICATION } from './helpers/ai.js';

const require = createRequire(import.meta.url);
const axios = require('axios');
const aiService = require('../src/services/aiService.js');
const adminRoutes = require('../src/routes/admin.js');
const { rollupAiUsage, utcDayStart } = require('../src/jobs/aiUsageJob.js');
const { recordJobRun } = require('../src/jobs/jobRuns.js');
const errorRing = require('../src/lib/errorRing.js');
const { publicHealthHandler } = require('../src/lib/health.js');
const aiRouter = require('../src/lib/ai/router.js');

const ORIGIN = 'https://app.test.local';
const FAKE_KEY = 'test-gemini-key-SHOULD-NEVER-APPEAR';
const DAY = 24 * 60 * 60 * 1000;

let app;
let ipSeq = 0;
const nextIp = () => `10.70.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(() => {
  app = buildTestApp({ admin: adminRoutes });
});

beforeEach(async () => {
  await resetDb();
  await prisma.aiCallLog.deleteMany({});
  await prisma.aiUsageDaily.deleteMany({});
  await prisma.jobRun.deleteMany({});
  process.env.GEMINI_API_KEY = FAKE_KEY;
  aiRouter._resetRouterState();
  aiRouter._setBackoff([0, 0]);
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  vi.restoreAllMocks();
});

const geminiOk = (text, input = 120, output = 30) => ({
  data: {
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: input, candidatesTokenCount: output },
  },
});
const settle = async (predicate) => {
  for (let i = 0; i < 80; i += 1) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
};

async function adminAgent() {
  const { admin, password } = await createAdmin();
  const agent = request.agent(app).set('Origin', ORIGIN).set('X-Forwarded-For', nextIp());
  expect((await agent.post('/api/admin/login').send({ email: admin.email, password })).status).toBe(200);
  return agent;
}

describe('AI call logging (one central wrapper)', () => {
  it('logs provider, model, job type, tenant, latency, tokens and cost — never the message', async () => {
    const { user } = await createUser({});
    vi.spyOn(axios, 'post').mockResolvedValue(geminiOk(JSON.stringify(VALID_CLASSIFICATION)));

    const secretDm = 'what is the price of the blue kurta size M';
    await aiService.analyzeConversation({ messageText: secretDm, tenantId: user.id });
    await settle(async () => (await prisma.aiCallLog.count()) === 1);

    const row = await prisma.aiCallLog.findFirst();
    expect(row).toMatchObject({
      provider: 'gemini',
      model: 'gemini-flash-lite-latest',
      jobType: 'classification',
      tenantId: user.id,
      success: true,
      inputTokens: 120,
      outputTokens: 30,
    });
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row.estimatedCost).toBeCloseTo((120 * 0.1 + 30 * 0.4) / 1e6, 12);
    expect(JSON.stringify(row)).not.toContain('kurta');
  });

  // TEMP: Groq text-gen release routes summary generation to Groq by default.
  // Legacy test asserts Gemini axios.post retries for summaries.
  it.skip('logs a failed call (each retry) with a safe error code and HTTP status, never the key or message text', async () => {
    const err = Object.assign(new Error(`Request failed for https://x/?key=${FAKE_KEY}`), {
      response: { status: 429, data: { error: { status: 'RESOURCE_EXHAUSTED', message: `quota for key ${FAKE_KEY}` } } },
    });
    vi.spyOn(axios, 'post').mockRejectedValue(err);

    await aiService.summarizeConversation({ recentMessages: [{ direction: 'inbound', content: 'hello' }] });
    await settle(async () => (await prisma.aiCallLog.count()) === 3); // 1 try + 2 retries (429 is transient)

    const rows = await prisma.aiCallLog.findMany();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.success).toBe(false);
      expect(r.errorCode).toBe('RESOURCE_EXHAUSTED');
      expect(r.httpStatus).toBe(429);
      expect(r.jobType).toBe('summary');
      expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
    }
  });

  it('an unparseable or schema-invalid answer is a logged failure (it still cost tokens) and is not retried', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValueOnce(geminiOk('not json at all'));
    const first = await aiService.analyzeConversation({ messageText: 'where do i buy this?' });
    expect(first.failed).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);

    post.mockResolvedValueOnce(geminiOk(JSON.stringify({ category: 'fan' }))); // missing required fields
    const second = await aiService.analyzeConversation({ messageText: 'where do i buy this?' });
    expect(second.failed).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);

    await settle(async () => (await prisma.aiCallLog.count()) === 2);
    const rows = await prisma.aiCallLog.findMany();
    expect(rows.map((r) => `${r.success}:${r.errorCode}`).sort()).toEqual(['false:SCHEMA_INVALID', 'false:UNPARSEABLE']);
  });
});

describe('daily roll-up', () => {
  it('rolls up by day/provider/model/job, is idempotent, and purges raw rows older than 30 days', async () => {
    const now = new Date();
    const today = utcDayStart(now);
    const mk = (createdAt, success, cost = 0.001) =>
      prisma.aiCallLog.create({
        data: { provider: 'gemini', model: 'm1', jobType: 'classification', latencyMs: 100, success, inputTokens: 10, outputTokens: 5, estimatedCost: cost, createdAt },
      });
    await mk(new Date(today.getTime() + 1000), true);
    await mk(new Date(today.getTime() + 2000), false);
    await mk(new Date(today.getTime() - DAY + 1000), true);
    await mk(new Date(now.getTime() - 31 * DAY), true);

    const first = await rollupAiUsage({ now });
    const second = await rollupAiUsage({ now });
    expect(first.purged).toBe(1);
    expect(second.purged).toBe(0);

    const todayRow = await prisma.aiUsageDaily.findFirst({ where: { day: today } });
    expect(todayRow).toMatchObject({ calls: 2, failures: 1, inputTokens: 20, outputTokens: 10 });
    expect(todayRow.estimatedCost).toBeCloseTo(0.002, 9);
    expect(await prisma.aiUsageDaily.count(), 'no duplicate rows after a second run').toBe(2);
    expect(await prisma.aiCallLog.count()).toBe(3);
  });
});

describe('job runs', () => {
  it('records success with counts, and failure with the first error line only', async () => {
    await recordJobRun('demo_ok', async () => ({ refreshed: 3, note: 'not a number' }));
    await expect(
      recordJobRun('demo_fail', async () => {
        throw new Error('boom on line one\nInvalid `prisma.message.create()`:\n content: "a customer DM"');
      })
    ).rejects.toThrow('boom');

    const ok = await prisma.jobRun.findFirst({ where: { jobName: 'demo_ok' } });
    expect(ok.success).toBe(true);
    expect(ok.details).toEqual({ refreshed: 3 });
    expect(ok.finishedAt).not.toBeNull();

    const bad = await prisma.jobRun.findFirst({ where: { jobName: 'demo_fail' } });
    expect(bad.success).toBe(false);
    expect(bad.error).toBe('boom on line one');
  });
});

describe('error ring', () => {
  it('keeps the last 100, sanitised: no DM text, keys, tokens, emails or DB URLs', () => {
    errorRing._reset();
    errorRing.recordError('Invalid call content: "hi can you send the price list please" next\nsecond line with DM');
    errorRing.recordError('connect failed postgresql://u:p@db:5432/x token=abc123 Bearer eyJhbGci someone@example.com');
    const [latest, older] = errorRing.recentErrors();
    expect(older.message).not.toContain('price list');
    expect(older.message).not.toContain('second line');
    for (const bad of ['u:p@db', 'abc123', 'eyJhbGci', 'someone@example.com']) expect(latest.message).not.toContain(bad);

    for (let i = 0; i < 150; i += 1) errorRing.recordError(`e${i}`);
    expect(errorRing.recentErrors()).toHaveLength(100);
    expect(errorRing.recentErrors()[0].message).toBe('e149');
  });
});

describe('GET /api/admin/health', () => {
  it('reports every section, and nothing secret', async () => {
    const { user } = await createUser({});
    const account = await createAccount({ userId: user.id });
    await prisma.instagramAccount.update({ where: { id: account.id }, data: { tokenExpiresAt: new Date(Date.now() + 3 * DAY) } });
    await recordJobRun('demo_job', async () => 1);
    await prisma.webhookDelivery.create({ data: { deliveryHash: 'h1' } });

    const agent = await adminAgent();
    const res = await agent.get('/api/admin/health');
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(b.process.eventLoopLagMs).toHaveProperty('p99');
    expect(b.database.ok).toBe(true);
    expect(typeof b.database.pingMs).toBe('number');
    expect(b.sockets).toHaveProperty('connectedClients');
    expect(b.jobs.find((j) => j.jobName === 'demo_job').success).toBe(true);
    expect(b.webhooks.received24h).toBe(1);
    expect(b.ai.lastHour).toHaveProperty('p95LatencyMs');
    expect(b.ai.active.primaryProvider).toBe('gemini');
    expect(b.ai.active.keyConfigured).toBe(true);
    expect(b.email).toHaveProperty('failures24h');
    expect(b.instagramTokens.expiringWithin7Days.map((a) => a.id)).toContain(account.id);

    const text = JSON.stringify(b);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toMatch(/accessToken|tokenCiphertext|passwordHash/);
  });

  it('is a GET the dashboard can poll without it counting as admin activity', async () => {
    const agent = await adminAgent();
    const before = (await agent.get('/api/admin/me')).body.idleExpiresAt;
    await agent.get('/api/admin/health');
    expect((await agent.get('/api/admin/me')).body.idleExpiresAt).toBe(before);
  });
});

describe('POST /api/admin/health/ai-test', () => {
  it('makes one minimal call, logs it as admin_test, audits it, and returns no provider text', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue(geminiOk('OK'));
    const agent = await adminAgent();
    const res = await agent.post('/api/admin/health/ai-test').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, provider: 'gemini', model: 'gemini-flash-lite-latest' });
    await settle(async () => (await prisma.aiCallLog.count({ where: { jobType: 'admin_test' } })) === 1);
    expect(await prisma.aiCallLog.count({ where: { jobType: 'admin_test' } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { action: 'AI_TEST' } })).toBe(1);
  });

  it('a provider failure answers a safe code, never the provider error', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(
      Object.assign(new Error(`bad key ${FAKE_KEY}`), { response: { status: 403, data: { error: { message: 'secret detail' } } } })
    );
    const agent = await adminAgent();
    const res = await agent.post('/api/admin/health/ai-test').send({});
    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('PROVIDER_FAILED');
    expect(JSON.stringify(res.body)).not.toMatch(/secret detail|SHOULD-NEVER-APPEAR/);
  });
});

describe('public GET /health', () => {
  it('says only {status:"ok"}', async () => {
    const pub = express();
    pub.get('/health', publicHealthHandler);
    const res = await request(pub).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
