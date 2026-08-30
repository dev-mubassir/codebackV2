/**
 * The account-takeover chain: C2 (re-link ownership transfer), C4 (missing
 * OAuth `state`), H10 (session fixation).
 *
 * Drives the REAL /auth router over HTTP via supertest, with only the network
 * boundary faked, so the route's own logic — session handling, ownership
 * checks, redirects — is what is under test.
 *
 * Uses an ordinary authorization code, never `test_code_`, so these are
 * independent of whether the C3 backdoor is still present.
 *
 * Each agent gets a distinct X-Forwarded-For. The login limiter
 * (lib/rateLimit.js, 10 per 15min per IP+path) holds module-level state that
 * outlives a single test, so without this the later tests in the file would
 * fail with 429 for reasons unrelated to what they assert.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import request from 'supertest';

import { buildTestApp, sessionIdFrom } from './helpers/app.js';
import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';
import { installMetaStubs, restoreMetaStubs, setIgUser } from './helpers/fake-meta.js';

let app;
let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(async () => {
  await resetDb();
  installMetaStubs();
});

afterEach(() => {
  restoreMetaStubs();
});

/** Log in over HTTP from a fresh IP and return an agent holding the session. */
async function loginAgent(email, password) {
  const ip = nextIp();
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password });
  expect(res.status, `login should succeed, got ${res.status}`).toBe(200);
  agent.__ip = ip;
  return agent;
}

/**
 * Start the OAuth dance properly and return the `state` the server issued,
 * or null when it issues none (the C4 bug).
 */
async function beginOAuth(agent) {
  const res = await agent.get('/auth/instagram');
  const location = res.headers.location || '';
  try {
    return new URL(location).searchParams.get('state');
  } catch {
    return null;
  }
}

describe('C4 — OAuth state parameter', () => {
  it('GET /auth/instagram issues a state parameter in the authorize URL', async () => {
    const { user, password } = await createUser({});
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/auth/instagram');
    expect(res.status).toBe(302);

    const state = new URL(res.headers.location).searchParams.get('state');
    expect(state, 'authorize URL must carry a state parameter').toBeTruthy();
    expect(String(state).length).toBeGreaterThanOrEqual(16);
  });

  it('callback with NO state is rejected and connects nothing', async () => {
    const { user, password } = await createUser({});
    const agent = await loginAgent(user.email, password);
    const igUserId = uniq('ig-nostate');
    setIgUser(igUserId);

    await agent.get('/auth/instagram/callback').query({ code: 'real-auth-code' });

    const account = await prisma.instagramAccount.findUnique({ where: { igUserId } });
    expect(account, 'a callback with no state must not connect an account').toBeNull();
  });

  it('callback with a FORGED state is rejected and connects nothing', async () => {
    const { user, password } = await createUser({});
    const agent = await loginAgent(user.email, password);
    await beginOAuth(agent);
    const igUserId = uniq('ig-badstate');
    setIgUser(igUserId);

    await agent
      .get('/auth/instagram/callback')
      .query({ code: 'real-auth-code', state: 'attacker-chosen-state' });

    const account = await prisma.instagramAccount.findUnique({ where: { igUserId } });
    expect(account, 'a callback with a mismatched state must not connect an account').toBeNull();
  });

  it('a state cannot be replayed after it has been consumed', async () => {
    const { user, password } = await createUser({});
    const agent = await loginAgent(user.email, password);
    const state = await beginOAuth(agent);

    const firstIg = uniq('ig-replay-1');
    setIgUser(firstIg);
    await agent.get('/auth/instagram/callback').query({ code: 'real-auth-code', state });

    const secondIg = uniq('ig-replay-2');
    setIgUser(secondIg);
    await agent.get('/auth/instagram/callback').query({ code: 'real-auth-code', state });

    const replayed = await prisma.instagramAccount.findUnique({ where: { igUserId: secondIg } });
    expect(replayed, 'a consumed state must not authorize a second callback').toBeNull();
  });

  it('callback with the correct state connects the account', async () => {
    const { user, password } = await createUser({});
    const agent = await loginAgent(user.email, password);
    const state = await beginOAuth(agent);
    const igUserId = uniq('ig-goodstate');
    setIgUser(igUserId);

    await agent.get('/auth/instagram/callback').query({ code: 'real-auth-code', state });

    const account = await prisma.instagramAccount.findUnique({ where: { igUserId } });
    expect(account, 'a correctly-stated callback must connect the account').not.toBeNull();
    expect(account.userId).toBe(user.id);
  });
});

