/**
 * P3 — Instagram OAuth state survives a browser switch, and Instagram is
 *      connect-only.
 *
 * THE BUG THIS FIXES. State used to live in the session, addressed by the
 * codeback.sid cookie. On mobile a user routinely starts in one browser
 * (Brave), gets bounced into Instagram's in-app webview to authorise, and
 * lands back in a third (Chrome). Those are three separate cookie jars, so the
 * callback arrived with no session: no state, and no identity either. The
 * product copy already blamed exactly this scenario — it was a known,
 * unfixed failure.
 *
 * The test for it is the FIRST one below: a callback presented by an agent
 * that has never held a cookie. Under the old design that could not work even
 * in principle, because there was nothing else for the server to read. It
 * works now because the user id travels inside the HMAC-signed state token.
 *
 * The second property is that Instagram can no longer CREATE users. It returns
 * no email, so such accounts had no reset target, no receipt destination and
 * no way to be warned about an expiring token — and control of the Instagram
 * account was a password-free login into whatever workspace owned it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, uniq } from './helpers/db.js';
import { installMetaStubs, restoreMetaStubs, setIgUser } from './helpers/fake-meta.js';

const require = createRequire(import.meta.url);
const oauthState = require('../src/lib/oauthState.js');

let app;
let ipCounter = 0;
const nextIp = () => `10.31.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

async function loginAgent(email, password) {
  const agent = request.agent(app);
  const res = await agent
    .post('/auth/login')
    .set('X-Forwarded-For', nextIp())
    .send({ email, password });
  expect(res.status, `login should succeed, got ${res.status}`).toBe(200);
  return agent;
}

/** Pull the state out of the authorize URL the way Instagram would receive it. */
async function beginOAuth(agent) {
  const res = await agent.get('/auth/instagram');
  expect(res.status, 'connect start should redirect to Instagram').toBe(302);
  return new URL(res.headers.location).searchParams.get('state');
}

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

afterAll(async () => {
  await prisma.$disconnect();
});

describe('P3 — the mobile browser-switch case', () => {
  it('THE FIX: a callback from a browser with NO SESSION still connects the account', async () => {
    const { user, password } = await createUser({});
    const igUserId = uniq('ig-switch');
    setIgUser(igUserId);

    // Browser A starts the flow.
    const browserA = await loginAgent(user.email, password);
    const state = await beginOAuth(browserA);
    expect(state, 'a state token must have been issued').toBeTruthy();

    // Browser B is a completely separate cookie jar — no session, no state.
    // This is Chrome receiving the redirect that Brave started.
    const browserB = request(app);
    const res = await browserB
      .get('/auth/instagram/callback')
      .query({ code: 'real-auth-code', state });

    expect(res.status).toBe(302);
    expect(
      res.headers.location,
      'the switched browser should land on the dashboard, not an error page'
    ).toContain('/dashboard');

    const account = await prisma.instagramAccount.findFirst({ where: { igUserId } });
    expect(
      account,
      'under session-stored state this could not work even in principle — the identity is now inside the signed token'
    ).not.toBeNull();
    expect(account.userId, 'and it must attach to the user who STARTED the flow').toBe(user.id);
  });

  it('DEMONSTRATION: the old session-only design had nothing to read', async () => {
    // Reproduces the unpatched logic against a session-less request. This is
    // what the previous implementation did, and it can only ever reject.
    const sessionlessRequest = { session: undefined };
    const expectedState = sessionlessRequest.session ? sessionlessRequest.session.oauthState : null;
    expect(expectedState, 'nothing to compare against, so every switched-browser callback failed').toBeNull();

    // The new design carries the identity in the token itself.
    const { user } = await createUser({});
    const token = await oauthState.createState({
      purpose: 'INSTAGRAM_CONNECT',
      userId: user.id,
    });
    const verified = await oauthState.verifyAndConsumeState({
      state: token,
      expectedPurpose: 'INSTAGRAM_CONNECT',
    });
    expect(verified.ok).toBe(true);
    expect(verified.payload.u, 'the user id survives the browser hop').toBe(user.id);
  });

  it('a state token is still single-use across browsers', async () => {
    const { user, password } = await createUser({});
    setIgUser(uniq('ig-replay'));

    const browserA = await loginAgent(user.email, password);
    const state = await beginOAuth(browserA);

    const first = await request(app)
      .get('/auth/instagram/callback')
      .query({ code: 'code-1', state });
    expect(first.headers.location).toContain('/dashboard');

    const second = await request(app)
      .get('/auth/instagram/callback')
      .query({ code: 'code-2', state });
    expect(
      second.headers.location,
      'portability must not cost replay protection — the nonce is consumed'
    ).toContain('invalid_oauth_state');
  });
});

describe('P3 — Instagram is connect-only', () => {
  it('a logged-out visitor cannot START a connect', async () => {
    const res = await request(app).get('/auth/instagram');
    expect(res.status).toBe(302);
    expect(
      res.headers.location,
      'Instagram returns no email, so it cannot be a signup method'
    ).toContain('login_required_to_connect');
  });

  it('a callback with no state creates NO user', async () => {
    const before = await prisma.user.count();
    setIgUser(uniq('ig-nouser'));

    await request(app).get('/auth/instagram/callback').query({ code: 'real-auth-code' });

    expect(
      await prisma.user.count(),
      'the old code created a user from an Instagram profile alone — no email, no password'
    ).toBe(before);
  });

  it('a user with an UNVERIFIED email cannot start a connect', async () => {
    const { user, password } = await createUser({ emailVerified: false });
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/auth/instagram');
    expect(res.headers.location, 'a trial cannot be granted without a confirmed address').toContain(
      'email_unverified'
    );
  });

  it('POSITIVE CONTROL: a verified, logged-in user CAN start and complete a connect', async () => {
    const { user, password } = await createUser({ emailVerified: true });
    const igUserId = uniq('ig-happy');
    setIgUser(igUserId);

    const agent = await loginAgent(user.email, password);
    const state = await beginOAuth(agent);
    const res = await agent.get('/auth/instagram/callback').query({ code: 'c', state });

    expect(res.headers.location).toContain('/dashboard');
    const account = await prisma.instagramAccount.findFirst({ where: { igUserId } });
    expect(account).not.toBeNull();
    expect(account.userId).toBe(user.id);
  });
});

describe('P3 — Meta error params are handled distinctly', () => {
  it('user cancellation is reported as a cancellation, not as "no code"', async () => {
    const res = await request(app).get('/auth/instagram/callback').query({
      error: 'access_denied',
      error_reason: 'user_denied',
      error_description: 'Permissions error',
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('instagram_cancelled');
  });

  it('a non-cancellation error is NOT reported as a cancellation', async () => {
    // Previously every code-less callback produced the same "you cancelled"
    // message, so a genuine app misconfiguration was indistinguishable from a
    // user pressing Cancel — and error_description was thrown away.
    const res = await request(app).get('/auth/instagram/callback').query({
      error: 'server_error',
      error_description: 'Something broke on Meta side',
    });

    expect(res.headers.location).toContain('instagram_failed');
    expect(res.headers.location).not.toContain('cancelled');
  });
});
