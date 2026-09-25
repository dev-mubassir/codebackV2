/**
 * State that must be ONE across instances once Redis is configured, and must
 * degrade (never hang) when Redis is not there.
 *
 *   - rate limits: two limiter instances (= two API instances) share a count
 *   - email daily quota: a send recorded by "another instance" is seen here
 *   - BullMQ: a job is processed; a failing job retries; a queued job survives
 *     a "redeploy" (queue closed, new worker picks it up)
 *   - fallback: with Redis unreachable the limiter answers from memory
 *
 * Needs a Redis: TEST_REDIS_URL, default redis://localhost:56379
 * (docker run -d --name siffty-test-redis -p 56379:6379 redis:7-alpine).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);
const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:56379';

let redis;
let rateLimit;
let quota;
let queue;

async function ready(client) {
  if (client.status === 'ready') return;
  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
  });
}

beforeAll(async () => {
  process.env.REDIS_URL = REDIS_URL;
  redis = require('../src/lib/redis.js');
  rateLimit = require('../src/lib/rateLimit.js');
  quota = require('../src/lib/email/quota.js');
  queue = require('../src/lib/queue.js');
  await ready(redis.getRedis());
});

beforeEach(async () => {
  await redis.getRedis().flushdb();
  quota._reset();
});

afterAll(async () => {
  await queue.closeQueues();
  await redis.closeRedis();
  delete process.env.REDIS_URL;
});

function appWith(limiter) {
  const app = express();
  app.set('trust proxy', 1);
  app.post('/auth/login', limiter, (req, res) => res.json({ ok: true }));
  return app;
}

describe('rate limits are shared across instances', () => {
  it('two instances with the same limiter enforce ONE limit between them', async () => {
    const opts = { windowMs: 60 * 1000, max: 3 };
    const instanceA = appWith(rateLimit.createRateLimiter(opts));
    const instanceB = appWith(rateLimit.createRateLimiter(opts));
    const ip = '203.0.113.9';

    const statuses = [];
    for (const app of [instanceA, instanceB, instanceA, instanceB]) {
      statuses.push((await request(app).post('/auth/login').set('X-Forwarded-For', ip)).status);
    }
    // Per-instance memory would have allowed all four (2 each, under 3).
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(rateLimit.rateLimitStore()).toBe('redis');
  });

  it('different client IPs keep separate budgets', async () => {
    const app = appWith(rateLimit.createRateLimiter({ windowMs: 60 * 1000, max: 1 }));
    expect((await request(app).post('/auth/login').set('X-Forwarded-For', '198.51.100.1')).status).toBe(200);
    expect((await request(app).post('/auth/login').set('X-Forwarded-For', '198.51.100.2')).status).toBe(200);
    expect((await request(app).post('/auth/login').set('X-Forwarded-For', '198.51.100.1')).status).toBe(429);
  });

  it('keys are hashed — no IP or email is stored in Redis', async () => {
    const app = appWith(rateLimit.createRateLimiter({ windowMs: 60 * 1000, max: 5, keyBy: () => 'person@example.com' }));
    await request(app).post('/auth/login');
    const keys = await redis.getRedis().keys('*');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join(' ')).not.toMatch(/person|example|203\.0/);
  });
});

describe('email daily quota is shared across instances', () => {
  it('sends recorded by other instances count against this one', async () => {
    const cap = quota.stats().cap;
    const reserve = quota.stats().reserve;
    // "Another instance" has already used every deferrable send today.
    await redis.getRedis().set(`email:quota:${new Date().toISOString().slice(0, 10)}:sent`, String(cap - reserve));

    expect(quota.check('trialEnding', 'a@test.codeback').ok, 'this instance alone has sent nothing').toBe(true);
    const shared = await quota.checkShared('trialEnding', 'a@test.codeback');
    expect(shared.ok).toBe(false);
    expect(shared.reason).toBe('daily_cap');
    // The critical reserve is still there for a password reset.
    expect((await quota.checkShared('passwordReset', 'a@test.codeback')).ok).toBe(true);
  });

  it('the per-recipient throttle is shared too', async () => {
    for (let i = 0; i < 3; i += 1) await quota.recordSendShared('passwordReset', 'P@Test.Codeback');
    quota._reset(); // a different instance: nothing in its memory
    const out = await quota.checkShared('passwordReset', 'p@test.codeback');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('per_recipient');
  });
});

describe('BullMQ on Redis (D3)', () => {
  const waitFor = async (predicate, timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  it('uses BullMQ when REDIS_URL is set, and processes a job', async () => {
    const system = queue.getJobSystem(`test-processed-${Date.now()}`);
    expect(system.mode).toBe('redis');
    const seen = [];
    system.registerProcessor(async (job) => {
      seen.push(job.data.n);
    });
    await system.add('t', { n: 1 }, { jobId: `job-${Date.now()}` });
    expect(await waitFor(() => seen.length === 1)).toBe(true);
  });

  it('a failing job is retried with backoff, then succeeds', async () => {
    const system = queue.getJobSystem(`test-retry-${Date.now()}`);
    let attempts = 0;
    system.registerProcessor(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
    });
    await system.add('t', {}, { attempts: 3, backoffMs: 100 });
    expect(await waitFor(() => attempts === 2)).toBe(true);
  });

  it('a queued job survives a redeploy: queued with no worker, picked up by the next instance', async () => {
    const name = `test-survive-${Date.now()}`;
    // Instance 1 enqueues and is shut down before any worker takes the job.
    const first = queue.getJobSystem(name);
    await first.add('t', { n: 42 }, { jobId: `survivor-${Date.now()}` });
    await queue.closeQueues();

    // Instance 2 starts, registers its worker, and processes it.
    const second = queue.getJobSystem(name);
    const seen = [];
    second.registerProcessor(async (job) => {
      seen.push(job.data.n);
    });
    expect(await waitFor(() => seen.length === 1)).toBe(true);
    expect(seen[0]).toBe(42);
  });
});

describe('fallback when Redis is unreachable', () => {
  it('the limiter answers from memory instead of hanging or failing', async () => {
    await redis.closeRedis();
    process.env.REDIS_URL = 'redis://127.0.0.1:1'; // nothing listens there
    try {
      const app = appWith(rateLimit.createRateLimiter({ windowMs: 60 * 1000, max: 1 }));
      const started = Date.now();
      expect((await request(app).post('/auth/login')).status).toBe(200);
      expect((await request(app).post('/auth/login')).status).toBe(429);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(rateLimit.rateLimitStore()).toBe('memory');
    } finally {
      await redis.closeRedis();
      process.env.REDIS_URL = REDIS_URL;
      await ready(redis.getRedis());
    }
  });
});
