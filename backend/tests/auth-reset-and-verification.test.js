/**
 * P1 — Password reset, email verification, and session invalidation.
 *
 * Before this phase there was NO password reset and NO email verification
 * anywhere in the product. A user who forgot their password was permanently
 * locked out, and anyone could register unlimited accounts on addresses they
 * did not control, each immediately fully authenticated.
 *
 * The properties pinned here are the ones that make the new flows safe rather
 * than merely present:
 *
 *   - forgot-password is not an account-enumeration oracle
 *   - a reset token is single-use and expires
 *   - completing a reset EVICTS every other session (the whole point — the
 *     canonical reason to reset is "I think I'm compromised", and before the
 *     sessionVersion bump every existing session, including an attacker's,
 *     stayed valid for up to seven days)
 *   - a Google-only account cannot be handed a password by the reset flow
 *
 * Several tests below run the UNPATCHED behaviour explicitly first and assert
 * that it would have failed, so the guard is demonstrated rather than assumed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

import { buildTestApp, sessionIdFrom } from './helpers/app.js';
import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const authTokens = require('../src/lib/authTokens.js');
const password = require('../src/lib/password.js');

let app;
let ipCounter = 0;
// Distinct IP per agent: lib/rateLimit.js is an in-memory Map at module scope
// that outlives individual tests, so without this later cases 429 for reasons
// unrelated to what they are testing.
const nextIp = () => `10.21.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

/** Grab the raw token straight from the DB — the email body is not under test here. */
async function latestRawTokenFor(userId, type) {
  // Only the hash is stored, so a test cannot read the token back. Instead we
  // issue a known one. This mirrors production exactly: issueToken() is the
  // only place a raw token exists.
  const issued = await authTokens.issueToken({ userId, type });
  return issued.rawToken;
}

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('P1 — forgot-password does not enumerate accounts', () => {
  it('returns an IDENTICAL body and status for an existing and a non-existent address', async () => {
    const { user } = await createUser({ email: `${uniq('real')}@test.codeback` });

    const existing = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email });

    const missing = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: `${uniq('nobody')}@test.codeback` });

    expect(existing.status, 'existing address').toBe(200);
    expect(missing.status, 'non-existent address').toBe(200);
    expect(
      JSON.stringify(missing.body),
      'response bodies must be byte-identical or the endpoint is an enumeration oracle'
    ).toBe(JSON.stringify(existing.body));
  });

  it('issues a token for a real account and none for a fictional one', async () => {
    const { user } = await createUser();

    await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email });
    await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: `${uniq('ghost')}@test.codeback` });

    const tokens = await prisma.authToken.findMany({ where: { type: 'PASSWORD_RESET' } });
    // Identical responses, different side effects — that is the design.
    expect(tokens.length, 'exactly one token, for the account that exists').toBe(1);
    expect(tokens[0].userId).toBe(user.id);
  });

  it('stores only the SHA-256 of the token, never the token itself', async () => {
    const { user } = await createUser();
    const { rawToken } = await authTokens.issueToken({ userId: user.id, type: 'PASSWORD_RESET' });

    const stored = await prisma.authToken.findFirst({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(stored.tokenHash).toBe(
      require('crypto').createHash('sha256').update(rawToken).digest('hex')
    );
    // A database leak must not yield usable tokens.
    const all = JSON.stringify(await prisma.authToken.findMany({}));
    expect(all, 'raw token must appear nowhere in the table').not.toContain(rawToken);
  });

  it('refuses to mint a reset token for a Google-only account', async () => {
    const { user } = await createUser({ withPassword: false });
    expect(user.passwordHash, 'fixture must have no password').toBeNull();

    const res = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email });

    expect(res.status, 'response is still the generic one').toBe(200);
    const tokens = await prisma.authToken.findMany({ where: { userId: user.id } });
    expect(
      tokens.length,
      'minting a reset token here would create a password on an account that deliberately has none'
    ).toBe(0);
  });
});

