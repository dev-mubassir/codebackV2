/**
 * Admin rebuild, Gate 1 — login security, the admin session, step-up, audit.
 *
 * Replaces the retired shared-cookie / environment-credential suites
 * (admin-session.test.js, scopes-and-admin.test.js M10), which are skipped
 * with a TEMP marker. Every "rejects" assertion here has a positive control
 * beside it, so a route that 404s for EVERYONE cannot pass as "secure".
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';

import { buildTestApp, adminSessionIdFrom } from './helpers/app.js';
import { prisma, resetDb, createUser, createAdmin, createAccount } from './helpers/db.js';

const require = createRequire(import.meta.url);
const mailer = require('../src/lib/email/index.js');
const instagram = require('../src/lib/instagram.js');
const adminRoutes = require('../src/routes/admin.js');
// Mounted as in production, so a request the admin router does not match
// meets the customer router's blanket requireAuth exactly as it would live.
const apiRoutes = require('../src/routes/api.js');
const { csvCell } = adminRoutes;

const ORIGIN = 'https://app.test.local'; // FRONTEND_URL in tests/setup/env.js
const NOT_FOUND = { error: 'Not found.' };
const MIN = 60 * 1000;

let app;
let ipCounter = 0;
const nextIp = () => `10.40.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

beforeAll(() => {
  app = buildTestApp({ admin: adminRoutes, mount: { '/api': apiRoutes } });
});

let alertSpy;
beforeEach(async () => {
  await resetDb();
  mailer._resetQuota();
  alertSpy = vi.spyOn(mailer, 'sendAdminSecurityAlert').mockResolvedValue({ id: 'mocked', transport: 'mock' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** An agent signed in as an admin, from a fresh IP. */
async function adminAgent({ email, password } = {}) {
  const created = email ? { admin: await prisma.adminUser.findUnique({ where: { email } }), password } : await createAdmin();
  const agent = request.agent(app);
  const ip = nextIp();
  const res = await agent
    .post('/api/admin/login')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', ip)
    .send({ email: created.admin.email, password: created.password });
  expect(res.status, 'admin fixture login must succeed').toBe(200);
  return { agent, admin: created.admin, password: created.password, ip, res };
}

async function customerAgent() {
  const { user, password } = await createUser({});
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password });
  expect(res.status, 'customer fixture login must succeed').toBe(200);
  return { agent, user };
}

function login(agentOrApp, email, password, ip = nextIp()) {
  return agentOrApp.post('/api/admin/login').set('Origin', ORIGIN).set('X-Forwarded-For', ip).send({ email, password });
}

async function stepUp(agent, password) {
  // Own IP: the step-up limiter is per IP, and unset every test would share
  // 127.0.0.1 and trip it — the limiter working, not the step-up failing.
  const res = await agent.post('/api/admin/step-up').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).send({ password });
  expect(res.status, 'step-up must succeed').toBe(200);
}

/** Every route actually registered on the admin router, read from Express itself. */
function registeredRoutes() {
  const routes = [];
  for (const layer of adminRoutes.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      routes.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }
  return routes;
}
const concrete = (path) => `/api/admin${path.replace(/:[A-Za-z]+/g, '00000000-0000-0000-0000-000000000000')}`;

function send(agent, { method, path }, body = {}) {
  const url = concrete(path);
  const req = agent[method.toLowerCase()](url);
  if (method !== 'GET') req.set('Origin', ORIGIN).send(body);
  return req;
}

// ---------------------------------------------------------------------------

