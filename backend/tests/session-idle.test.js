/**
 * Admin rebuild, Gate 2 — customer session idle timeout (lib/sessionIdle.js).
 *
 * The approved mechanism: only mutating requests and POST /auth/activity are
 * activity; a GET never is. Sessions end after `user_session_idle_minutes`
 * (default 30) of no activity, or 7 days after sign-in. Expiry destroys the
 * session and disconnects that session's sockets. Webhooks and background
 * work have no session and are unaffected.
 *
 * Sockets: the backend has no Socket.io client dependency, so socket tests
 * drive the real guard and sweep against stub socket objects that record
 * disconnect() — the code under test is exactly what production runs.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import request from 'supertest';

import { buildTestApp, sessionIdFrom } from './helpers/app.js';
import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const settings = require('../src/lib/settings.js');
const socketLib = require('../src/lib/socket.js');
const sessionIdle = require('../src/lib/sessionIdle.js');
const { startAuthenticatedSession } = require('../src/lib/session.js');
const instagram = require('../src/lib/instagram.js');

const ORIGIN = 'https://app.test.local';
const MIN = 60 * 1000;

let app;
let ipSeq = 0;
const nextIp = () => `10.60.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(async () => {
  const webhookRoutes = (await import('../src/routes/webhook.js')).default;
  const apiRoutes = (await import('../src/routes/api.js')).default;
  app = buildTestApp({ mount: { '/api': apiRoutes, '/webhooks/instagram': webhookRoutes } });
});

beforeEach(async () => {
  await resetDb();
  await prisma.appSetting.deleteMany({});
  settings.clearSettingsCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  socketLib.setIO(null);
});

async function signedIn() {
  const { user, password } = await createUser({});
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password });
  expect(res.status, 'fixture login').toBe(200);
  // "s:<sid>.<signature>" -> sid
  const sid = sessionIdFrom(res).slice(2).split('.')[0];
  return { agent, user, sid };
}

const heartbeat = (agent) => agent.post('/auth/activity').set('Origin', ORIGIN).send({});

function readSession(sid) {
  return new Promise((resolve) => app.locals.sessionStore.get(sid, (err, s) => resolve(s)));
}
function writeSession(sid, sess) {
  return new Promise((resolve) => app.locals.sessionStore.set(sid, sess, () => resolve()));
}

/** A stub io whose sockets record disconnect(). */
function stubIo(sids) {
  const sockets = new Map(
    sids.map((sid, i) => [`sock-${i}`, { id: `sock-${i}`, data: { sid }, disconnect: vi.fn() }])
  );
  return { io: { of: () => ({ sockets }) }, sockets: [...sockets.values()] };
}

describe('idle expiry', () => {
  it('ends the session after 30 idle minutes, with a code that says why', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent } = await signedIn();

    vi.advanceTimersByTime(29 * MIN);
    expect((await agent.get('/auth/me')).status, 'positive control: inside the window').toBe(200);

    vi.advanceTimersByTime(2 * MIN); // 31 minutes since sign-in, no activity
    const res = await agent.get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_IDLE_EXPIRED');

    // The session is gone, not just refused once.
    const again = await agent.get('/auth/me');
    expect(again.status).toBe(401);
    expect(again.body.code).toBeUndefined();
  });

  it('reads the limit from the setting (a short 5-minute limit here)', async () => {
    await prisma.appSetting.create({ data: { key: 'user_session_idle_minutes', value: 5 } });
    settings.clearSettingsCache();
    vi.useFakeTimers({ toFake: ['Date'] });

    const a = await signedIn();
    vi.advanceTimersByTime(4 * MIN);
    expect((await a.agent.get('/auth/me')).status, 'positive control at 4 minutes').toBe(200);
    vi.advanceTimersByTime(2 * MIN);
    expect((await a.agent.get('/auth/me')).body.code).toBe('SESSION_IDLE_EXPIRED');
  });

  it('ignores an invalid stored setting and keeps the 30-minute default', async () => {
    await prisma.appSetting.create({ data: { key: 'user_session_idle_minutes', value: 0 } });
    settings.clearSettingsCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent } = await signedIn();
    vi.advanceTimersByTime(10 * MIN);
    expect((await agent.get('/auth/me')).status).toBe(200);
  });
});

