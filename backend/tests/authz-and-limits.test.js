/**
 * P4/P5 — authorization hardening and rate limiting.
 *
 * Three properties, each of which was genuinely broken before:
 *
 *   F6  the rate limiter was bypassable by changing the CASE of the path.
 *       Express routers are non-strict and case-insensitive by default, so
 *       /auth/login, /auth/LOGIN and /auth/login/ all reach the same handler
 *       while producing three separate counters. An attacker got the full
 *       budget again per spelling — effectively unlimited attempts — and each
 *       novel spelling also leaked a map entry that lived for a full window.
 *
 *   F1  admin logout left a LIVE impersonation session. It cleared the admin
 *       markers but not impersonatedUserId or userId, so an admin who logged
 *       out while impersonating kept a fully authenticated ordinary session
 *       for the VICTIM's tenant, with no admin marker and no further audit
 *       trail.
 *
 *   F5  admin identity was keyed on a connected account's Instagram USERNAME —
 *       a mutable, externally controlled attribute — and then wrote
 *       role: 'ADMIN' permanently.
 *
 * Each is demonstrated against the unpatched behaviour before the guard is
 * asserted.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const { normalisePath } = require('../src/lib/rateLimit.js');

let app;
let ipCounter = 0;
const nextIp = () => `10.61.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('P5 — F6: rate limiter cannot be bypassed by path spelling', () => {
  it('DEMONSTRATION: the unpatched key differs per casing; the patched one does not', () => {
    const variants = [
      { baseUrl: '/auth', path: '/login' },
      { baseUrl: '/auth', path: '/LOGIN' },
      { baseUrl: '/auth', path: '/Login' },
      { baseUrl: '/auth', path: '/login/' },
      { baseUrl: '/AUTH', path: '/login' },
    ];

    // What the old code computed: `${baseUrl}${path}` verbatim.
    const unpatched = new Set(variants.map((r) => `${r.baseUrl}${r.path}`));
    expect(
      unpatched.size,
      'the old key produced a separate counter per spelling — that IS the bypass'
    ).toBeGreaterThan(1);

    // What normalisePath computes now.
    const patched = new Set(variants.map((r) => normalisePath(r)));
    expect(patched.size, 'every spelling must collapse onto ONE bucket').toBe(1);
    expect([...patched][0]).toBe('/auth/login');
  });

  it('exhausting the limit on /auth/login also blocks /auth/LOGIN', async () => {
    const { user } = await createUser({});
    const ip = nextIp();

    // Burn the per-email budget (5 in 15 minutes) with wrong passwords.
    let sawLimit = false;
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: user.email, password: 'wrong-password' });
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit, 'the limiter must eventually fire').toBe(true);

    // The bypass: same handler, different spelling.
    const bypass = await request(app)
      .post('/auth/LOGIN')
      .set('X-Forwarded-For', ip)
      .send({ email: user.email, password: 'wrong-password' });

    expect(
      bypass.status,
      'a case variant reached the same handler with a fresh counter before the fix'
    ).toBe(429);
  });

  it('the per-EMAIL limiter throttles a distributed attack from many IPs', async () => {
    // Per-IP limiting alone does nothing here: every request comes from a new
    // address, so every request lands in a fresh bucket.
    const { user } = await createUser({});

    let blocked = false;
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', nextIp()) // a NEW IP every single time
        .send({ email: user.email, password: 'wrong-password' });
      if (res.status === 429) {
        blocked = true;
        break;
      }
    }

    expect(
      blocked,
      'without a per-account limiter, credential stuffing from a botnet is unthrottled'
    ).toBe(true);
  });

  it('POSITIVE CONTROL: a different account is not affected by another account\'s limit', async () => {
    const victim = await createUser({});
    const bystander = await createUser({});

    for (let i = 0; i < 8; i += 1) {
      await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ email: victim.user.email, password: 'wrong-password' });
    }

    const res = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: bystander.user.email, password: bystander.password });

    expect(res.status, 'throttling one account must not lock out everyone else').toBe(200);
  });
});

// TEMP: skipped in admin-rebuild Gate 1. Impersonation was REMOVED (owner
// decision — it exposed DM content), and admin state no longer lives on the
// customer session at all. Replaced by tests/admin-auth.test.js ("retired
// endpoints are gone", "session isolation").
describe.skip('P4 — F1: admin logout ends impersonation', () => {
  let adminApp;

  beforeAll(async () => {
    const adminRoutes = (await import('../src/routes/admin.js')).default;
    adminApp = buildTestApp({ mount: { '/api/admin': adminRoutes } });
  });

  it('THE LEAK: logging out while impersonating must not leave a usable victim session', async () => {
    const victim = await createUser({ name: 'Victim' });
    const agent = request.agent(adminApp);

    // Simulate the exact session shape impersonation produces: admin markers,
    // plus userId pointing at the VICTIM, plus igUsername present (which is
    // what defeated the old `!igUsername` heuristic).
    await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({
      email: victim.user.email,
      password: victim.password,
    });

    const res = await agent.post('/api/admin/logout').send({});
    expect(res.status).toBe(200);

    // After logout the session must be gone entirely — not merely stripped of
    // its admin markers while still authenticated as somebody.
    const after = await agent.get('/auth/me');
    expect(
      after.status,
      'admin logout must destroy the session, not selectively delete fields from it'
    ).toBe(401);
  });

  it('DEMONSTRATION: the old !igUsername heuristic fails on a password-login session', () => {
    // The old condition was:  if (session.userId && !session.igUsername) delete userId
    //
    // A password login never sets igUsername, so the branch fired and logged
    // real admins out of the main app. An OAuth session DOES set it, so for
    // those the branch did NOT fire — and userId survived admin logout.
    const passwordLoginSession = { userId: 'u1', igUsername: undefined };
    const oauthSession = { userId: 'u1', igUsername: 'some_handle' };

    const oldWouldDelete = (s) => Boolean(s.userId && !s.igUsername);

    expect(oldWouldDelete(passwordLoginSession), 'logged real admins out of the app').toBe(true);
    expect(
      oldWouldDelete(oauthSession),
      'and left an OAuth session authenticated after admin logout — the actual leak'
    ).toBe(false);
  });
});

// TEMP: skipped in admin-rebuild Gate 1. The intent still holds, but these
// assert a 403 from the retired User-based admin check (and set the removed
// ADMIN_EMAILS). Non-admins now get 404 from a separate admin identity.
// Replaced by tests/admin-auth.test.js ("no customer attribute confers
// admin"), which covers role=ADMIN, a verified ADMIN_EMAILS match and an
// Instagram handle match.
describe.skip('P4 — F5: admin identity is not keyed on an Instagram username', () => {
  it('a user whose IG handle matches ADMIN_EMAILS is NOT granted admin', async () => {
    const handle = uniq('adminhandle');
    const previous = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = handle; // exactly the old match condition

    try {
      // Re-import so the module reads the mutated env at request time.
      const adminRoutes = (await import('../src/routes/admin.js')).default;
      const adminApp = buildTestApp({ mount: { '/api/admin': adminRoutes } });

      const { user, password } = await createUser({ emailVerified: true });
      await createAccount({ userId: user.id, igUserId: uniq('ig'), withConversation: false });
      // Give the account the handle that appears in ADMIN_EMAILS.
      await prisma.instagramAccount.updateMany({
        where: { userId: user.id },
        data: { igUsername: handle },
      });

      const agent = request.agent(adminApp);
      await agent
        .post('/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ email: user.email, password });

      const res = await agent.get('/api/admin/stats');
      expect(
        res.status,
        'an Instagram handle is mutable and externally controlled — it must not confer admin'
      ).toBe(403);

      const after = await prisma.user.findUnique({ where: { id: user.id } });
      expect(after.role, 'and it must certainly not permanently write role=ADMIN').toBe('USER');
    } finally {
      if (previous === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previous;
    }
  });

  it('an UNVERIFIED email matching ADMIN_EMAILS is not granted admin either', async () => {
    const address = `${uniq('wannabe')}@test.codeback`;
    const previous = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = address;

    try {
      const adminRoutes = (await import('../src/routes/admin.js')).default;
      const adminApp = buildTestApp({ mount: { '/api/admin': adminRoutes } });

      const { user, password } = await createUser({ email: address, emailVerified: false });
      const agent = request.agent(adminApp);
      await agent
        .post('/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ email: user.email, password });

      const res = await agent.get('/api/admin/stats');
      expect(
        res.status,
        'an unverified address is an unproven claim — anyone can register with it'
      ).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previous;
    }
  });
});

describe('P5 — request body limits and error shape', () => {
  it('an oversized body is rejected as JSON, not as an HTML stack trace', async () => {
    const big = 'a'.repeat(1024 * 1024 + 512); // just over the 1mb limit
    const res = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'x@y.z', password: big }));

    expect(res.status).toBe(413);
    // The old default handler rendered HTML containing a stack trace.
    expect(String(res.headers['content-type'] || '')).toContain('json');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });

  it('malformed JSON is a 400, not a 500', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .set('Content-Type', 'application/json')
      .send('{"email": "broken",,,}');

    expect(res.status).toBe(400);
    expect(String(res.headers['content-type'] || '')).toContain('json');
  });
});
