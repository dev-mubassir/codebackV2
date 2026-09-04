/**
 * Email send failures must not be swallowed — and must not leak.
 *
 * THE BUG. forgot-password caught a failed send and still returned "a reset
 * link is on its way." The user then waits forever for mail that was never
 * sent, with no way to discover that. This was live: the configured sender
 * domain was unverified, so Resend rejected every send with a 403 while the
 * endpoint reported success.
 *
 * THE SUBTLETY, which is why this is not a one-line fix. A reset send is only
 * ATTEMPTED for an address that has an account. So if only those requests
 * returned the degraded response, the degraded response would itself prove the
 * address exists — reintroducing the account-enumeration oracle the endpoint
 * exists to prevent.
 *
 * The resolution: lib/email tracks transport health globally, and
 * forgot-password checks it BEFORE the user lookup. While the transport is
 * down, EVERY address gets the same degraded answer.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

/**
 * MODULE IDENTITY MATTERS HERE.
 *
 * createRequire() and await import() return DIFFERENT instances of a CJS
 * module under Vitest. The route is loaded through the ESM pipeline, so its
 * internal require('../lib/email') resolves to the import() instance — stubbing
 * the createRequire() copy changed nothing the route could see, and the
 * "failure" tests passed only because the route's own call threw a TypeError,
 * which the handler treated as a send failure. Right answer, wrong reason.
 *
 * Resolved in beforeAll via import() so the object stubbed is the object used.
 */
let email;