describe('admin login', () => {
  it('positive control: a correct admin login gets access', async () => {
    const { agent, res } = await adminAgent();

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('siffty.admin.sid='));
    expect(cookie, 'admin login must issue the ADMIN cookie').toBeTruthy();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/admin/i);
    expect(res.headers['set-cookie'].some((c) => c.startsWith('codeback.sid=')), 'must not touch the customer cookie').toBe(false);

    expect((await agent.get('/api/admin/me')).status).toBe(200);
    expect((await agent.get('/api/admin/stats')).status).toBe(200);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const { admin } = await createAdmin();
    const wrong = await login(request(app), admin.email, 'definitely-not-the-password');
    const unknown = await login(request(app), 'nobody-here@test.codeback', 'definitely-not-the-password');

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('issues a fresh admin session id on every login', async () => {
    const { admin, password } = await createAdmin();
    const agent = request.agent(app);
    const first = adminSessionIdFrom(await login(agent, admin.email, password));
    const second = adminSessionIdFrom(await login(agent, admin.email, password));
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('refuses a login with no Origin header', async () => {
    const { admin, password } = await createAdmin();
    const res = await request(app).post('/api/admin/login').set('X-Forwarded-For', nextIp()).send({ email: admin.email, password });
    expect(res.status).toBe(403);
  });

  it('rate-limits login attempts per IP', async () => {
    const ip = nextIp();
    let last;
    for (let i = 0; i < 11; i += 1) last = await login(request(app), `nobody${i}@test.codeback`, 'x', ip);
    expect(last.status).toBe(429);
  });

  it('sends a login alert with time, IP and user agent (mocked at the email boundary)', async () => {
    const { admin, password } = await createAdmin();
    await request(app)
      .post('/api/admin/login')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', '10.99.0.7')
      .set('User-Agent', 'GateOneTestAgent/1.0')
      .send({ email: admin.email, password });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [to, { kind, facts }] = alertSpy.mock.calls[0];
    expect(to).toBe(admin.email);
    expect(kind).toBe('login');
    expect(facts.ip).toBe('10.99.0.7');
    expect(facts['user agent']).toBe('GateOneTestAgent/1.0');
    expect(Number.isNaN(Date.parse(facts.time))).toBe(false);
  });
});

describe('lockout', () => {
  it('locks for 15 minutes after 5 failures, even for the right password, and alerts once', async () => {
    const { admin, password } = await createAdmin();
    for (let i = 0; i < 4; i += 1) {
      expect((await login(request(app), admin.email, 'wrong-password-attempt')).status).toBe(401);
    }
    expect((await prisma.adminUser.findUnique({ where: { id: admin.id } })).lockedUntil, 'not locked after 4').toBeNull();

    await login(request(app), admin.email, 'wrong-password-attempt');
    const locked = await prisma.adminUser.findUnique({ where: { id: admin.id } });
    expect(locked.lockedUntil).not.toBeNull();
    const minutes = (locked.lockedUntil.getTime() - Date.now()) / MIN;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    // The right password is refused while locked — with the SAME generic body.
    const during = await login(request(app), admin.email, password);
    expect(during.status).toBe(401);
    expect(during.body).toEqual({ error: 'That email or password is not right.' });

    const lockoutAlerts = alertSpy.mock.calls.filter(([, p]) => p.kind === 'lockout');
    expect(lockoutAlerts).toHaveLength(1);
    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_LOCKOUT', adminId: admin.id } })).toBe(1);
  });

  it('positive control: the right password works again once the lock has passed', async () => {
    const { admin, password } = await createAdmin();
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedAttempts: 5, lockedUntil: new Date(Date.now() - 1000) },
    });
    const res = await login(request(app), admin.email, password);
    expect(res.status).toBe(200);
    const after = await prisma.adminUser.findUnique({ where: { id: admin.id } });
    expect(after.failedAttempts).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });
});

describe('every admin route is 404 to anyone who is not an admin', () => {
  const routes = registeredRoutes();

  it('knows about the routes it is looping over', () => {
    // Guards against the loop below silently running over nothing.
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContainEqual({ method: 'GET', path: '/stats' });
  });

  it('a logged-in CUSTOMER gets 404 on every route except /login', async () => {
    const { agent } = await customerAgent();
    for (const route of routes) {
      if (route.path === '/login') continue;
      const res = await send(agent, route);
      expect(res.status, `${route.method} ${route.path}`).toBe(404);
      expect(res.body, `${route.method} ${route.path}`).toEqual(NOT_FOUND);
    }
  });

  it('an anonymous visitor gets 404 on every route except /login', async () => {
    for (const route of routes) {
      if (route.path === '/login') continue;
      const res = await send(request(app), route);
      expect(res.status, `${route.method} ${route.path}`).toBe(404);
      expect(res.body, `${route.method} ${route.path}`).toEqual(NOT_FOUND);
    }
  });

  it('positive control: an admin (with step-up) reaches every route', async () => {
    const { agent, password } = await adminAgent();
    await stepUp(agent, password);
    // Refunds call Cashfree; stub the service so this stays a routing test.
    const refundService = require('../src/services/refundService.js');
    vi.spyOn(refundService, 'getRefundEligibility').mockResolvedValue({ eligible: false });
    vi.spyOn(refundService, 'initiateRefund').mockRejectedValue(Object.assign(new Error('x'), { status: 400, body: { error: 'stub' } }));
    vi.spyOn(refundService, 'syncRefund').mockRejectedValue(Object.assign(new Error('x'), { status: 404, body: { error: 'stub' } }));

    for (const route of routes) {
      if (route.path === '/login' || route.path === '/logout') continue;
      const res = await send(agent, route);
      expect(res.body, `${route.method} ${route.path} must not be the generic 404`).not.toEqual(NOT_FOUND);
    }
  });

  it('a customer session does not become an admin session, and vice versa', async () => {
    const { agent, user } = await customerAgent();
    const { admin, password } = await createAdmin();
    await login(agent, admin.email, password);

    const me = await agent.get('/auth/me');
    expect(me.status, 'the customer session survives an admin login in the same browser').toBe(200);
    expect(me.body.id).toBe(user.id);

    const adminOnly = request.agent(app);
    await login(adminOnly, admin.email, password);
    expect((await adminOnly.get('/auth/me')).status, 'admin grants no customer identity').toBe(401);
  });
});

