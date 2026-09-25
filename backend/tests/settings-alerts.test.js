/**
 * Admin rebuild, Gate 7 — kill switches / settings, maintenance mode, alert
 * cron, business metrics, announcements.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAdmin, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const adminRoutes = require('../src/routes/admin.js');
const announcementRoutes = require('../src/routes/announcements.js');
const settings = require('../src/lib/settings.js');
const billingFlags = require('../src/lib/billingFlags.js');
const mailer = require('../src/lib/email');
const jobs = require('../src/jobs/index.js');
const { processMessageAnalysis } = require('../src/jobs/messageAnalysisJob.js');
const { runAlertChecks } = require('../src/jobs/alertJob.js');
const { isGuardedPath } = require('../src/lib/maintenance.js');

const ORIGIN = 'https://app.test.local';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
let app;
let ipSeq = 0;
const ip = () => `10.170.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(() => {
  app = buildTestApp({ admin: adminRoutes, mount: { '/api/announcements': announcementRoutes } });
});
beforeEach(async () => {
  await resetDb();
  settings.clearSettingsCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  settings.clearSettingsCache();
});

async function adminAgent({ stepUp = true } = {}) {
  const { admin, password } = await createAdmin();
  const agent = request.agent(app).set('Origin', ORIGIN).set('X-Forwarded-For', ip());
  expect((await agent.post('/api/admin/login').send({ email: admin.email, password })).status).toBe(200);
  if (stepUp) expect((await agent.post('/api/admin/step-up').send({ password })).status).toBe(200);
  return agent;
}

async function setFlag(key, value) {
  await settings.setSetting(key, value, null); // writes through to the cache
}

async function inboundMessage() {
  const { user } = await createUser();
  const account = await createAccount({ userId: user.id, withConversation: true });
  const conversation = await prisma.conversation.findFirst({ where: { instagramAccountId: account.id } });
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: 'inbound', content: 'secret dm body 123', igMessageId: uniq('mid') },
  });
  return { user, account, message };
}

describe('settings defaults match current production behaviour', () => {
  it('no rows → AI on, signups on, no maintenance, idle 30 min, enforcement from BILLING_ENABLED', async () => {
    expect(await settings.getSetting('ai_classification_enabled')).toBe(true);
    expect(await settings.getSetting('signups_enabled')).toBe(true);
    expect(await settings.getSetting('maintenance_mode')).toBe(false);
    expect(await settings.getSetting('user_session_idle_minutes')).toBe(30);

    const prev = process.env.BILLING_ENABLED;
    try {
      process.env.BILLING_ENABLED = 'true';
      expect(await settings.getSetting('enforce_subscriptions')).toBe(true);
      expect(billingFlags.isBillingEnabled()).toBe(true);
      process.env.BILLING_ENABLED = 'false';
      expect(await settings.getSetting('enforce_subscriptions')).toBe(false);
      expect(billingFlags.isBillingEnabled()).toBe(false);

      // A DB row overrides the env var either way.
      await setFlag('enforce_subscriptions', true);
      expect(billingFlags.isBillingEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.BILLING_ENABLED;
      else process.env.BILLING_ENABLED = prev;
    }
  });
});

describe('admin settings API', () => {
  it('kill switches need step-up + reason; the change is audited; bad values are refused', async () => {
    const noStep = await adminAgent({ stepUp: false });
    expect((await noStep.put('/api/admin/settings/flags/maintenance_mode').send({ value: true, reason: 'deploy window' })).status).toBe(403);

    const agent = await adminAgent();
    expect((await agent.put('/api/admin/settings/flags/maintenance_mode').send({ value: true })).status).toBe(400);
    expect((await agent.put('/api/admin/settings/flags/maintenance_mode').send({ value: 'yes', reason: 'deploy window' })).status).toBe(400);
    expect((await agent.put('/api/admin/settings/flags/user_session_idle_minutes').send({ value: 2, reason: 'too short' })).status).toBe(400);
    expect((await agent.put('/api/admin/settings/flags/no_such_key').send({ value: 1, reason: 'unknown key' })).status).toBe(404);

    const ok = await agent.put('/api/admin/settings/flags/maintenance_mode').send({ value: true, reason: 'deploy window' });
    expect(ok.status).toBe(200);
    expect(ok.body.value).toBe(true);
    const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'SETTING_CHANGE', targetId: 'maintenance_mode' } });
    expect(audit.reason).toBe('deploy window');

    const list = await agent.get('/api/admin/settings/flags');
    expect(list.status).toBe(200);
    expect(list.body.find((s) => s.key === 'maintenance_mode').value).toBe(true);

    const reset = await agent.delete('/api/admin/settings/flags/maintenance_mode').send({ reason: 'deploy finished' });
    expect(reset.status).toBe(200);
    expect(reset.body.value).toBe(false);
  });

  it('alert thresholds need a reason but no step-up', async () => {
    const agent = await adminAgent({ stepUp: false });
    const res = await agent.put('/api/admin/settings/flags/alert_ai_daily_cost_usd').send({ value: 12, reason: 'raise budget' });
    expect(res.status).toBe(200);
    expect(await settings.getSetting('alert_ai_daily_cost_usd')).toBe(12);
  });
});

describe('kill switches', () => {
  it('AI off: the message is skipped as ai_disabled, no provider call; turning AI on re-queues it', async () => {
    const aiService = require('../src/services/aiService.js');
    const aiSpy = vi.spyOn(aiService, 'analyzeConversation');
    await setFlag('ai_classification_enabled', false);
    const { message } = await inboundMessage();

    await processMessageAnalysis({ data: { messageId: message.id } });
    const after = await prisma.message.findUnique({ where: { id: message.id } });
    expect(after.aiStatus).toBe('skipped');
    expect(after.aiSkipReason).toBe('ai_disabled');
    expect(aiSpy).not.toHaveBeenCalled();

    const enqueue = vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue();
    const agent = await adminAgent();
    const res = await agent.put('/api/admin/settings/flags/ai_classification_enabled').send({ value: true, reason: 'provider back up' });
    expect(res.status).toBe(200);
    expect(res.body.requeued).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(message.id, { jobKey: 'ai-reenabled' });
    expect((await prisma.message.findUnique({ where: { id: message.id } })).aiStatus).toBe('pending');
  });

  it('signups off: register answers 403 SIGNUPS_CLOSED and creates no user', async () => {
    await setFlag('signups_enabled', false);
    const email = `${uniq('closed')}@test.codeback`;
    const res = await request(app)
      .post('/auth/register')
      .set('X-Forwarded-For', ip())
      .send({ name: 'No Entry', email, password: 'a-good-password-1', confirmPassword: 'a-good-password-1' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SIGNUPS_CLOSED');
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('maintenance: customer API 503s; admin, announcements, logout, webhooks and health stay up', async () => {
    await setFlag('maintenance_mode', true);
    const res = await request(app).post('/auth/login').set('X-Forwarded-For', ip()).send({ email: 'a@b.c', password: 'x' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MAINTENANCE');
    expect(res.headers['retry-after']).toBe('600');

    expect((await request(app).get('/api/announcements/active')).status).toBe(200);
    const agent = await adminAgent({ stepUp: false });
    expect((await agent.get('/api/admin/settings/flags')).status).toBe(200);

    for (const p of ['/webhook', '/webhooks/instagram', '/webhooks/cashfree', '/health', '/api/admin/users', '/auth/logout', '/data-deletion']) {
      expect(isGuardedPath(p), p).toBe(false);
    }
    expect(isGuardedPath('/api/conversations')).toBe(true);
  });
});

describe('alerts', () => {
  beforeEach(async () => {
    await createAdmin();
  });

  it('AI error rate over the threshold emails once, then cools down for an hour', async () => {
    const send = vi.spyOn(mailer, 'sendAdminOpsAlert').mockResolvedValue({ id: 'mock' });
    const rows = Array.from({ length: 10 }, (_, i) => ({
      provider: 'gemini', model: 'm', jobType: 'classification', latencyMs: 10, success: i >= 5,
    }));
    await prisma.aiCallLog.createMany({ data: rows });

    const first = await runAlertChecks();
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const titles = send.mock.calls.map((c) => c[1].title);
    expect(titles.some((t) => t.startsWith('AI error rate'))).toBe(true);

    send.mockClear();
    const second = await runAlertChecks();
    expect(second.suppressed).toBeGreaterThanOrEqual(1);
    expect(send.mock.calls.some((c) => c[1].title.startsWith('AI error rate'))).toBe(false);

    // After the hour the same condition alerts again.
    const later = await runAlertChecks({ now: Date.now() + HOUR + MIN });
    expect(later).toBeDefined();
  });

  it('quiet system → no alert; the threshold is read from settings', async () => {
    const send = vi.spyOn(mailer, 'sendAdminOpsAlert').mockResolvedValue({ id: 'mock' });
    await prisma.aiCallLog.create({ data: { provider: 'gemini', model: 'm', jobType: 'classification', latencyMs: 5, success: true, estimatedCost: 3 } });
    await setFlag('alert_db_ping_ms', 60000);
    let r = await runAlertChecks();
    expect(r.triggered).toBe(0);
    expect(send).not.toHaveBeenCalled();

    await setFlag('alert_ai_daily_cost_usd', 1);
    r = await runAlertChecks();
    expect(send.mock.calls.some((c) => c[1].title.startsWith('AI cost today'))).toBe(true);
  });

  it('a failed job and no webhooks with a connected account both alert; facts carry no DM text', async () => {
    const send = vi.spyOn(mailer, 'sendAdminOpsAlert').mockResolvedValue({ id: 'mock' });
    await setFlag('alert_db_ping_ms', 60000);
    await inboundMessage();
    await prisma.jobRun.create({ data: { jobName: 'ai_usage_rollup', startedAt: new Date(), finishedAt: new Date(), success: false, error: 'boom' } });
    await runAlertChecks();
    const titles = send.mock.calls.map((c) => c[1].title);
    expect(titles.some((t) => t.includes('job run'))).toBe(true);
    expect(titles.some((t) => t.startsWith('No Meta deliveries'))).toBe(true);
    expect(JSON.stringify(send.mock.calls)).not.toContain('secret dm body');
  });
});

describe('metrics', () => {
  it('returns counts only — never message content', async () => {
    await inboundMessage();
    const agent = await adminAgent({ stepUp: false });
    const res = await agent.get('/api/admin/metrics?days=7');
    expect(res.status).toBe(200);
    expect(res.body.signupsPerDay.reduce((a, r) => a + r.count, 0)).toBe(1);
    expect(res.body.dmsPerDay.reduce((a, r) => a + r.count, 0)).toBe(1);
    expect(res.body.activeInstagramAccounts).toBe(1);
    expect(res.body.trialToPaid).toEqual({ trials: 0, converted: 0, rate: 0 });
    expect(JSON.stringify(res.body)).not.toContain('secret dm body');
  });
});

describe('announcements', () => {
  it('admin creates one (reason + audit); the public feed shows it only inside its window', async () => {
    const agent = await adminAgent({ stepUp: false });
    const now = Date.now();
    expect((await agent.post('/api/admin/announcements').send({ message: 'Hi', startsAt: new Date(now).toISOString(), endsAt: new Date(now + HOUR).toISOString() })).status).toBe(400);
    expect(
      (await agent.post('/api/admin/announcements').send({ message: 'Backwards', reason: 'ops note', startsAt: new Date(now + HOUR).toISOString(), endsAt: new Date(now).toISOString() })).status
    ).toBe(400);

    const live = await agent.post('/api/admin/announcements').send({
      message: 'Scheduled maintenance tonight', type: 'warning', reason: 'ops note',
      startsAt: new Date(now - MIN).toISOString(), endsAt: new Date(now + HOUR).toISOString(),
    });
    expect(live.status).toBe(201);
    await agent.post('/api/admin/announcements').send({
      message: 'Future news', reason: 'ops note', startsAt: new Date(now + HOUR).toISOString(), endsAt: new Date(now + 2 * HOUR).toISOString(),
    });
    expect(await prisma.adminAuditLog.count({ where: { action: 'ANNOUNCEMENT_CREATE' } })).toBe(2);

    let feed = await request(app).get('/api/announcements/active');
    expect(feed.body.map((a) => a.message)).toEqual(['Scheduled maintenance tonight']);
    expect(Object.keys(feed.body[0]).sort()).toEqual(['endsAt', 'id', 'message', 'type']);

    const off = await agent.put(`/api/admin/announcements/${live.body.id}`).send({ isActive: false, reason: 'resolved' });
    expect(off.status).toBe(200);
    feed = await request(app).get('/api/announcements/active');
    expect(feed.body).toEqual([]);
  });
});