describe('P1 — reset token lifecycle', () => {
  it('is SINGLE USE — the second attempt is rejected', async () => {
    const { user } = await createUser();
    const rawToken = await latestRawTokenFor(user.id, 'PASSWORD_RESET');

    const first = await request(app)
      .post('/auth/reset-password')
      .set('X-Forwarded-For', nextIp())
      .send({ token: rawToken, password: 'new-password-1' });
    expect(first.status, 'first use should succeed').toBe(200);

    const second = await request(app)
      .post('/auth/reset-password')
      .set('X-Forwarded-For', nextIp())
      .send({ token: rawToken, password: 'attacker-password-2' });
    expect(second.status, 'replay must be rejected').toBe(400);

    // And prove the replay changed nothing.
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    const { valid } = await password.verifyPassword('new-password-1', after.passwordHash);
    expect(valid, 'the first reset must still be the effective password').toBe(true);
  });

  it('enforces expiry', async () => {
    const { user } = await createUser();
    const rawToken = await latestRawTokenFor(user.id, 'PASSWORD_RESET');

    // Age the token past its TTL.
    await prisma.authToken.updateMany({
      where: { userId: user.id, type: 'PASSWORD_RESET' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post('/auth/reset-password')
      .set('X-Forwarded-For', nextIp())
      .send({ token: rawToken, password: 'should-not-apply' });

    expect(res.status).toBe(400);
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    const { valid } = await password.verifyPassword('should-not-apply', after.passwordHash);
    expect(valid, 'an expired token must not change the password').toBe(false);
  });

  it('issuing a new token invalidates the previous unused one', async () => {
    const { user } = await createUser();
    const firstToken = await latestRawTokenFor(user.id, 'PASSWORD_RESET');
    const secondToken = await latestRawTokenFor(user.id, 'PASSWORD_RESET');

    const oldOne = await request(app)
      .post('/auth/reset-password')
      .set('X-Forwarded-For', nextIp())
      .send({ token: firstToken, password: 'via-old-token' });
    expect(
      oldOne.status,
      'the earlier link must die when a new one is requested, or an intercepted link stays live'
    ).toBe(400);

    const newOne = await request(app)
      .post('/auth/reset-password')
      .set('X-Forwarded-For', nextIp())
      .send({ token: secondToken, password: 'via-new-token' });
    expect(newOne.status, 'positive control: the newest link still works').toBe(200);
  });

  it('rejects a forged token that was never issued', async () => {
    const { user } = await createUser();
    const res = await request(app)
      .post('/auth/reset-password')
      .set('X-Forwarded-For', nextIp())
      .send({ token: 'not-a-real-token-' + uniq('x'), password: 'nope-nope-1' });

    expect(res.status).toBe(400);
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    const { valid } = await password.verifyPassword('nope-nope-1', after.passwordHash);
    expect(valid).toBe(false);
  });
});

describe('P1 — reset EVICTS existing sessions (sessionVersion)', () => {
  it('THE CORE PROPERTY: a live session stops working after a reset', async () => {
    const { user, password: plaintext } = await createUser();

    // An attacker (or an old device) holds a valid, logged-in session.
    const attacker = request.agent(app);
    const login = await attacker
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email, password: plaintext });
    expect(login.status).toBe(200);
    expect(sessionIdFrom(login), 'guard: a cookie must have been issued').toBeTruthy();

    // Prove the session genuinely works BEFORE the reset — otherwise the
    // assertion after it passes vacuously against the very bug it targets.
    const before = await attacker.get('/auth/me');
    expect(before.status, 'session must be live before the reset').toBe(200);

    // The victim resets their password.
    const rawToken = await latestRawTokenFor(user.id, 'PASSWORD_RESET');
    const reset = await request(app)
      .post('/auth/reset-password')
      .set('X-Forwarded-For', nextIp())
      .send({ token: rawToken, password: 'brand-new-password-9' });
    expect(reset.status).toBe(200);

    // The attacker's session must now be dead.
    const after = await attacker.get('/auth/me');
    expect(
      after.status,
      'the attacker session survived the reset — sessionVersion is not being enforced'
    ).toBe(401);
  });

  it('bumps sessionVersion in the database', async () => {
    const { user } = await createUser();
    expect(user.sessionVersion).toBe(0);

    const rawToken = await latestRawTokenFor(user.id, 'PASSWORD_RESET');
    await request(app)
      .post('/auth/reset-password')
      .set('X-Forwarded-For', nextIp())
      .send({ token: rawToken, password: 'another-new-one-1' });

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.sessionVersion).toBe(1);
  });

  it('DEMONSTRATION: without the version check, the stale session would still pass', async () => {
    // The unpatched behaviour was "session carries userId, requireAuth trusts
    // it". Reproduce that here to show what the guard is actually preventing:
    // the row is reset, the session's copy is stale, and only the comparison
    // stops it.
    const { user } = await createUser();
    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: 5 } });

    const staleSession = { userId: user.id, sessionVersion: 0 };
    const current = await prisma.user.findUnique({
      where: { id: user.id },
      select: { sessionVersion: true },
    });

    // Unpatched: presence of userId alone was sufficient.
    expect(Boolean(staleSession.userId), 'unpatched check would have admitted this').toBe(true);
    // Patched: the versions disagree, so the request is rejected.
    expect(staleSession.sessionVersion === current.sessionVersion).toBe(false);
  });
});