describe('admin mutations require an Origin header', () => {
  it('rejects a missing or foreign Origin, and accepts the allowlisted one', async () => {
    const { agent } = await adminAgent();
    expect((await agent.post('/api/admin/activity').send({})).status).toBe(403);
    expect((await agent.post('/api/admin/activity').set('Origin', 'https://evil.example').send({})).status).toBe(403);
    expect((await agent.post('/api/admin/activity').set('Origin', ORIGIN).send({})).status).toBe(200);
  });
});

describe('idle and absolute timeouts', () => {
  it('expires after 30 idle minutes, and a GET does not count as activity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent } = await adminAgent();

    vi.advanceTimersByTime(20 * MIN);
    expect((await agent.get('/api/admin/me')).status).toBe(200);

    vi.advanceTimersByTime(11 * MIN); // 31 minutes since the last ACTIVITY
    const res = await agent.get('/api/admin/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_SESSION_EXPIRED');
  });

  it('positive control: the heartbeat keeps an active session alive', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent } = await adminAgent();

    vi.advanceTimersByTime(20 * MIN);
    expect((await agent.post('/api/admin/activity').set('Origin', ORIGIN).send({})).status).toBe(200);
    vi.advanceTimersByTime(20 * MIN); // 40 since login, 20 since activity
    expect((await agent.get('/api/admin/me')).status).toBe(200);
  });

  it('ends at 8 hours however active the admin is', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent } = await adminAgent();
    for (let i = 0; i < 24; i += 1) {
      vi.advanceTimersByTime(20 * MIN);
      const beat = await agent.post('/api/admin/activity').set('Origin', ORIGIN).send({});
      if (i < 23) expect(beat.status, `heartbeat at ${(i + 1) * 20} minutes`).toBe(200);
    }
    vi.advanceTimersByTime(20 * MIN); // 8h20m since login
    const res = await agent.get('/api/admin/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_SESSION_EXPIRED');
  });
});