describe('what counts as activity', () => {
  it('background GETs (polling, refetch, the session check itself) do NOT extend the session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent } = await signedIn();

    for (let t = 0; t < 30; t += 5) {
      vi.advanceTimersByTime(5 * MIN);
      await agent.get('/auth/me');
      await agent.get('/auth/session');
      await agent.get('/api/conversations');
    }
    vi.advanceTimersByTime(2 * MIN); // 32 minutes of GETs only
    expect((await agent.get('/auth/me')).body.code).toBe('SESSION_IDLE_EXPIRED');
  });

  it('positive control: the heartbeat extends it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent } = await signedIn();

    vi.advanceTimersByTime(20 * MIN);
    const beat = await heartbeat(agent);
    expect(beat.status).toBe(200);
    expect(Date.parse(beat.body.idleExpiresAt)).toBe(Date.now() + 30 * MIN);

    vi.advanceTimersByTime(25 * MIN); // 45 since sign-in, 25 since activity
    expect((await agent.get('/auth/me')).status).toBe(200);
  });

  it('a real mutation (saving a profile) is activity too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent } = await signedIn();
    vi.advanceTimersByTime(20 * MIN);
    expect((await agent.put('/auth/profile').set('Origin', ORIGIN).send({ name: 'New Name' })).status).toBe(200);
    vi.advanceTimersByTime(25 * MIN);
    expect((await agent.get('/auth/me')).status).toBe(200);
  });

  it('a cross-site POST blocked by the origin guard is not activity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent } = await signedIn();
    vi.advanceTimersByTime(20 * MIN);
    expect((await agent.post('/auth/activity').set('Origin', 'https://evil.example').send({})).status).toBe(403);
    vi.advanceTimersByTime(11 * MIN);
    expect((await agent.get('/auth/me')).body.code).toBe('SESSION_IDLE_EXPIRED');
  });

  it('GET /auth/session reports the deadline without moving it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent } = await signedIn();
    const first = (await agent.get('/auth/session')).body;
    vi.advanceTimersByTime(10 * MIN);
    const second = (await agent.get('/auth/session')).body;
    expect(second.idleExpiresAt).toBe(first.idleExpiresAt);
    expect(second.idleMinutes).toBe(30);
  });
});

describe('absolute limit', () => {
  it('ends a session 7 days after sign-in however active it is', async () => {
    const { agent, sid } = await signedIn();
    const sess = await readSession(sid);
    sess.authenticatedAt = Date.now() - 7 * 24 * 60 * MIN - 1000;
    await writeSession(sid, sess);

    const res = await heartbeat(agent);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
  });

  it('gives a session from before this shipped a fresh window instead of ending it', async () => {
    const { agent, sid } = await signedIn();
    const sess = await readSession(sid);
    delete sess.lastActivityAt;
    delete sess.authenticatedAt;
    await writeSession(sid, sess);

    expect((await agent.get('/auth/me')).status).toBe(200);
    const stamped = await readSession(sid);
    expect(typeof stamped.lastActivityAt).toBe('number');
    expect(typeof stamped.authenticatedAt).toBe('number');
  });
});

describe('sockets', () => {
  it('expiry disconnects that session’s sockets — and only those', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent, sid } = await signedIn();
    const { io, sockets } = stubIo([sid, 'someone-elses-session']);
    socketLib.setIO(io);

    vi.advanceTimersByTime(31 * MIN);
    await agent.get('/auth/me');

    expect(sockets[0].disconnect).toHaveBeenCalledWith(true);
    expect(sockets[1].disconnect, 'another session’s socket is untouched').not.toHaveBeenCalled();
  });

  it('the 60-second sweep disconnects idle and orphaned sockets, keeps live ones', async () => {
    const live = await signedIn();
    const idle = await signedIn();
    const idleSess = await readSession(idle.sid);
    idleSess.lastActivityAt = Date.now() - 31 * MIN;
    await writeSession(idle.sid, idleSess);

    const { io, sockets } = stubIo([live.sid, idle.sid, 'no-such-session']);
    const result = await sessionIdle.sweepIdleSockets({ io, store: app.locals.sessionStore });

    expect(result).toEqual({ checked: 3, disconnected: 2 });
    expect(sockets[0].disconnect, 'live session keeps its socket').not.toHaveBeenCalled();
    expect(sockets[1].disconnect).toHaveBeenCalledWith(true);
    expect(sockets[2].disconnect).toHaveBeenCalledWith(true);
    expect(await readSession(idle.sid), 'the idle session is destroyed too').toBeFalsy();
  });

  it('refuses a new socket whose session is already idle', async () => {
    const now = Date.now();
    // A real user: the handshake also checks that the user behind the session
    // still exists, is not suspended, and has not reset their password (F1).
    const { user } = await createUser({});
    const fresh = { request: { session: { userId: user.id, lastActivityAt: now, authenticatedAt: now } } };
    const stale = { request: { session: { userId: user.id, lastActivityAt: now - 31 * MIN, authenticatedAt: now } } };
    expect(await sessionIdle.socketSessionIsLive(fresh)).toBe(true);
    expect(await sessionIdle.socketSessionIsLive(stale)).toBe(false);
    expect(await sessionIdle.socketSessionIsLive({ request: {} })).toBe(false);
  });
});

