/**
 * Admin rebuild, Gate 3B — Instagram long-lived token auto-refresh.
 *
 * Meta is mocked at lib/instagram.js (the HTTP boundary for Graph calls).
 * Tokens used here are recognisable strings, so "never in a log or a
 * response" can be asserted literally.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAdmin, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const instagram = require('../src/lib/instagram.js');
const mailer = require('../src/lib/email/index.js');
const { readAccountToken, writeAccountToken } = require('../src/lib/crypto.js');
const { refreshDueTokens } = require('../src/lib/tokenRefresh.js');
const { runTokenMaintenance } = require('../src/jobs/tokenRefreshJob.js');
const { recordJobRun } = require('../src/jobs/jobRuns.js');
const adminRoutes = require('../src/routes/admin.js');

const DAY = 24 * 60 * 60 * 1000;
const ORIGIN = 'https://app.test.local';
const OLD_TOKEN = 'IGQ-OLD-TOKEN-must-never-be-logged';
const NEW_TOKEN = 'IGQ-NEW-TOKEN-must-never-be-logged';

let app;
beforeAll(() => {
  app = buildTestApp({ admin: adminRoutes });
});

let logged;
beforeEach(async () => {
  await resetDb();
  logged = [];
  for (const level of ['log', 'warn', 'error', 'info']) {
    const original = console[level];
    vi.spyOn(console, level).mockImplementation((...args) => {
      logged.push(args.map(String).join(' '));
      return original.apply(console, args.slice(0, 0)); // keep output quiet
    });
  }
  vi.spyOn(mailer, 'sendAdminOpsAlert').mockResolvedValue({ id: 'mock' });
  vi.spyOn(mailer, 'sendTokenExpiry').mockResolvedValue({ id: 'mock' });
});

afterEach(() => vi.restoreAllMocks());

async function account({ expiresInDays, tokenStatus = 'VALID', connectionStatus = 'CONNECTED' }) {
  const { user } = await createUser({});
  return prisma.instagramAccount.create({
    data: {
      userId: user.id,
      igUserId: uniq('ig'),
      igUsername: uniq('handle'),
      tokenStatus,
      connectionStatus,
      tokenExpiresAt: new Date(Date.now() + expiresInDays * DAY),
      ...writeAccountToken(OLD_TOKEN),
    },
  });
}

const noTokenAnywhere = (...texts) => {
  for (const t of [...logged, ...texts]) {
    expect(t).not.toContain('must-never-be-logged');
  }
};

describe('refresh', () => {
  it('refreshes a token within 10 days of expiry, stores it encrypted, and moves the expiry out 60 days', async () => {
    const acc = await account({ expiresInDays: 5 });
    const spy = vi.spyOn(instagram, 'refreshLongLivedToken').mockResolvedValue({ access_token: NEW_TOKEN, token_type: 'bearer', expires_in: 60 * 24 * 3600 });

    const result = await refreshDueTokens();
    expect(result).toMatchObject({ due: 1, refreshed: 1, failed: 0 });
    expect(spy).toHaveBeenCalledWith(OLD_TOKEN);

    const row = await prisma.instagramAccount.findUnique({ where: { id: acc.id } });
    expect(readAccountToken(row)).toBe(NEW_TOKEN);
    expect(row.tokenCiphertext).not.toContain(NEW_TOKEN);
    expect(row.accessToken).not.toContain(NEW_TOKEN);
    expect((row.tokenExpiresAt.getTime() - Date.now()) / DAY).toBeGreaterThan(59.9);
    expect(row.tokenRefreshedAt).not.toBeNull();
    expect(row.tokenStatus).toBe('VALID');
    noTokenAnywhere(JSON.stringify(result));
  });

  it('skips tokens outside the window, already-expired tokens, dead tokens and disconnected accounts', async () => {
    await account({ expiresInDays: 30 }); // not due yet
    await account({ expiresInDays: 59.5 }); // under a day old — Meta would refuse
    await account({ expiresInDays: -1 }); // already expired — Meta refuses; flagged instead
    await account({ expiresInDays: 5, tokenStatus: 'NEEDS_RECONNECT' });
    await account({ expiresInDays: 5, connectionStatus: 'DISCONNECTED' });
    const spy = vi.spyOn(instagram, 'refreshLongLivedToken');

    const result = await refreshDueTokens();
    expect(result.due).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('failure', () => {
  it('a transient failure keeps the token VALID, records a safe code, and alerts the admins once', async () => {
    await createAdmin();
    const a = await account({ expiresInDays: 3 });
    const b = await account({ expiresInDays: 4 });
    vi.spyOn(instagram, 'refreshLongLivedToken').mockRejectedValue(
      Object.assign(new Error('Request failed with status code 503'), {
        response: { status: 503, data: { error: { message: `upstream detail for ${OLD_TOKEN}` } } },
        config: { params: { access_token: OLD_TOKEN } },
      })
    );

    const result = await refreshDueTokens({ onFailures: require('../src/jobs/tokenRefreshJob.js').alertFailures });
    expect(result).toMatchObject({ due: 2, refreshed: 0, failed: 2, markedReconnect: 0 });

    for (const id of [a.id, b.id]) {
      const row = await prisma.instagramAccount.findUnique({ where: { id } });
      expect(row.tokenStatus).toBe('VALID');
      expect(row.tokenRefreshError).toBe('HTTP_503');
      expect(row.tokenRefreshFailedAt).not.toBeNull();
    }
    expect(mailer.sendAdminOpsAlert, 'one digest, not one email per account').toHaveBeenCalledTimes(1);
    const [, payload] = mailer.sendAdminOpsAlert.mock.calls[0];
    noTokenAnywhere(JSON.stringify(payload));
  });

  it('a token Meta calls dead is marked NEEDS_RECONNECT and the customer is told once', async () => {
    const acc = await account({ expiresInDays: 3 });
    vi.spyOn(instagram, 'refreshLongLivedToken').mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        response: { status: 400, data: { error: { code: 190, message: 'Error validating access token' } } },
      })
    );
    const result = await refreshDueTokens();
    expect(result.markedReconnect).toBe(1);
    const row = await prisma.instagramAccount.findUnique({ where: { id: acc.id } });
    expect(row.tokenStatus).toBe('NEEDS_RECONNECT');
    expect(row.tokenRefreshError).toBe('META_190');
    expect(mailer.sendTokenExpiry).toHaveBeenCalledTimes(1);
  });
});

describe('the scheduled job', () => {
  it('also flags already-expired tokens, and is recorded as a job run', async () => {
    const expired = await account({ expiresInDays: -2 });
    vi.spyOn(instagram, 'refreshLongLivedToken');
    const result = await recordJobRun('instagram_token_refresh', () => runTokenMaintenance());
    expect(result.flaggedExpired).toBe(1);
    expect((await prisma.instagramAccount.findUnique({ where: { id: expired.id } })).tokenStatus).toBe('NEEDS_RECONNECT');
    const run = await prisma.jobRun.findFirst({ where: { jobName: 'instagram_token_refresh' } });
    expect(run.success).toBe(true);
    expect(run.details).toMatchObject({ flaggedExpired: 1 });
  });
});

describe('admin surfaces never carry a token', () => {
  it('the refresh button and the health page show outcomes and codes only', async () => {
    const acc = await account({ expiresInDays: 3 });
    const { admin, password } = await createAdmin();
    const agent = request.agent(app).set('Origin', ORIGIN).set('X-Forwarded-For', '10.90.0.1');
    await agent.post('/api/admin/login').send({ email: admin.email, password });

    vi.spyOn(instagram, 'refreshLongLivedToken').mockRejectedValue(
      Object.assign(new Error('boom'), { response: { status: 500, data: { error: { message: OLD_TOKEN } } } })
    );
    const fail = await agent.post(`/api/admin/accounts/${acc.id}/refresh-token`).send({ reason: 'expiring soon' });
    expect(fail.status).toBe(502);

    const health = await agent.get('/api/admin/health');
    expect(health.status).toBe(200);
    expect(health.body.instagramTokens.refreshFailures.map((f) => f.id)).toContain(acc.id);

    instagram.refreshLongLivedToken.mockResolvedValue({ access_token: NEW_TOKEN, expires_in: 60 * 24 * 3600 });
    const ok = await agent.post(`/api/admin/accounts/${acc.id}/refresh-token`).send({ reason: 'retry' });
    expect(ok.status).toBe(200);
    expect(ok.body.account.tokenStatus).toBe('VALID');

    noTokenAnywhere(JSON.stringify(fail.body), JSON.stringify(health.body), JSON.stringify(ok.body));
  });
});