describe('step-up', () => {
  it('blocks a destructive action without it, and allows it within 5 minutes after', async () => {
    const { agent, password } = await adminAgent();
    const prune = () => agent.post('/api/admin/logs/prune').set('Origin', ORIGIN).send({ days: 30, reason: 'routine cleanup' });

    const blocked = await prune();
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('STEP_UP_REQUIRED');

    const wrong = await agent.post('/api/admin/step-up').set('Origin', ORIGIN).send({ password: 'not-my-password' });
    expect(wrong.status).toBe(403);
    expect((await prune()).status, 'a failed step-up opens nothing').toBe(403);

    await stepUp(agent, password);
    expect((await prune()).status, 'positive control').toBe(200);
  });

  it('closes again after 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent, password } = await adminAgent();
    await stepUp(agent, password);
    vi.advanceTimersByTime(5 * MIN + 1000);
    const res = await agent.post('/api/admin/logs/prune').set('Origin', ORIGIN).send({ days: 30, reason: 'routine cleanup' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('STEP_UP_REQUIRED');
  });

  it('counts wrong step-up passwords toward the lockout and ends the session', async () => {
    const { agent, admin } = await adminAgent();
    let res;
    for (let i = 0; i < 5; i += 1) {
      res = await agent.post('/api/admin/step-up').set('Origin', ORIGIN).send({ password: 'guessing-wrong' });
    }
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_SESSION_EXPIRED');
    expect((await prisma.adminUser.findUnique({ where: { id: admin.id } })).lockedUntil).not.toBeNull();
    expect((await agent.get('/api/admin/me')).status).not.toBe(200);
  });

  it('guards the CSV exports', async () => {
    const { agent, password } = await adminAgent();
    expect((await agent.get('/api/admin/users/export/csv')).status).toBe(403);
    await stepUp(agent, password);
    expect((await agent.get('/api/admin/users/export/csv')).status).toBe(200);
  });
});

describe('change own password', () => {
  it('keeps this session, ends every other admin session, and enforces 16 characters', async () => {
    const a = await adminAgent();
    const b = await adminAgent({ email: a.admin.email, password: a.password });
    const change = (body) => a.agent.post('/api/admin/password').set('Origin', ORIGIN).send(body);

    expect((await change({ currentPassword: a.password, newPassword: 'too-short' })).status).toBe(400);
    expect((await change({ currentPassword: 'wrong-current-password', newPassword: 'x'.repeat(20) })).status).toBe(403);

    const newPassword = 'a-brand-new-admin-password';
    expect((await change({ currentPassword: a.password, newPassword })).status).toBe(200);

    expect((await a.agent.get('/api/admin/me')).status, 'the changing session survives').toBe(200);
    const other = await b.agent.get('/api/admin/me');
    expect(other.status, 'every other session ends').toBe(401);

    expect((await login(request(app), a.admin.email, a.password)).status).toBe(401);
    expect((await login(request(app), a.admin.email, newPassword)).status).toBe(200);
    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_PASSWORD_CHANGE' } })).toBe(1);
  });
});

describe('audit trail', () => {
  it('records login success and failure, including failures against unknown addresses', async () => {
    const { admin } = await adminAgent();
    await login(request(app), admin.email, 'wrong-password-here');
    await login(request(app), 'ghost@test.codeback', 'whatever-password');

    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_LOGIN_SUCCESS', adminId: admin.id } })).toBe(1);
    expect(await prisma.adminAuditLog.count({ where: { action: 'ADMIN_LOGIN_FAILURE', adminId: admin.id } })).toBe(1);
    const ghost = await prisma.adminAuditLog.findFirst({ where: { action: 'ADMIN_LOGIN_FAILURE', adminId: null } });
    expect(ghost).not.toBeNull();
    expect(ghost.ip).toBeTruthy();
  });

  it('records a mutation with its reason and before/after, and requires the reason', async () => {
    const { agent, admin } = await adminAgent();
    const { user } = await createUser({});
    const url = `/api/admin/users/${user.id}/suspend`;

    expect((await agent.post(url).set('Origin', ORIGIN).send({ suspend: true })).status, 'no reason, no action').toBe(400);
    expect((await prisma.user.findUnique({ where: { id: user.id } })).isSuspended).toBe(false);

    expect((await agent.post(url).set('Origin', ORIGIN).send({ suspend: true, reason: 'chargeback abuse' })).status).toBe(200);
    const row = await prisma.adminAuditLog.findFirst({ where: { action: 'USER_SUSPEND' } });
    expect(row.adminId).toBe(admin.id);
    expect(row.targetId).toBe(user.id);
    expect(row.reason).toBe('chargeback abuse');
    expect(row.before).toEqual({ isSuspended: false });
    expect(row.after).toEqual({ isSuspended: true });
  });
});

describe('suspension', () => {
  it('ends the suspended customer session at once, and leaves other tenants alone', async () => {
    const victim = await customerAgent();
    const bystander = await customerAgent();
    const { agent } = await adminAgent();

    await agent.post(`/api/admin/users/${victim.user.id}/suspend`).set('Origin', ORIGIN).send({ suspend: true, reason: 'abuse report' });

    expect((await victim.agent.get('/auth/me')).status).not.toBe(200);
    expect((await bystander.agent.get('/auth/me')).status).toBe(200);
  });
});

describe('retired endpoints are gone', () => {
  // DELETE /users/:id returned in Gate 5 on the safe deletion path — see
  // tests/user-management.test.js. The account hard-delete stays gone.
  it('impersonation, the DM viewer and the unsafe account delete no longer exist', async () => {
    const { agent, password } = await adminAgent();
    await stepUp(agent, password);
    const { user } = await createUser({});
    const account = await createAccount({ userId: user.id });

    const probes = [
      agent.post(`/api/admin/users/${user.id}/impersonate`).set('Origin', ORIGIN).send({}),
      agent.post('/api/admin/impersonate/exit').set('Origin', ORIGIN).send({}),
      agent.get('/api/admin/support/conversations/any-id'),
      agent.delete(`/api/admin/accounts/${account.id}`).set('Origin', ORIGIN).send({ reason: 'test' }),
    ];
    for (const res of await Promise.all(probes)) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(await prisma.instagramAccount.findUnique({ where: { id: account.id } })).not.toBeNull();
  });
});

describe('privacy and the fixed bugs', () => {
  it('never returns DM text from any admin read', async () => {
    const SECRET = 'SECRET-DM-TEXT-0451';
    const { user } = await createUser({});
    const account = await createAccount({ userId: user.id, withConversation: true });
    const conversation = await prisma.conversation.findFirst({ where: { instagramAccountId: account.id } });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessage: SECRET } });
    await prisma.message.create({ data: { conversationId: conversation.id, direction: 'inbound', content: SECRET } });
    await prisma.webhookLog.create({
      data: { instagramAccountId: account.id, igUserId: account.igUserId, eventType: 'messaging', status: 'FAILED', payload: JSON.stringify({ text: SECRET }), errorMessage: `Invalid call\n  content: "${SECRET}"` },
    });

    const { agent } = await adminAgent();
    const reads = [
      '/api/admin/stats',
      '/api/admin/users',
      `/api/admin/users/${user.id}`,
      '/api/admin/accounts',
      '/api/admin/logs/webhooks',
      '/api/admin/health',
      `/api/admin/support/search?q=${encodeURIComponent(user.email)}`,
    ];
    for (const url of reads) {
      const res = await agent.get(url);
      expect(res.status, url).toBe(200);
      expect(JSON.stringify(res.body), url).not.toContain(SECRET);
    }
  });

  it('validates prune days — no negative, zero, fractional or string values', async () => {
    const { agent, password } = await adminAgent();
    await stepUp(agent, password);
    for (const days of [-1, 0, 3, 30.5, '30', 1000]) {
      const res = await agent.post('/api/admin/logs/prune').set('Origin', ORIGIN).send({ days, reason: 'cleanup' });
      expect(res.status, `days=${JSON.stringify(days)}`).toBe(400);
    }
  });

  it('neutralises spreadsheet formulas and quotes in CSV cells', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    for (const lead of ['+', '-', '@', '\t', '\r']) {
      expect(csvCell(`${lead}1`).startsWith(`"'${lead}`)).toBe(true);
    }
    expect(csvCell('plain')).toBe('"plain"');
  });

  it('mark-needs-reconnect returns no token columns', async () => {
    const { user } = await createUser({});
    const account = await createAccount({ userId: user.id });
    const { agent } = await adminAgent();
    const res = await agent
      .post(`/api/admin/accounts/${account.id}/mark-needs-reconnect`)
      .set('Origin', ORIGIN)
      .send({ reason: 'customer reported broken inbox' });
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    for (const key of ['accessToken', 'tokenCiphertext', 'tokenIv', 'tokenAuthTag']) expect(body).not.toContain(key);
  });

  it('refresh-token never passes Meta error text to the browser', async () => {
    const { user } = await createUser({});
    const account = await createAccount({ userId: user.id });
    vi.spyOn(instagram, 'refreshLongLivedToken').mockRejectedValue(
      Object.assign(new Error('META-INTERNAL-DETAIL fbtrace_id=abc'), { response: { data: { error: { message: 'META-INTERNAL-DETAIL' } } } })
    );
    const { agent } = await adminAgent();
    const res = await agent.post(`/api/admin/accounts/${account.id}/refresh-token`).set('Origin', ORIGIN).send({ reason: 'token expiring' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('META-INTERNAL-DETAIL');
    expect(res.body.details).toBeUndefined();
  });
});

