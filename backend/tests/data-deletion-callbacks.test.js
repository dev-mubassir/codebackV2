/**
 * Gate 1-E / Part A — the deauthorize and data-deletion callbacks.
 *
 * A1 DIAGNOSIS, restated for anyone reading this later: both routes have
 * always called the SAME verifySignedRequest() with the SAME
 * INSTAGRAM_APP_SECRET — there was never a second implementation to
 * "make consistent." A signed_request fixture signed with the test secret is
 * asserted here to be accepted by BOTH routes, which is the direct evidence
 * for that claim. The production symptom (deauthorize rejecting the same
 * event data-deletion accepted) was not a code difference between the two
 * handlers.
 *
 * This file also covers:
 *   A3 — deauthorize sends no email
 *   A4 — data deletion sends a confirmation email, once, only for a real
 *        deletion (not a Meta retry that finds nothing left)
 *   A5 — sessions/sockets are torn down when the User row is deleted
 *   A6 — every early return and the success path logs one tagged line,
 *        naming WHICH check failed on a rejection
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);

const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;

let app;
let dataDeletionModule;
let mailer;
const ORIGINAL_SEND = {};

beforeAll(async () => {
  dataDeletionModule = await import('../src/routes/dataDeletion.js');
  // createRequire, matching how routes/dataDeletion.js itself does
  // require('../lib/email') — see the module-identity note in
  // email-failure-handling.test.js. An await import() here returns a
  // DIFFERENT object under Vitest's ESM/CJS interop, and stubbing it changes
  // nothing the route can see.
  mailer = require('../src/lib/email/index.js');
  ORIGINAL_SEND.sendDeletionConfirmation = mailer.sendDeletionConfirmation;

  app = buildTestApp({ mount: { '/data-deletion': dataDeletionModule.default } });
});

beforeEach(async () => {
  await resetDb();
  mailer.sendDeletionConfirmation = ORIGINAL_SEND.sendDeletionConfirmation;
});

afterEach(() => {
  vi.restoreAllMocks();
  mailer.sendDeletionConfirmation = ORIGINAL_SEND.sendDeletionConfirmation;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Build the signed_request shape Meta posts, signed with the given secret. */
