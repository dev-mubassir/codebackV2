/**
 * P1 — Google account linking rules.
 *
 * The dangerous case is auto-linking a Google identity to a local account
 * whose email was never verified. An unverified local email is an UNPROVEN
 * CLAIM to that address: anyone can register with someone else's address and
 * never confirm it. If Google sign-in then links on an email match alone, the
 * real owner of that address signs in with Google and is handed the
 * squatter's account — or, worse, the squatter is handed theirs.
 *
 * So the rule under test is a REFUSAL, and a refusal is exactly the kind of
 * thing that silently regresses into a permissive branch. Each test below
 * shows the permissive behaviour would have linked, then asserts the guard.
 *
 * Google's own `email_verified` is equally load-bearing: an unverified Google
 * address is not proof either, and is refused before any local lookup.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const google = require('../src/lib/google.js');
const oauthState = require('../src/lib/oauthState.js');

let app;

/**
 * Stub the two outbound Google calls. Everything else — state verification,
 * the linking branch, session establishment — runs for real.
 */
function stubGoogle({ providerAccountId, email, emailVerified, name = 'Google User' }) {
  vi.spyOn(google, 'exchangeCodeForTokens').mockResolvedValue({ access_token: 'stub-access-token' });
  vi.spyOn(google, 'fetchProfile').mockResolvedValue({
    providerAccountId,
    email,
    emailVerified,
    name,
  });
  vi.spyOn(google, 'isConfigured').mockReturnValue(true);
}

/** A genuine, signed, single-use state token for the Google flow. */
async function validState(userId = null) {
  return oauthState.createState({ purpose: 'GOOGLE_LOGIN', userId });
}

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('P1 — Google linking refuses an unverified LOCAL email', () => {
  it('THE REFUSAL: does not link when the local account email is unverified', async () => {
    const address = `${uniq('squatter')}@test.codeback`;
    const { user } = await createUser({ email: address, emailVerified: false });
    expect(user.emailVerifiedAt, 'fixture must be unverified').toBeNull();

    stubGoogle({ providerAccountId: uniq('gsub'), email: address, emailVerified: true });

    const res = await request(app)
      .get('/auth/google/callback')
      .query({ code: 'stub-code', state: await validState() });

    expect(res.status, 'must redirect, not link').toBe(302);
    expect(
      res.headers.location,
      'the redirect must say why, so the frontend can prompt for verification'
    ).toContain('link_requires_verified_email');

    const identities = await prisma.authIdentity.findMany({ where: { userId: user.id } });
    expect(
      identities.length,
      'linking here would hand this account to whoever controls the Google address'
    ).toBe(0);
  });

  it('POSITIVE CONTROL: links when the local email IS verified', async () => {
    const address = `${uniq('legit')}@test.codeback`;
    const { user } = await createUser({ email: address, emailVerified: true });

    stubGoogle({ providerAccountId: uniq('gsub'), email: address, emailVerified: true });

    const res = await request(app)
      .get('/auth/google/callback')
      .query({ code: 'stub-code', state: await validState() });

    expect(res.status).toBe(302);
    expect(res.headers.location, 'a verified match should log in').toContain('/dashboard');

    const identities = await prisma.authIdentity.findMany({ where: { userId: user.id } });
    expect(identities.length, 'the identity should now be linked').toBe(1);
    expect(identities[0].provider).toBe('GOOGLE');
  });

  it('refuses when GOOGLE says the address is unverified, before any local lookup', async () => {
    const address = `${uniq('unverified-google')}@test.codeback`;
    await createUser({ email: address, emailVerified: true });

    stubGoogle({ providerAccountId: uniq('gsub'), email: address, emailVerified: false });

    const res = await request(app)
      .get('/auth/google/callback')
      .query({ code: 'stub-code', state: await validState() });

    expect(res.headers.location).toContain('google_email_unverified');
    const identities = await prisma.authIdentity.findMany({});
    expect(identities.length, 'an unverified Google address is not proof either').toBe(0);
  });
});

