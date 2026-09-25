/**
 * Multi-instance safety for the scheduled jobs, the email flags, and the small
 * helpers added for scaling out (scale-prod).
 *
 *   - trial warning: sent ONCE even when two sweeps run concurrently
 *   - rollCycle: two concurrent sweeps roll a boundary once (one ledger pair)
 *   - admin alerts: two concurrent runs send one alert (atomic cooldown claim)
 *   - EMAIL_DRY_RUN sends nothing and logs no address or body
 *   - the console transport refuses to run in production
 *   - Cashfree webhook timestamp window (log-only helper)
 *   - AI retry delay: Retry-After honoured and capped, otherwise jittered
 *   - in-process queue: remembered jobIds expire (the old unbounded set)
 *   - /livez needs nothing; /health drains on shutdown
 */

import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

import { prisma, resetDb, createUser } from './helpers/db.js';

const require = createRequire(import.meta.url);
const mailer = require('../src/lib/email/index.js');
const { sendTrialEndingWarnings } = require('../src/jobs/trialJob.js');
const { sweepElapsedCycles } = require('../src/jobs/entitlementCycleJob.js');
const { runAlertChecks } = require('../src/jobs/alertJob.js');
const { checkWebhookTimestamp } = require('../src/lib/cashfree.js');
const { retryDelayMs, _setBackoff } = require('../src/lib/ai/router.js');
const { InMemoryJobQueue } = require('../src/lib/queue.js');
const health = require('../src/lib/health.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('trial-ending warning is sent once', () => {
  it('two sweeps running at the same moment send one email, and a later sweep sends none', async () => {
    const { user } = await createUser();
    await prisma.entitlement.update({
      where: { userId: user.id },
      data: { validUntil: new Date(Date.now() + DAY - 10 * 60 * 1000) },
    });
    const send = vi.spyOn(mailer, 'sendTrialEnding').mockResolvedValue({ id: 'x' });

    const [a, b] = await Promise.all([
      sendTrialEndingWarnings({ intervalMs: HOUR }),
      sendTrialEndingWarnings({ intervalMs: HOUR }),
    ]);
    expect(a + b).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    expect(await sendTrialEndingWarnings({ intervalMs: HOUR })).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);

    const e = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(e.trialWarningSentAt).toBeInstanceOf(Date);
  });

  it('a failed send releases the claim so a retry inside the window can send', async () => {
    const { user } = await createUser();
    await prisma.entitlement.update({
      where: { userId: user.id },
      data: { validUntil: new Date(Date.now() + DAY - 10 * 60 * 1000) },
    });
    const send = vi.spyOn(mailer, 'sendTrialEnding').mockRejectedValueOnce(new Error('provider down'));
    expect(await sendTrialEndingWarnings({ intervalMs: HOUR })).toBe(0);
    expect((await prisma.entitlement.findUnique({ where: { userId: user.id } })).trialWarningSentAt).toBeNull();

    send.mockResolvedValue({ id: 'x' });
    expect(await sendTrialEndingWarnings({ intervalMs: HOUR })).toBe(1);
  });
});

describe('entitlement cycle roll is once per boundary', () => {
  it('two concurrent sweeps roll an elapsed cycle once — one ledger pair, not two', async () => {
    const { user } = await createUser();
    const trial = await prisma.plan.findUnique({ where: { code: 'TRIAL' } });
    await prisma.entitlement.update({
      where: { userId: user.id },
      data: { cycleStartedAt: new Date(Date.now() - (trial.cycleLengthDays + 1) * DAY) },
    });

    const [a, b] = await Promise.all([sweepElapsedCycles(), sweepElapsedCycles()]);
    expect(a + b).toBe(1);

    // rollCycle writes one REPLY and one DRAFT ledger row per roll.
    const rows = await prisma.creditLedger.findMany({ where: { tenantId: user.id } });
    const rollRows = rows.filter((r) => ['EXPIRE', 'ROLLOVER'].includes(r.type));
    expect(rollRows).toHaveLength(2);
  });
});

describe('admin alert cooldown is atomic', () => {
  it('two concurrent alert runs for the same condition record and send it once', async () => {
    // A failed job run in the last 10 minutes trips the job_failure check.
    await prisma.jobRun.create({ data: { jobName: 'housekeeping', success: false, error: 'boom', finishedAt: new Date() } });

    await Promise.all([runAlertChecks(), runAlertChecks()]);

    const sent = await prisma.adminAuditLog.count({ where: { action: 'ALERT_SENT', targetId: 'job_failure' } });
    expect(sent).toBe(1);
  });
});