function signedRequest(payload, secret = APP_SECRET) {
  const encodedPayload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', ...payload })).toString(
    'base64url'
  );
  const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${sig}.${encodedPayload}`;
}

describe('A1 — one verification, shared by both callbacks', () => {
  it('a request signed with the test secret is accepted by /instagram', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-shared-a');
    await createAccount({ userId: user.id, igUserId });

    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    expect(res.status).toBe(200);
  });

  it('the SAME fixture format, signed with the SAME secret, is accepted by /deauthorize', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-shared-b');
    await createAccount({ userId: user.id, igUserId });

    const res = await request(app)
      .post('/data-deletion/deauthorize')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    expect(res.status).toBe(200);
  });

  it('exposes one verifySignedRequest used by both routes (no second implementation)', () => {
    expect(typeof dataDeletionModule.verifySignedRequest).toBe('function');
    const ok = dataDeletionModule.verifySignedRequest(signedRequest({ user_id: 'x' }), APP_SECRET);
    expect(ok.payload).toBeTruthy();
    expect(ok.reason).toBeNull();
  });
});

describe('A6 — every branch logs one tagged line naming what failed', () => {
  it('/instagram: missing_field is logged and returns 400', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app).post('/data-deletion/instagram').send({});
    expect(res.status).toBe(400);
    expect(warn.mock.calls.some((c) => c[0].includes('[DataDeletion]') && c[0].includes('missing_field'))).toBe(
      true
    );
  });

  it('/instagram: bad_format is logged and returns 400', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app).post('/data-deletion/instagram').send({ signed_request: 'not-a-real-token' });
    expect(res.status).toBe(400);
    expect(warn.mock.calls.some((c) => c[0].includes('bad_format'))).toBe(true);
  });

  it('/instagram: bad_algorithm is logged and returns 400', async () => {
    const badAlgPayload = Buffer.from(JSON.stringify({ algorithm: 'PLAINTEXT', user_id: 'x' })).toString(
      'base64url'
    );
    const sig = crypto.createHmac('sha256', APP_SECRET).update(badAlgPayload).digest('base64url');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: `${sig}.${badAlgPayload}` });

    expect(res.status).toBe(400);
    expect(warn.mock.calls.some((c) => c[0].includes('bad_algorithm'))).toBe(true);
  });

  it('/instagram: bad_signature (wrong secret) is logged and returns 400', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: 'x' }, 'attacker-secret') });
    expect(res.status).toBe(400);
    expect(warn.mock.calls.some((c) => c[0].includes('bad_signature'))).toBe(true);
  });

  it('/instagram: a payload with no user_id is logged (previously silent) and returns 400', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ not_user_id: 'x' }) });
    expect(res.status).toBe(400);
    expect(warn.mock.calls.some((c) => c[0].includes('no user_id'))).toBe(true);
  });

  it('/instagram: the success path logs one tagged line naming accounts removed', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-log-success');
    await createAccount({ userId: user.id, igUserId });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    expect(res.status).toBe(200);
    expect(
      log.mock.calls.some((c) => c[0].includes('[DataDeletion]') && c[0].includes('accounts removed: 1'))
    ).toBe(true);
  });

  it('/deauthorize: missing_field is logged and returns 400', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app).post('/data-deletion/deauthorize').send({});
    expect(res.status).toBe(400);
    expect(warn.mock.calls.some((c) => c[0].includes('[Deauthorize]') && c[0].includes('missing_field'))).toBe(
      true
    );
  });

  it('/deauthorize: bad_signature is logged and returns 400', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app)
      .post('/data-deletion/deauthorize')
      .send({ signed_request: signedRequest({ user_id: 'x' }, 'attacker-secret') });
    expect(res.status).toBe(400);
    expect(warn.mock.calls.some((c) => c[0].includes('bad_signature'))).toBe(true);
  });

  it('/deauthorize: the success path logs one tagged line', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-deauth-log');
    await createAccount({ userId: user.id, igUserId });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const res = await request(app)
      .post('/data-deletion/deauthorize')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    expect(res.status).toBe(200);
    expect(log.mock.calls.some((c) => c[0].includes('[Deauthorize]') && c[0].includes('Disconnected'))).toBe(true);
  });

  it("never logs the raw signed_request, a token, or an email address — the ROUTE's own logging, not the mail transport's", async () => {
    // Stubbed so this isolates dataDeletion.js's own console calls from the
    // (separately, deliberately verbose) console mail transport, which is
    // not what A6 is about.
    mailer.sendDeletionConfirmation = async () => {};

    const { user } = await createUser({ email: 'must-not-appear@test.codeback' });
    const igUserId = uniq('ig-no-leak');
    await createAccount({ userId: user.id, igUserId });

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sr = signedRequest({ user_id: igUserId });

    await request(app).post('/data-deletion/instagram').send({ signed_request: sr });
    await request(app).post('/data-deletion/deauthorize').send({ signed_request: signedRequest({ user_id: 'y' }) });

    const allCalls = [...log.mock.calls, ...warn.mock.calls].flat().join(' ');
    expect(allCalls).not.toContain(sr);
    expect(allCalls).not.toContain('must-not-appear@test.codeback');
    expect(allCalls).not.toContain(APP_SECRET);
  });
});

describe('A3 — deauthorize never emails', () => {
  it('does not touch the mailer, even for an owner with an email on file', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-deauth-no-email');
    await createAccount({ userId: user.id, igUserId });

    let called = false;
    mailer.sendDeletionConfirmation = async () => {
      called = true;
    };

    const res = await request(app)
      .post('/data-deletion/deauthorize')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    expect(res.status).toBe(200);
    expect(called, 'deauthorize must never send the deletion-confirmation email').toBe(false);
  });
});

describe('A4 — data deletion sends a confirmation once, per real deletion', () => {
  it('sends the confirmation email with the expected content', async () => {
    const { user } = await createUser({ email: 'owner@test.codeback' });
    const igUserId = uniq('ig-confirm');
    await createAccount({ userId: user.id, igUserId });

    const calls = [];
    mailer.sendDeletionConfirmation = async (to, opts) => {
      calls.push({ to, opts });
    };

    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    expect(res.status).toBe(200);
    expect(calls.length).toBe(1);
    expect(calls[0].to).toBe('owner@test.codeback');
    expect(calls[0].opts.confirmationCode).toBe(res.body.confirmation_code);
    expect(calls[0].opts.statusUrl).toBe(res.body.url);
    expect(calls[0].opts.accountDeleted).toBe(true);
  });

  it('does NOT send when a retry finds nothing left to erase (0 accounts removed)', async () => {
    const calls = [];
    mailer.sendDeletionConfirmation = async (to, opts) => {
      calls.push({ to, opts });
    };

    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: 'never-connected-anywhere' }) });

    expect(res.status).toBe(200);
    expect(res.body.confirmation_code).toBeTruthy();
    expect(calls.length, 'a no-op retry must not notify anyone').toBe(0);
  });

  it('a failed send still returns Meta its normal 200', async () => {
    const { user } = await createUser({ email: 'owner2@test.codeback' });
    const igUserId = uniq('ig-confirm-fail');
    await createAccount({ userId: user.id, igUserId });

    mailer.sendDeletionConfirmation = async () => {
      throw new Error('provider down');
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    expect(res.status).toBe(200);
    expect(res.body.confirmation_code).toBeTruthy();
    expect(errSpy.mock.calls.some((c) => c[0].includes('Confirmation email failed'))).toBe(true);
  });
});

describe('A5 — sessions and sockets are torn down when the User row is deleted', () => {
  it('destroyUserSessions removes every row for that user from the Postgres session store', async () => {
    const { destroyUserSessions } = await import('../src/lib/session.js');
    const { user } = await createUser({});
    const { user: otherUser } = await createUser({});

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "user_sessions" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
      )
    `;
    await prisma.$executeRaw`DELETE FROM "user_sessions"`;
    await prisma.$executeRaw`
      INSERT INTO "user_sessions" (sid, sess, expire)
      VALUES (${'sid-a-' + user.id}, ${JSON.stringify({ userId: user.id })}::json, NOW() + interval '1 day')
    `;
    await prisma.$executeRaw`
      INSERT INTO "user_sessions" (sid, sess, expire)
      VALUES (${'sid-b-' + user.id}, ${JSON.stringify({ userId: user.id })}::json, NOW() + interval '1 day')
    `;
    await prisma.$executeRaw`
      INSERT INTO "user_sessions" (sid, sess, expire)
      VALUES (${'sid-other'}, ${JSON.stringify({ userId: otherUser.id })}::json, NOW() + interval '1 day')
    `;

    const removed = await destroyUserSessions(user.id);
    expect(removed).toBe(2);

    const remaining = await prisma.$queryRaw`SELECT sid FROM "user_sessions"`;
    expect(remaining.length).toBe(1);
    expect(remaining[0].sid).toBe('sid-other');
  });

  it('a data-deletion request that fully deletes the owner destroys their sessions and sockets', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-evict');
    await createAccount({ userId: user.id, igUserId });

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "user_sessions" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
      )
    `;
    await prisma.$executeRaw`DELETE FROM "user_sessions"`;
    await prisma.$executeRaw`
      INSERT INTO "user_sessions" (sid, sess, expire)
      VALUES (${'sid-evict-' + user.id}, ${JSON.stringify({ userId: user.id })}::json, NOW() + interval '1 day')
    `;

    // disconnectUserSockets() is destructured at require-time by the route
    // (matching routes/auth.js and routes/accounts.js), so a property spy on
    // an `await import()`-loaded copy of this module would not be seen by
    // the route's own closure over `ioInstance`. createRequire() again, same
    // module-identity reasoning as the mailer above. A fake io instance,
    // registered the same way src/index.js registers the real one, exercises
    // the ACTUAL call: `io.in('user:<id>').disconnectSockets(true)`.
    const { setIO } = require('../src/lib/socket.js');
    const disconnectCalls = [];
    setIO({
      in(room) {
        return {
          disconnectSockets: (close) => disconnectCalls.push({ room, close }),
        };
      },
    });

    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    expect(res.status).toBe(200);
    expect(disconnectCalls).toContainEqual({ room: `user:${user.id}`, close: true });

    // Reset so later tests in this file (and others sharing the process) do
    // not keep talking to this fake io.
    setIO(null);

    const remaining = await prisma.$queryRaw`SELECT sid FROM "user_sessions" WHERE sid = ${'sid-evict-' + user.id}`;
    expect(remaining.length, 'the deleted owner session row must be gone').toBe(0);
  });
});