describe('P1 — Google sign-in for a new user', () => {
  it('creates an account with NO password and a verified email', async () => {
    const address = `${uniq('newgoogle')}@test.codeback`;
    stubGoogle({ providerAccountId: uniq('gsub'), email: address, emailVerified: true });

    const res = await request(app)
      .get('/auth/google/callback')
      .query({ code: 'stub-code', state: await validState() });

    expect(res.headers.location).toContain('/dashboard');

    const created = await prisma.user.findUnique({
      where: { email: address },
      include: { authIdentities: true },
    });
    expect(created, 'a user should have been created').toBeTruthy();
    expect(created.passwordHash, 'a Google-only user has no password').toBeNull();
    expect(created.emailVerifiedAt, 'Google vouched for the address').not.toBeNull();
    expect(created.authIdentities.length).toBe(1);
  });

  it('a returning Google user logs into the SAME account, not a second one', async () => {
    const address = `${uniq('returning')}@test.codeback`;
    const sub = uniq('gsub');

    stubGoogle({ providerAccountId: sub, email: address, emailVerified: true });
    await request(app).get('/auth/google/callback').query({ code: 'c1', state: await validState() });

    stubGoogle({ providerAccountId: sub, email: address, emailVerified: true });
    await request(app).get('/auth/google/callback').query({ code: 'c2', state: await validState() });

    const users = await prisma.user.findMany({ where: { email: address } });
    expect(users.length, 'the second sign-in must reuse the identity, not create a user').toBe(1);
    const identities = await prisma.authIdentity.findMany({});
    expect(identities.length).toBe(1);
  });
});

describe('P1 — OAuth state is signed, single-use, and purpose-bound', () => {
  it('rejects a callback with a forged state signature', async () => {
    stubGoogle({ providerAccountId: uniq('gsub'), email: `${uniq('x')}@test.codeback`, emailVerified: true });

    const real = await validState();
    const [payload] = real.split('.');
    const forged = `${payload}.${Buffer.from('not-the-right-signature').toString('base64url')}`;

    const res = await request(app).get('/auth/google/callback').query({ code: 'c', state: forged });
    expect(res.headers.location).toContain('google_invalid_state');
    expect((await prisma.user.findMany({})).length, 'nothing should have been created').toBe(0);
  });

  it('rejects a REPLAYED state token', async () => {
    const address = `${uniq('replay')}@test.codeback`;
    const state = await validState();

    stubGoogle({ providerAccountId: uniq('gsub'), email: address, emailVerified: true });
    const first = await request(app).get('/auth/google/callback').query({ code: 'c1', state });
    expect(first.headers.location, 'first use is legitimate').toContain('/dashboard');

    stubGoogle({ providerAccountId: uniq('gsub2'), email: `${uniq('other')}@test.codeback`, emailVerified: true });
    const second = await request(app).get('/auth/google/callback').query({ code: 'c2', state });
    expect(
      second.headers.location,
      'a signed token is valid forever on its own — the nonce is what stops replay'
    ).toContain('google_invalid_state');
  });

  it('THE PURPOSE DISCRIMINATOR: an INSTAGRAM_CONNECT state is refused at the Google callback', async () => {
    const { user } = await createUser();
    // Minted for the OTHER flow, signed with the SAME secret — so it is
    // cryptographically valid here and only `purpose` distinguishes it.
    const igState = await oauthState.createState({
      purpose: 'INSTAGRAM_CONNECT',
      userId: user.id,
    });

    stubGoogle({ providerAccountId: uniq('gsub'), email: `${uniq('z')}@test.codeback`, emailVerified: true });

    const res = await request(app).get('/auth/google/callback').query({ code: 'c', state: igState });
    expect(
      res.headers.location,
      'without the purpose field this token would have been accepted at the wrong callback'
    ).toContain('google_invalid_state');
  });

  it('DEMONSTRATION: the cross-flow token IS otherwise valid — only purpose rejects it', async () => {
    const { user } = await createUser();
    const igState = await oauthState.createState({ purpose: 'INSTAGRAM_CONNECT', userId: user.id });

    // Verified against its OWN purpose it passes, proving the signature and
    // nonce are sound and that `purpose` is doing the work in the test above.
    const asInstagram = await oauthState.verifyAndConsumeState({
      state: igState,
      expectedPurpose: 'INSTAGRAM_CONNECT',
    });
    expect(asInstagram.ok, 'the token is genuinely valid for its own flow').toBe(true);

    const reissued = await oauthState.createState({ purpose: 'INSTAGRAM_CONNECT', userId: user.id });
    const asGoogle = await oauthState.verifyAndConsumeState({
      state: reissued,
      expectedPurpose: 'GOOGLE_LOGIN',
    });
    expect(asGoogle.ok).toBe(false);
    expect(asGoogle.reason).toBe('wrong_purpose');
  });

  it('INSTAGRAM_CONNECT refuses to mint without a userId', async () => {
    await expect(
      oauthState.createState({ purpose: 'INSTAGRAM_CONNECT', userId: null })
    ).rejects.toThrow(/requires an authenticated userId/i);

    // GOOGLE_LOGIN must still permit it — that is the whole point of signing in.
    const ok = await oauthState.createState({ purpose: 'GOOGLE_LOGIN', userId: null });
    expect(typeof ok).toBe('string');
  });

  it('rejects an EXPIRED state token', async () => {
    const state = await validState();
    // Age the nonce out from under the token.
    await prisma.oAuthNonce.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const result = await oauthState.verifyAndConsumeState({
      state,
      expectedPurpose: 'GOOGLE_LOGIN',
    });
    expect(result.ok).toBe(false);
  });
});