describe('last active', () => {
  it('activity updates User.lastSeenAt, at most once per 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { agent, user } = await signedIn();
    const seen = async () => (await prisma.user.findUnique({ where: { id: user.id } })).lastSeenAt?.getTime();
    // The write is fire-and-forget, so poll for it rather than guess how long
    // it takes under load. Only Date is faked; real timers still run.
    const waitForSeen = async (expected) => {
      for (let i = 0; i < 80; i += 1) {
        if ((await seen()) === expected) return expected;
        await new Promise((r) => setTimeout(r, 25));
      }
      return seen();
    };

    vi.advanceTimersByTime(1 * MIN);
    await heartbeat(agent);
    const first = Date.now();
    expect(await waitForSeen(first)).toBe(first);

    vi.advanceTimersByTime(2 * MIN);
    await heartbeat(agent);
    await new Promise((r) => setTimeout(r, 200)); // time for a write that must NOT happen
    expect(await seen(), 'throttled inside 5 minutes').toBe(first);

    vi.advanceTimersByTime(4 * MIN);
    await heartbeat(agent);
    expect(await waitForSeen(Date.now()), 'written again after 5 minutes').toBe(Date.now());
  });

  it('a GET never writes it', async () => {
    const { agent, user } = await signedIn();
    const before = (await prisma.user.findUnique({ where: { id: user.id } })).lastSeenAt?.getTime();
    await agent.get('/auth/session');
    await new Promise((r) => setImmediate(r));
    expect((await prisma.user.findUnique({ where: { id: user.id } })).lastSeenAt?.getTime()).toBe(before);
  });
});

describe('same rules for every sign-in method', () => {
  it('the shared sign-in helper (email/password AND Google OAuth) starts both clocks', async () => {
    const store = {};
    const req = {
      session: {
        regenerate(cb) { req.session = { ...store, regenerate: this.regenerate, save: this.save }; cb(); },
        save(cb) { cb(); },
      },
    };
    const before = Date.now();
    await startAuthenticatedSession(req, { userId: 'u1', userEmail: 'a@b.c', sessionVersion: 0 });
    expect(req.session.lastActivityAt).toBeGreaterThanOrEqual(before);
    expect(req.session.authenticatedAt).toBeGreaterThanOrEqual(before);
    expect(req.session.userId).toBe('u1');
  });
});

describe('background work does not need a session', () => {
  it('a signed webhook is processed while its owner’s session has idled out', async () => {
    vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue({ username: 'a_customer' });
    const { agent, user } = await signedIn();
    const account = await createAccount({ userId: user.id });

    // The owner's session is expired and destroyed.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(31 * MIN);
    expect((await agent.get('/auth/me')).body.code).toBe('SESSION_IDLE_EXPIRED');
    vi.useRealTimers();

    const mid = uniq('mid');
    const raw = JSON.stringify({
      object: 'instagram',
      entry: [{ id: account.igUserId, time: Date.now(), messaging: [{ sender: { id: uniq('igsid') }, recipient: { id: account.igUserId }, timestamp: Date.now(), message: { mid, text: 'is this available?' } }] }],
    });
    const sig = 'sha256=' + crypto.createHmac('sha256', process.env.INSTAGRAM_APP_SECRET).update(raw).digest('hex');
    const res = await request(app).post('/webhooks/instagram').set('Content-Type', 'application/json').set('x-hub-signature-256', sig).send(raw);
    expect(res.status).toBe(200);

    const deadline = Date.now() + 4000;
    let saved = null;
    while (!saved && Date.now() < deadline) {
      saved = await prisma.message.findUnique({ where: { igMessageId: mid } });
      if (!saved) await new Promise((r) => setTimeout(r, 25));
    }
    expect(saved, 'the DM is stored with nobody logged in').not.toBeNull();
  });
});

describe('sweep against the REAL production store (connect-pg-simple)', () => {
  it('treats a missing session as gone and an idle one as expired, on Postgres', async () => {
    const session = require('express-session');
    const PgStore = require('connect-pg-simple')(session);
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PgStore({ pool, tableName: 'user_sessions', createTableIfMissing: false });
    const put = (sid, sess) => new Promise((resolve, reject) => store.set(sid, sess, (e) => (e ? reject(e) : resolve())));
    const get = (sid) => new Promise((resolve) => store.get(sid, (e, s) => resolve({ e, s })));
    const cookie = { originalMaxAge: 7 * 24 * 60 * MIN, expires: new Date(Date.now() + 7 * 24 * 60 * MIN) };

    try {
      const liveSid = uniq('pg-live');
      const idleSid = uniq('pg-idle');
      const { user: liveUser } = await createUser({});
      await put(liveSid, { cookie, userId: liveUser.id, lastActivityAt: Date.now(), authenticatedAt: Date.now() });
      await put(idleSid, { cookie, userId: 'u-idle', lastActivityAt: Date.now() - 31 * MIN, authenticatedAt: Date.now() });

      // What the store really returns for a missing sid: no error, no session.
      const missing = await get(uniq('pg-missing'));
      expect(missing.e).toBeFalsy();
      expect(missing.s == null).toBe(true);

      const { io, sockets } = stubIo([liveSid, idleSid, 'pg-no-such-session']);
      const result = await sessionIdle.sweepIdleSockets({ io, store });
      expect(result).toEqual({ checked: 3, disconnected: 2 });
      expect(sockets[0].disconnect).not.toHaveBeenCalled();
      expect(sockets[1].disconnect).toHaveBeenCalledWith(true);
      expect(sockets[2].disconnect).toHaveBeenCalledWith(true);
      expect((await get(idleSid)).s == null, 'idle row deleted from user_sessions').toBe(true);
    } finally {
      store.close();
      await pool.end();
    }
  });
});
