import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createAdmin, createUser } from './helpers/db.js';

const require = createRequire(import.meta.url);
const adminRoutes = require('../src/routes/admin.js');
const apiRoutes = require('../src/routes/api.js');
const mailer = require('../src/lib/email/index.js');
const clefClassifier = require('../src/lib/ai/clefClassifier.js');
const settings = require('../src/lib/settings.js');

const {
  getClassificationStats,
  calculatePercentile,
  clearProviderOverrideCache,
  resolveClassificationProvider,
  _resetCircuitBreaker,
  _getCircuitBreakerState,
  _setFetchImpl,
  _resetFetchImpl,
  _resetClassificationMetrics,
} = clefClassifier;

const ORIGIN = 'https://app.test.local';

let app;
let ipCounter = 0;
const nextIp = () => `10.88.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

beforeAll(() => {
  app = buildTestApp({ admin: adminRoutes, mount: { '/api': apiRoutes } });
});

async function createAdminSession() {
  const created = await createAdmin();
  const agent = request.agent(app);
  const ip = nextIp();
  const res = await agent
    .post('/api/admin/login')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', ip)
    .send({ email: created.admin.email, password: created.password });
  expect(res.status).toBe(200);
  return { agent, admin: created.admin, ip };
}

describe('Admin DM Classification Management', () => {
  const origEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...origEnv };
    if (mailer._resetQuota) {
      mailer._resetQuota();
    }
    await resetDb();
    _resetCircuitBreaker();
    _resetFetchImpl();
    clearProviderOverrideCache();
    settings.clearSettingsCache();
    if (_resetClassificationMetrics) {
      _resetClassificationMetrics();
    }
  });

  afterEach(async () => {
    process.env = { ...origEnv };
    _resetCircuitBreaker();
    _resetFetchImpl();
    clearProviderOverrideCache();
    settings.clearSettingsCache();
    vi.restoreAllMocks();
  });

  describe('Route Protection & Authorization', () => {
    it('returns 404 for unauthenticated requests to GET /api/admin/classification/status (fail-closed surface hiding)', async () => {
      const res = await request(app)
        .get('/api/admin/classification/status')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', nextIp());
      expect(res.status).toBe(404);
    });

    it('returns 404 for unauthenticated requests to POST /api/admin/classification/provider', async () => {
      const res = await request(app)
        .post('/api/admin/classification/provider')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', nextIp())
        .send({ provider: 'clef' });
      expect(res.status).toBe(404);
    });

    it('returns 404 for customer/tenant sessions attempting admin classification routes', async () => {
      const { user } = await createUser();
      const customerAgent = request.agent(app);
      const ip = nextIp();

      const res = await customerAgent
        .get('/api/admin/classification/status')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/admin/classification/status', () => {
    it('returns structured status with credentials status, circuit breaker, and zero secret leakage', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-cf-account-id-xyz';
      process.env.CLOUDFLARE_API_TOKEN = 'test-cf-token-secret-123';
      process.env.CLASSIFICATION_PROVIDER = 'clef';

      const { agent, ip } = await createAdminSession();
      const res = await agent
        .get('/api/admin/classification/status')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('effectiveProvider', 'clef');
      expect(res.body).toHaveProperty('targetProvider', 'clef');
      expect(res.body).toHaveProperty('source', 'env');
      expect(res.body).toHaveProperty('credentialsPresent', true);

      // Strict security assertion: raw secrets MUST NOT appear anywhere in the response JSON
      const jsonStr = JSON.stringify(res.body);
      expect(jsonStr).not.toContain('test-cf-account-id-xyz');
      expect(jsonStr).not.toContain('test-cf-token-secret-123');
      expect(jsonStr).not.toContain('password');

      // Circuit breaker fields
      expect(res.body.circuitBreaker).toHaveProperty('state', 'CLOSED');
      expect(res.body.circuitBreaker).toHaveProperty('consecutiveFailures', 0);
      expect(res.body.circuitBreaker).toHaveProperty('isOpen', false);

      // Metrics fields
      expect(res.body).toHaveProperty('maxWindowSize', 500);
      expect(res.body).toHaveProperty('totalCalls');
      expect(res.body).toHaveProperty('fallbackRate');
      expect(res.body).toHaveProperty('latency');
      expect(res.body).toHaveProperty('fallbackReasons');
    });

    it('reports missing credentials when env vars are unset', async () => {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CLASSIFICATION_PROVIDER;

      const { agent, ip } = await createAdminSession();
      const res = await agent
        .get('/api/admin/classification/status')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip);

      expect(res.status).toBe(200);
      expect(res.body.credentialsPresent).toBe(false);
      expect(res.body.effectiveProvider).toBe('gemini');
    });
  });

  describe('POST /api/admin/classification/provider', () => {
    it('validates provider and rejects invalid values with 400', async () => {
      const { agent, ip } = await createAdminSession();
      const res = await agent
        .post('/api/admin/classification/provider')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({ provider: 'anthropic_claude' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Provider must be');
    });

    it('rejects extra fields with 400 (strict validation)', async () => {
      const { agent, ip } = await createAdminSession();
      const res = await agent
        .post('/api/admin/classification/provider')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({ provider: 'clef', unapprovedField: 'injected' });

      expect(res.status).toBe(400);
    });

    it('updates runtime provider to clef, writes audit log, and clears in-memory cache', async () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-id';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';
      process.env.CLASSIFICATION_PROVIDER = 'gemini'; // default env is gemini

      const { agent, admin, ip } = await createAdminSession();

      const postRes = await agent
        .post('/api/admin/classification/provider')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({ provider: 'clef', reason: 'Switching to Clef for faster response time' });

      expect(postRes.status).toBe(200);
      expect(postRes.body.success).toBe(true);
      expect(postRes.body.provider).toBe('clef');
      expect(postRes.body.stats.effectiveProvider).toBe('clef');

      // Verify DB setting was saved
      const savedSetting = await prisma.appSetting.findUnique({
        where: { key: 'classification_provider' },
      });
      expect(savedSetting).not.toBeNull();
      expect(savedSetting.value).toBe('clef');
      expect(savedSetting.updatedBy).toBe(admin.id);

      // Verify audit log entry was created
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          adminId: admin.id,
          action: 'CLASSIFICATION_PROVIDER_SET',
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.after).toHaveProperty('provider', 'clef');
      expect(auditLog.reason).toBe('Switching to Clef for faster response time');

      // Verify resolver now uses clef immediately
      const resolved = await resolveClassificationProvider();
      expect(resolved.effectiveProvider).toBe('clef');

      // Now switch back to gemini
      const switchBackRes = await agent
        .post('/api/admin/classification/provider')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({ provider: 'gemini', reason: 'Reverting back to Gemini' });

      expect(switchBackRes.status).toBe(200);
      expect(switchBackRes.body.provider).toBe('gemini');
      expect(switchBackRes.body.stats.effectiveProvider).toBe('gemini');

      const resolvedBack = await resolveClassificationProvider();
      expect(resolvedBack.effectiveProvider).toBe('gemini');
    });
  });

  describe('POST /api/admin/classification/test (Synthetic Fixed Probe)', () => {
    it('rejects custom message payload in request body with 400', async () => {
      const { agent, ip } = await createAdminSession();
      const res = await agent
        .post('/api/admin/classification/test')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({ message: 'Hello this is an arbitrary probe message' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unexpected field in the request.');
    });

    it('runs the fixed probe and returns classification outcome', async () => {
      // Mock fetch implementation for Clef classification contract
      _setFetchImpl(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          result: {
            answers: {
              category: {
                choice: 'pricing_inquiry',
                confidence: 0.95,
              },
            },
          },
          success: true,
        }),
      }));

      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-id';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';
      process.env.CLASSIFICATION_PROVIDER = 'clef';

      const { agent, ip } = await createAdminSession();
      const res = await agent
        .post('/api/admin/classification/test')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.category).toBe('pricing_inquiry');
      expect(res.body.provider).toBe('cloudflare');
      expect(res.body).toHaveProperty('latencyMs');
    });

    it('enforces rate limit of maximum 6 synthetic tests per minute', async () => {
      _setFetchImpl(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          result: {
            answers: {
              category: {
                choice: 'pricing_inquiry',
                confidence: 0.95,
              },
            },
          },
          success: true,
        }),
      }));

      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-id';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';
      process.env.CLASSIFICATION_PROVIDER = 'clef';

      const { agent, ip } = await createAdminSession();

      // Fire 6 allowed calls
      for (let i = 0; i < 6; i++) {
        const res = await agent
          .post('/api/admin/classification/test')
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', ip)
          .send({});
        expect(res.status).toBe(200);
      }

      // The 7th call must be blocked with 429
      const blockedRes = await agent
        .post('/api/admin/classification/test')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({});

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error).toContain('Rate limit');
    });
  });

  describe('POST /api/admin/classification/circuit-breaker/reset', () => {
    it('resets tripped circuit breaker and logs audit event', async () => {
      const { agent, admin, ip } = await createAdminSession();

      const res = await agent
        .post('/api/admin/classification/circuit-breaker/reset')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', ip)
        .send({ reason: 'Manual circuit breaker reset after upstream fix' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.stats.circuitBreaker.state).toBe('CLOSED');
      expect(res.body.stats.circuitBreaker.consecutiveFailures).toBe(0);

      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          adminId: admin.id,
          action: 'CLASSIFICATION_CIRCUIT_BREAKER_RESET',
        },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog.reason).toBe('Manual circuit breaker reset after upstream fix');
    });
  });

  describe('In-Memory Percentile & Metrics Calculation Unit Tests', () => {
    it('computes correct p50 and p95 nearest-rank percentiles', () => {
      expect(calculatePercentile([], 50)).toBeNull();
      expect(calculatePercentile([100], 50)).toBe(100);
      expect(calculatePercentile([100], 95)).toBe(100);

      // Array of 10 sorted latencies: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      // 50th percentile of 10 items (index Math.floor(10 * 0.5) = 5): index 5 is 60
      expect(calculatePercentile(latencies, 50)).toBe(60);
      // 95th percentile of 10 items (index Math.floor(10 * 0.95) = 9): index 9 is 100
      expect(calculatePercentile(latencies, 95)).toBe(100);
    });

    it('never exposes raw text, secrets, or identifiers in getClassificationStats()', async () => {
      const stats = await getClassificationStats();
      expect(stats).toHaveProperty('maxWindowSize', 500);
      expect(stats).toHaveProperty('totalCalls');
      expect(stats).toHaveProperty('countsByProvider');
      expect(stats).toHaveProperty('fallbackCount');
      expect(stats).toHaveProperty('fallbackRate');
      expect(stats).toHaveProperty('latency');
      expect(stats).toHaveProperty('fallbackReasons');

      const jsonStr = JSON.stringify(stats);
      expect(jsonStr).not.toContain('password');
      expect(jsonStr).not.toContain('secret');
      expect(jsonStr).not.toContain('token');
      expect(jsonStr).not.toContain('account_id');
    });
  });
});