describe('P1 — Google user can add a password', () => {
  it('set-password works for a password-less account and then login succeeds', async () => {
    const { user } = await createUser({ withPassword: false });
    const agent = request.agent(app);

    // Establish a session the way the Google callback does.
    const address = user.email;
    stubGoogle({ providerAccountId: uniq('gsub'), email: address, emailVerified: true });
    await agent.get('/auth/google/callback').query({ code: 'c', state: await validState() });

    const set = await agent.post('/auth/set-password').send({ password: 'my-new-password-1' });
    expect(set.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.passwordHash).not.toBeNull();

    const login = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', '10.44.0.1')
      .send({ email: address, password: 'my-new-password-1' });
    expect(login.status, 'the newly set password must work for normal login').toBe(200);
  });

  it('refuses to overwrite an existing password', async () => {
    const { user, password: plaintext } = await createUser();
    const agent = request.agent(app);
    await agent
      .post('/auth/login')
      .set('X-Forwarded-For', '10.44.0.2')
      .send({ email: user.email, password: plaintext });

    const res = await agent.post('/auth/set-password').send({ password: 'sneaky-overwrite-1' });
    expect(res.status, 'changing an existing password must require the current one').toBe(400);
    expect(res.body.error).toMatch(/already has a password/i);

    // And prove it actually did not overwrite anything. The hash string itself
    // may legitimately differ — the login above lazily migrated it from bcrypt
    // to Argon2id — so the property to assert is that the ORIGINAL password
    // still works, not that the bytes are unchanged.
    const stillWorks = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', '10.44.0.3')
      .send({ email: user.email, password: plaintext });
    expect(stillWorks.status, 'the original password must be untouched').toBe(200);
  });

  it('PUT /auth/profile refuses a password change on an account that has none', async () => {
    // The old code silently allowed this: any session holding a password-less
    // user's id could set a password with no proof of knowledge at all.
    const { user } = await createUser({ withPassword: false });
    const agent = request.agent(app);
    stubGoogle({ providerAccountId: uniq('gsub'), email: user.email, emailVerified: true });
    await agent.get('/auth/google/callback').query({ code: 'c', state: await validState() });

    const res = await agent.put('/auth/profile').send({ newPassword: 'set-via-profile-1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('USE_SET_PASSWORD');

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.passwordHash, 'no password should have been set by this path').toBeNull();
  });
});