describe("C2 — re-link must not transfer another tenant's account", () => {
  async function attemptRelink({ withConversation }) {
    const { user: userA } = await createUser({ name: 'Tenant A' });
    const { user: userB, password: passB } = await createUser({ name: 'Tenant B' });

    const igUserId = uniq('ig-owned');
    setIgUser(igUserId);
    const account = await createAccount({ userId: userA.id, igUserId, withConversation });

    const agentB = await loginAgent(userB.email, passB);
    const state = await beginOAuth(agentB);

    const res = await agentB
      .get('/auth/instagram/callback')
      .query({ code: 'real-auth-code', state })
      .set('Accept', 'application/json');

    return { res, userA, userB, account };
  }

  it('refuses when the account already has conversation history', async () => {
    const { res, userA, account } = await attemptRelink({ withConversation: true });

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/already connected to another/i);

    const after = await prisma.instagramAccount.findUnique({ where: { id: account.id } });
    expect(after.userId, 'ownership must remain with the original tenant').toBe(userA.id);

    const conversations = await prisma.conversation.count({
      where: { instagramAccountId: account.id },
    });
    expect(conversations, 'the original tenant must keep their history').toBe(1);
  });

  it('does not leak who owns the account', async () => {
    const { res, userA } = await attemptRelink({ withConversation: true });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(userA.id);
    expect(body).not.toContain(userA.email);
  });

  it('writes an audit-log entry when a re-link is blocked', async () => {
    const { account } = await attemptRelink({ withConversation: true });

    const log = await prisma.adminLog.findFirst({
      where: { action: 'ACCOUNT_RELINK_BLOCKED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log, 'a blocked re-link must be audit-logged').not.toBeNull();
    expect(log.targetType).toBe('INSTAGRAM_ACCOUNT');
    expect(log.targetId).toBe(account.id);
  });

  it('allows (and audit-logs) a transfer when the account has no history', async () => {
    const { userB, account } = await attemptRelink({ withConversation: false });

    const after = await prisma.instagramAccount.findUnique({ where: { id: account.id } });
    expect(after.userId, 'a history-free account may transfer').toBe(userB.id);

    const log = await prisma.adminLog.findFirst({
      where: { action: 'ACCOUNT_RELINK_TRANSFERRED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log, 'a permitted transfer must still be audit-logged').not.toBeNull();
  });

  it('the original owner reconnecting their own account is unaffected', async () => {
    const { user: userA, password: passA } = await createUser({ name: 'Tenant A' });

    const igUserId = uniq('ig-self');
    setIgUser(igUserId);
    const account = await createAccount({ userId: userA.id, igUserId, withConversation: true });

    const agentA = await loginAgent(userA.email, passA);
    const state = await beginOAuth(agentA);
    await agentA.get('/auth/instagram/callback').query({ code: 'real-auth-code', state });

    const after = await prisma.instagramAccount.findUnique({ where: { id: account.id } });
    expect(after.userId, 'the owner must still be able to reconnect').toBe(userA.id);
    expect(after.connectionStatus).toBe('CONNECTED');
  });
});

describe('H10 — session fixation', () => {
  it('issues a NEW session id when a different user logs in on the same session', async () => {
    const { user: userA, password: passA } = await createUser({ name: 'Tenant A' });
    const { user: userB, password: passB } = await createUser({ name: 'Tenant B' });
    const ip = nextIp();

    // Attacker obtains a valid signed session cookie by logging in as themselves.
    const agent = request.agent(app);
    const first = await agent
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: userA.email, password: passA });
    expect(first.status).toBe(200);
    const attackerSid = sessionIdFrom(first);
    expect(attackerSid).toBeTruthy();

    // Victim logs in on that same planted session.
    const second = await agent
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: userB.email, password: passB });
    expect(second.status).toBe(200);
    const victimSid = sessionIdFrom(second);

    expect(victimSid, 'login must issue a fresh session cookie').toBeTruthy();
    expect(victimSid, 'session id must not survive a privilege transition').not.toBe(attackerSid);
  });

  it('the regenerated session is authenticated as the new user', async () => {
    const { user: userA, password: passA } = await createUser({ name: 'Tenant A' });
    const { user: userB, password: passB } = await createUser({ name: 'Tenant B' });
    const ip = nextIp();

    const agent = request.agent(app);
    await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email: userA.email, password: passA });
    await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email: userB.email, password: passB });

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(userB.id);
  });

  it('registration also issues a fresh session id', async () => {
    const ip = nextIp();
    const { user: userA, password: passA } = await createUser({ name: 'Tenant A' });

    const agent = request.agent(app);
    const login = await agent
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: userA.email, password: passA });
    const beforeSid = sessionIdFrom(login);

    const reg = await agent
      .post('/auth/register')
      .set('X-Forwarded-For', ip)
      .send({
        name: 'Fresh User',
        email: `${uniq('fresh')}@test.codeback`,
        password: 'correct-horse-1',
        confirmPassword: 'correct-horse-1',
      });
    expect(reg.status).toBe(201);

    expect(sessionIdFrom(reg), 'registration must not reuse a planted session id').not.toBe(beforeSid);
  });
});