let app;
let ipCounter = 0;
const nextIp = () => `10.71.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

/**
 * Restore the module's own functions by hand rather than via
 * vi.restoreAllMocks().
 *
 * lib/email is CommonJS and its exports are plain properties on
 * module.exports. Spying on those and then calling restoreAllMocks() left them
 * UNDEFINED rather than restored, so a later test hit
 * "email.sendVerification is not a function" — a broken test masquerading as a
 * broken product. Capturing the originals once and reassigning them is exact.
 */
const ORIGINALS = {};

beforeAll(async () => {
  // createRequire, matching how routes/auth.js itself does
  // `require('../lib/email')` — that is the instance the route actually holds.
  // An await import() here returns a DIFFERENT object, and stubbing it changes
  // nothing the route can see.
  email = require('../src/lib/email/index.js');
  app = buildTestApp();
  for (const name of ['sendPasswordReset', 'sendVerification', 'sendTokenExpiry', 'sendTrialEnding']) {
    ORIGINALS[name] = email[name];
    if (typeof ORIGINALS[name] !== 'function') {
      throw new Error(`harness: expected ${name} to be a function, got ${typeof ORIGINALS[name]}`);
    }
  }
});

beforeEach(async () => {
  await resetDb();
  restoreEmail();
  email._resetHealth();
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreEmail();
  email._resetHealth();
});

/**
 * Swap a send function for the duration of one test.
 *
 * DELIBERATELY NOT vi.spyOn. lib/email is CommonJS, and spying on its exported
 * properties then restoring them left the property UNDEFINED — producing
 * "email.sendVerification is not a function" in a LATER test, i.e. a broken
 * test masquerading as a broken product. Plain assignment with an explicit
 * restore is fully under our control and cannot drift.
 */
function stubSend(name, impl) {
  email[name] = impl;
}

function restoreEmail() {
  for (const [name, fn] of Object.entries(ORIGINALS)) email[name] = fn;
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('email failure — the send is not swallowed', () => {
  it('THE BUG: a failed reset send must NOT report success', async () => {
    const { user } = await createUser({});
    stubSend('sendPasswordReset', async () => {
      throw new Error('Resend rejected the message: The mail.siffty.com domain is not verified.');
    });

    const res = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email });

    expect(res.status, 'the old code returned 200 with "a reset link is on its way"').toBe(503);
    expect(res.body.code).toBe('EMAIL_UNAVAILABLE');
    expect(
      JSON.stringify(res.body),
      'it must not claim delivery it could not make'
    ).not.toMatch(/on its way/i);
  });

  it('the degraded response does NOT reveal whether the address exists', async () => {
    const { user } = await createUser({});
    stubSend('sendPasswordReset', async () => {
      throw new Error('transport down');
    });

    // First request: a REAL address. This trips the degraded flag.
    const real = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email });

    // Second request: an address that does NOT exist. No send is attempted for
    // it at all — yet it must answer identically, or the difference IS the
    // oracle.
    const fake = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: `ghost-${uniq('x')}@test.codeback` });

    expect(real.status).toBe(503);
    expect(fake.status, 'a non-existent address must get the SAME answer').toBe(503);
    expect(JSON.stringify(fake.body)).toBe(JSON.stringify(real.body));
  });

  it('DEMONSTRATION: without the global flag, the two would differ', async () => {
    // With the transport healthy, an existing address gets 200 and a
    // non-existent one also gets 200 — that is the normal, uniform case.
    const { user } = await createUser({});

    const real = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email });
    const fake = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: `ghost-${uniq('y')}@test.codeback` });

    expect(real.status).toBe(200);
    expect(fake.status).toBe(200);
    expect(JSON.stringify(real.body)).toBe(JSON.stringify(fake.body));

    // A per-request (non-global) degraded response would have produced 503 for
    // the real address and 200 for the fake one — different, and therefore an
    // oracle. That is precisely what the health flag prevents.
  });

  it('recovers once the transport works again', async () => {
    const { user } = await createUser({});

    stubSend('sendPasswordReset', async () => {
      throw new Error('transient failure');
    });

    const failed = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email });
    expect(failed.status).toBe(503);

    // Simulate the operator verifying the domain.
    stubSend('sendPasswordReset', async () => ({ id: 'ok', transport: 'test' }));
    email._resetHealth();

    const recovered = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', nextIp())
      .send({ email: user.email });
    expect(recovered.status, 'a fixed transport must resume normal behaviour').toBe(200);
  });
});

describe('email failure — registration does not falsely promise', () => {
  it('reports emailVerificationSent: false when the send fails', async () => {
    stubSend('sendVerification', async () => {
      throw new Error('domain not verified');
    });

    const res = await request(app)
      .post('/auth/register')
      .set('X-Forwarded-For', nextIp())
      .send({
        name: 'Mail Broken',
        email: `broken-${uniq('r')}@test.codeback`,
        password: 'a-good-password-1',
        confirmPassword: 'a-good-password-1',
      });

    expect(res.status, 'registration itself must still succeed').toBe(201);
    expect(res.body.emailVerificationSent).toBe(false);
    expect(
      res.body.message,
      'it must not tell them to check an inbox that will receive nothing'
    ).not.toMatch(/check your email/i);
    expect(res.body.message).toMatch(/could(n't| not) send/i);
  });

  it('reports emailVerificationSent: true when it works', async () => {
    const res = await request(app)
      .post('/auth/register')
      .set('X-Forwarded-For', nextIp())
      .send({
        name: 'Mail Fine',
        email: `fine-${uniq('r')}@test.codeback`,
        password: 'a-good-password-1',
        confirmPassword: 'a-good-password-1',
      });

    expect(res.status).toBe(201);
    expect(res.body.emailVerificationSent, 'positive control').toBe(true);
    expect(res.body.message).toMatch(/check your email/i);
  });
});

describe('email transport contract', () => {
  it('the Resend transport THROWS on an error response rather than returning quietly', async () => {
    // The SDK reports failures in the response BODY rather than by throwing,
    // so an unchecked call looks successful while sending nothing. This is the
    // exact mistake that makes a reset "succeed" with no mail sent.
    const previousKey = process.env.RESEND_API_KEY;
    const previousEnv = process.env.NODE_ENV;
    process.env.RESEND_API_KEY = 're_fake_key_for_contract_test';
    // pickTransport() hard-forces the console transport under NODE_ENV=test so
    // the suite can never reach a real mailbox. Lift that here ONLY, to
    // exercise the Resend branch against a mocked SDK.
    process.env.NODE_ENV = 'development';

    try {
      vi.doMock('resend', () => ({
        Resend: class {
          constructor() {
            this.emails = {
              send: async () => ({
                data: null,
                error: { name: 'validation_error', message: 'domain is not verified', statusCode: 403 },
              }),
            };
          }
        },
      }));

      // Re-import so the mocked SDK is picked up.
      vi.resetModules();
      const freshEmail = (await import('../src/lib/email/index.js')).default;

      await expect(
        freshEmail.sendPasswordReset('someone@example.com', { url: 'https://x/y', expiresInMinutes: 30 })
      ).rejects.toThrow(/not verified|Resend rejected/i);
    } finally {
      vi.doUnmock('resend');
      vi.resetModules();
      process.env.NODE_ENV = previousEnv;
      if (previousKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousKey;
    }
  });
});