describe('admin email bucket', () => {
  it('10/day, 3 held for lockouts; never touches the shared cap or the degraded flag', async () => {
    const quota = require('../src/lib/email/quota.js');
    alertSpy.mockRestore(); // exercise the real deliver() path (console transport in tests)
    mailer._resetQuota();
    mailer._resetHealth();
    const send = (kind) => mailer.sendAdminSecurityAlert('owner@siffty.example', { kind, facts: { time: 'now' } });

    for (let i = 0; i < 7; i += 1) await send('login');
    await expect(send('login'), 'routine sign-in alerts stop at 7').rejects.toThrow(/quota/i);

    // Positive control: the reserve is still there for a real attack warning.
    for (let i = 0; i < 3; i += 1) await expect(send('lockout')).resolves.toBeTruthy();
    await expect(send('lockout'), 'and the bucket as a whole stops at 10').rejects.toThrow(/quota/i);

    const stats = quota.stats();
    expect(stats.adminSentToday).toBe(10);
    expect(stats.sentToday, 'admin mail never counts against the shared 80').toBe(0);
    expect(mailer.isDegraded(), 'a full admin bucket must not degrade customer mail').toBe(false);

    // Positive control: customer critical mail still goes out.
    await expect(mailer.sendPasswordReset('someone@siffty.example', { url: 'https://x', expiresInMinutes: 30 })).resolves.toBeTruthy();
  });
});