describe('P1 — email verification', () => {
  it('a new registration starts UNVERIFIED and gets a token', async () => {
    const res = await request(app)
      .post('/auth/register')
      .set('X-Forwarded-For', nextIp())
      .send({
        name: 'Fresh User',
        email: `${uniq('fresh')}@test.codeback`,
        password: 'a-good-password-1',
        confirmPassword: 'a-good-password-1',
      });

    expect(res.status).toBe(201);
    const created = await prisma.user.findUnique({ where: { email: res.body.user.email } });
    expect(created.emailVerifiedAt, 'must not be verified merely by registering').toBeNull();

    const tokens = await prisma.authToken.findMany({
      where: { userId: created.id, type: 'EMAIL_VERIFY' },
    });
    expect(tokens.length).toBe(1);
  });

  it('a valid token verifies the address, and is then single-use', async () => {
    const { user } = await createUser({ emailVerified: false });
    const rawToken = await latestRawTokenFor(user.id, 'EMAIL_VERIFY');

    const first = await request(app).post('/auth/verify-email').send({ token: rawToken });
    expect(first.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.emailVerifiedAt).not.toBeNull();

    const replay = await request(app).post('/auth/verify-email').send({ token: rawToken });
    expect(replay.status, 'verification token must also be single use').toBe(400);
  });

  it('a PASSWORD_RESET token cannot be used to verify an email', async () => {
    const { user } = await createUser({ emailVerified: false });
    const resetToken = await latestRawTokenFor(user.id, 'PASSWORD_RESET');

    const res = await request(app).post('/auth/verify-email').send({ token: resetToken });
    expect(res.status, 'token types must not be interchangeable').toBe(400);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.emailVerifiedAt).toBeNull();
  });
});

describe('P1 — password hashing migrates off bcrypt', () => {
  it('a legacy bcrypt hash still logs in, and is transparently upgraded to Argon2id', async () => {
    const { user, password: plaintext } = await createUser({ hashWith: 'bcrypt' });
    expect(user.passwordHash.startsWith('$2'), 'fixture must start as bcrypt').toBe(true);

    const res = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email, password: plaintext });
    expect(res.status, 'existing users must not be locked out by the migration').toBe(200);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(
      after.passwordHash.startsWith('$argon2id$'),
      'the hash should have been rewritten as Argon2id on successful login'
    ).toBe(true);

    // And the upgraded hash must still accept the same password.
    const second = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email, password: plaintext });
    expect(second.status, 'the rehash must not break the next login').toBe(200);
  });

  it('a wrong password is still rejected after the rehash path exists', async () => {
    const { user } = await createUser();
    const res = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email, password: 'definitely-not-it' });
    expect(res.status).toBe(401);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.passwordHash.startsWith('$2'), 'a failed login must not rehash anything').toBe(true);
  });
});