describe('EMAIL_DRY_RUN', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['EMAIL_DRY_RUN', 'NODE_ENV', 'RESEND_API_KEY']) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('sends nothing and logs only the type and a hashed recipient — never the address or a link', async () => {
    process.env.EMAIL_DRY_RUN = 'true';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await mailer.sendTrialEnding('real.customer@gmail.com', { daysLeft: 1, dashboardUrl: 'https://app.example.test/secret-link' });
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('[email:dry-run]');
    expect(out).not.toContain('real.customer@gmail.com');
    expect(out).not.toContain('secret-link');
    expect(mailer.activeTransport()).toBe('dry-run');
  });

  it('wins over a configured provider key', () => {
    process.env.EMAIL_DRY_RUN = 'true';
    process.env.RESEND_API_KEY = 're_test_not_real';
    expect(mailer.activeTransport()).toBe('dry-run');
  });

  it('production with no provider and no dry-run refuses to start (the console transport would log tokens)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_DRY_RUN;
    expect(() => mailer.assertSafeEmailTransport()).toThrow(/Refusing to start/);
    process.env.EMAIL_DRY_RUN = 'true';
    expect(mailer.assertSafeEmailTransport()).toBe('dry-run');
  });
});

describe('Cashfree webhook timestamp window (log-only)', () => {
  const now = 1_800_000_000_000;
  it('accepts milliseconds or seconds inside ±5 minutes', () => {
    expect(checkWebhookTimestamp(String(now - 60 * 1000), now).withinWindow).toBe(true);
    expect(checkWebhookTimestamp(String(Math.floor(now / 1000) + 120), now).withinWindow).toBe(true);
  });
  it('flags a stale or unparseable timestamp', () => {
    const stale = checkWebhookTimestamp(String(now - 6 * 60 * 1000), now);
    expect(stale.withinWindow).toBe(false);
    expect(stale.skewMs).toBe(6 * 60 * 1000);
    expect(checkWebhookTimestamp('not-a-number', now)).toEqual({ withinWindow: false, skewMs: null });
  });
});

describe('AI retry delay', () => {
  afterEach(() => _setBackoff([500, 1500]));

  it('honours Retry-After in seconds and as an HTTP date, capped at 10 s', () => {
    expect(retryDelayMs(1, { response: { status: 429, headers: { 'retry-after': '2' } } })).toBe(2000);
    expect(retryDelayMs(1, { response: { status: 429, headers: { 'retry-after': '120' } } })).toBe(10000);
    const inThree = new Date(Date.now() + 3000).toUTCString();
    const d = retryDelayMs(1, { response: { status: 503, headers: { 'retry-after': inThree } } });
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThanOrEqual(3000);
  });

  it('without Retry-After, jitters the backoff step to 50–150%', () => {
    _setBackoff([1000, 3000]);
    const samples = Array.from({ length: 50 }, () => retryDelayMs(1, new Error('network')));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(500);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1500);
    expect(new Set(samples).size, 'jittered, not fixed').toBeGreaterThan(1);
  });
});

describe('in-process queue: remembered jobIds expire', () => {
  it('dedupes a repeat jobId, then forgets it after the TTL instead of forever', async () => {
    const q = new InMemoryJobQueue('t');
    expect((await q.add('x', {}, { jobId: 'analyze-1' })).deduped).toBeUndefined();
    expect((await q.add('x', {}, { jobId: 'analyze-1' })).deduped).toBe(true);
    q._forgetOldJobIds(Date.now() + 7 * HOUR);
    expect(q._seenJobIds.size).toBe(0);
    expect((await q.add('x', {}, { jobId: 'analyze-1' })).deduped).toBeUndefined();
  });
});

describe('/livez and /health', () => {
  it('/livez answers without touching any dependency; /health drains once shutdown starts', async () => {
    const app = express();
    app.get('/livez', health.livezHandler);
    app.get('/health', health.publicHealthHandler);

    expect((await request(app).get('/livez')).body).toEqual({ status: 'ok' });
    expect((await request(app).get('/health')).status).toBe(200);

    health.markShuttingDown();
    expect((await request(app).get('/health')).status).toBe(503);
    expect((await request(app).get('/livez')).status).toBe(200);
  });
});