describe('login timing', () => {
  it('an unknown email and a locked account answer about as slowly as a wrong password', async () => {
    const { admin } = await createAdmin();
    const locked = await createAdmin();
    await prisma.adminUser.update({ where: { id: locked.admin.id }, data: { lockedUntil: new Date(Date.now() + 60000) } });
    const timed = async (email) => {
      const start = process.hrtime.bigint();
      for (let i = 0; i < 3; i += 1) await login(request(app), email, 'some-wrong-password');
      return Number(process.hrtime.bigint() - start) / 3e6;
    };
    // wrong-password first: each one also counts toward that admin's lockout,
    // and 3 stays under the threshold.
    const wrong = await timed(admin.email);
    const unknown = await timed('nobody-at-all@test.codeback');
    const lockedMs = await timed(locked.admin.email);
    // Generous: catches a skipped verify (answers in a few ms), not noise.
    expect(unknown).toBeGreaterThan(wrong * 0.5);
    expect(lockedMs).toBeGreaterThan(wrong * 0.5);
  });

  it('the dummy verify costs about what a real wrong-password verify costs', async () => {
    const { hashPassword, verifyPassword, burnEquivalentWork } = require('../src/lib/password.js');
    const hash = await hashPassword('the-real-password-0000');
    const time = async (fn) => {
      const start = process.hrtime.bigint();
      for (let i = 0; i < 5; i += 1) await fn();
      return Number(process.hrtime.bigint() - start) / 5e6;
    };
    await burnEquivalentWork('warm'); // first call pays one-off setup
    const real = await time(() => verifyPassword('wrong-guess', hash));
    const dummy = await time(() => burnEquivalentWork('wrong-guess'));
    // Generous bound: this guards against the dummy silently becoming a
    // no-op (a hash that fails to parse returns in microseconds), not
    // against scheduler noise.
    expect(dummy).toBeGreaterThan(real * 0.5);
  });
});

describe('admin CLI output hygiene', () => {
  it('scrubs database URLs and password parameters from anything it prints', () => {
    const { scrub } = require('../scripts/lib/adminCli.js');
    const out = scrub("Can't reach postgresql://svc:s3cr3t@db.internal:5432/app?sslmode=require password=hunter2");
    expect(out).not.toContain('s3cr3t');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('db.internal');
  });
});

describe('no customer attribute confers admin', () => {
  it('role=ADMIN, a verified ADMIN_EMAILS match, or a matching Instagram handle all get 404', async () => {
    const previous = process.env.ADMIN_EMAILS;
    try {
      const { user, password } = await createUser({ emailVerified: true });
      const account = await createAccount({ userId: user.id });
      await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      process.env.ADMIN_EMAILS = `${user.email},${account.igUsername}`;

      const agent = request.agent(app);
      expect((await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password })).status).toBe(200);

      for (const url of ['/api/admin/me', '/api/admin/stats', '/api/admin/users']) {
        const res = await agent.get(url);
        expect(res.status, url).toBe(404);
        expect(res.body, url).toEqual(NOT_FOUND);
      }
    } finally {
      if (previous === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previous;
    }
  });
});
