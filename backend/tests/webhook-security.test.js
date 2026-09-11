/**
 * P6 — webhook security and idempotency.
 *
 * There was NO webhook test coverage at all before this file: the old test
 * harness mounted only /auth and used a plain express.json(), so it could not
 * even produce the req.rawBody that signature verification depends on. The
 * harness now has raw-body parity with production, which is what makes these
 * assertions mean anything.
 *
 * Covers the nine required scenarios plus the delivery-level idempotency added
 * in this phase.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const aiService = require('../src/services/aiService.js');
const instagram = require('../src/lib/instagram.js');

let app;

const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

function sign(rawBody) {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
}

/** POST a webhook body with a correct signature unless told otherwise. */
function postWebhook(bodyObject, { signature, rawOverride } = {}) {
  const raw = rawOverride ?? JSON.stringify(bodyObject);
  return request(app)
    .post('/webhooks/instagram')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signature ?? sign(raw))
    .send(raw);
}

/**
 * Wait for a fire-and-forget side effect.
 *
 * The route returns 200 BEFORE processing — deliberately, because Meta
 * disables endpoints that time out. So a test cannot assert on database state
 * the instant the response arrives; it has to wait for the continuation.
 *
 * Polling rather than a fixed sleep: a sleep long enough to be reliable is
 * long enough to make the suite slow, and one short enough to be fast is
 * flaky. This returns as soon as the condition holds, and fails loudly with
 * the supplied description if it never does.
 */
async function waitFor(condition, description, { timeoutMs = 4000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await condition();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for: ${description} (last value: ${JSON.stringify(last)})`);
}

function messageEvent({ igUserId, senderIgsid, mid, text = 'hello there', isEcho = false }) {
  return {
    object: 'instagram',
    entry: [
      {
        id: igUserId,
        time: Date.now(),
        messaging: [
          {
            sender: { id: senderIgsid },
            recipient: { id: igUserId },
            timestamp: Date.now(),
            message: { mid, text, ...(isEcho ? { is_echo: true } : {}) },
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  const webhookRoutes = (await import('../src/routes/webhook.js')).default;
  app = buildTestApp({ mount: { '/webhooks/instagram': webhookRoutes } });
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

describe('P6 — verification handshake', () => {
  it('1. correct token -> 200 and echoes the challenge', async () => {
    const res = await request(app).get('/webhooks/instagram').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': 'challenge-12345',
    });

    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-12345');
  });

  it('2. wrong token -> 403 and no challenge echoed', async () => {
    const res = await request(app).get('/webhooks/instagram').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'not-the-token',
      'hub.challenge': 'challenge-12345',
    });

    expect(res.status).toBe(403);
    expect(res.text).not.toContain('challenge-12345');
  });

  it('an UNSET verify token fails closed rather than matching undefined', async () => {
    // The old comparison was a plain ===, so with the env var unset a request
    // carrying no hub.verify_token evaluated undefined === undefined -> true,
    // letting any Meta app complete the handshake against this endpoint.
    const previous = process.env.WEBHOOK_VERIFY_TOKEN;
    delete process.env.WEBHOOK_VERIFY_TOKEN;
    try {
      const res = await request(app)
        .get('/webhooks/instagram')
        .query({ 'hub.mode': 'subscribe', 'hub.challenge': 'x' });
      expect(res.status, 'must refuse, not accept an undefined==undefined match').toBe(503);
    } finally {
      process.env.WEBHOOK_VERIFY_TOKEN = previous;
    }
  });
});

describe('P6 — signature verification', () => {
  it('3. a valid signature is processed', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-valid');
    await createAccount({ userId: user.id, igUserId });

    const res = await postWebhook(
      messageEvent({ igUserId, senderIgsid: uniq('sender'), mid: uniq('mid') })
    );

    expect(res.status).toBe(200);
    expect(res.text).toBe('EVENT_RECEIVED');
  });

  it('4. a TAMPERED body is rejected with 401 and nothing is written', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-tampered');
    await createAccount({ userId: user.id, igUserId });

    const genuine = JSON.stringify(
      messageEvent({ igUserId, senderIgsid: uniq('s'), mid: uniq('mid') })
    );
    const tampered = JSON.stringify(
      messageEvent({ igUserId, senderIgsid: uniq('s'), mid: uniq('mid'), text: 'INJECTED' })
    );

    const res = await postWebhook(null, { rawOverride: tampered, signature: sign(genuine) });

    expect(res.status).toBe(401);
    expect(await prisma.message.count(), 'a forged body must write nothing').toBe(0);
  });

  it('a missing signature header is rejected', async () => {
    const res = await request(app)
      .post('/webhooks/instagram')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ object: 'instagram', entry: [] }));

    expect(res.status).toBe(401);
  });

  it('the HMAC is computed over the RAW BYTES, so multi-byte content verifies', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-utf8');
    await createAccount({ userId: user.id, igUserId });

    // The old string-accumulating parser re-encoded via setEncoding('utf8'),
    // so a signature over the original bytes could never match.
    const res = await postWebhook(
      messageEvent({
        igUserId,
        senderIgsid: uniq('s'),
        mid: uniq('mid'),
        text: 'café 日本語 🎉 — multi-byte',
      })
    );

    expect(res.status).toBe(200);
  });
});

describe('P6 — idempotency', () => {
  it('5. a duplicate delivery is processed EXACTLY once', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-dupe');
    await createAccount({ userId: user.id, igUserId });

    const body = messageEvent({ igUserId, senderIgsid: uniq('s'), mid: uniq('mid') });
    const raw = JSON.stringify(body);

    const first = await postWebhook(null, { rawOverride: raw });
    const second = await postWebhook(null, { rawOverride: raw });

    // Meta must always see a 200 — anything else invites more retries.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const deliveries = await prisma.webhookDelivery.count();
    expect(deliveries, 'the same bytes must record one delivery, not two').toBe(1);

    await waitFor(
      async () => (await prisma.webhookLog.count()) >= 1,
      'the first delivery to be processed'
    );
    // Give any (incorrect) second processing a chance to appear before asserting.
    await new Promise((r) => setTimeout(r, 250));
    const logs = await prisma.webhookLog.count();
    expect(
      logs,
      'a retry previously re-ran processEntry and wrote a second log row containing the customer message text'
    ).toBe(1);
  });

  it('two DIFFERENT deliveries in the same second are both processed', async () => {
    // This is why the key is a body hash rather than (entry.id, entry.time):
    // those two would collide here and the second real customer message would
    // be silently dropped.
    const { user } = await createUser({});
    const igUserId = uniq('ig-sametime');
    await createAccount({ userId: user.id, igUserId });

    const fixedTime = Date.now();
    const makeBody = (text, mid) => ({
      object: 'instagram',
      entry: [
        {
          id: igUserId,
          time: fixedTime, // IDENTICAL entry.id AND entry.time
          messaging: [
            {
              sender: { id: uniq('sender') },
              recipient: { id: igUserId },
              timestamp: fixedTime,
              message: { mid, text },
            },
          ],
        },
      ],
    });

    await postWebhook(makeBody('first real message', uniq('mid')));
    await postWebhook(makeBody('second real message', uniq('mid')));

    expect(
      await prisma.webhookDelivery.count(),
      'different bodies must be two distinct deliveries even at the same timestamp'
    ).toBe(2);
    await waitFor(
      async () => (await prisma.message.count()) === 2,
      'both messages to be stored'
    );
  });
});

describe('P6 — unknown, disconnected, and echo events', () => {
  it('6. a payload for an UNKNOWN account is 200 and ignored', async () => {
    const res = await postWebhook(
      messageEvent({
        igUserId: uniq('ig-never-seen'),
        senderIgsid: uniq('s'),
        mid: uniq('mid'),
        text: 'this text must never be stored for an account Codeback has never linked',
      })
    );

    expect(res.status).toBe(200);

    const log = await waitFor(
      () => prisma.webhookLog.findFirst({}),
      'the unmapped event to be logged'
    );
    expect(log.eventType).toBe('unmapped');
    expect(await prisma.message.count()).toBe(0);

    // Gate 1-F / 4b: metadata only, never the message body, for an account
    // Codeback has no linked customer to act on this content for.
    expect(log.payload, 'no message content stored for an unmapped account').toBeNull();
    expect(log.instagramAccountId).toBeNull();
  });

  it('a payload for a DISCONNECTED account is 200 and ignored', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-disconnected');
    const account = await createAccount({ userId: user.id, igUserId });
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { connectionStatus: 'DISCONNECTED' },
    });

    const res = await postWebhook(
      messageEvent({ igUserId, senderIgsid: uniq('s'), mid: uniq('mid') })
    );

    expect(res.status).toBe(200);

    const log = await waitFor(
      () => prisma.webhookLog.findFirst({}),
      'the disconnected-account event to be logged'
    );
    expect(log.eventType).toBe('skipped_disconnected');
    expect(await prisma.message.count()).toBe(0);
  });

  it('7. an is_echo message is ignored and triggers NO AI call', async () => {
    // This is a COST control as much as a correctness one: our own outbound
    // DMs must never be classified.
    const analyze = vi.spyOn(aiService, 'analyzeConversation');

    const { user } = await createUser({});
    const igUserId = uniq('ig-echo');
    await createAccount({ userId: user.id, igUserId });

    const res = await postWebhook(
      messageEvent({ igUserId, senderIgsid: igUserId, mid: uniq('mid'), isEcho: true })
    );

    expect(res.status).toBe(200);
    expect(await prisma.message.count(), 'an echo must not be stored as an inbound message').toBe(0);
    expect(analyze, 'an echo must never reach the AI provider').not.toHaveBeenCalled();
  });
});

describe('P6 — response timing', () => {
  it('the 200 is returned before processing, not after', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-timing');
    await createAccount({ userId: user.id, igUserId });

    // Meta disables endpoints that time out repeatedly, so the response must
    // not wait on contact lookups, Graph calls, or the AI queue.
    const started = Date.now();
    const res = await postWebhook(
      messageEvent({ igUserId, senderIgsid: uniq('s'), mid: uniq('mid') })
    );
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(elapsed, 'the acknowledgement must be fast').toBeLessThan(2000);
  });
});

describe('P6 — 8 & 9: deauthorize and data deletion callbacks', () => {
  let deletionApp;

  beforeAll(async () => {
    const dataDeletionRoutes = (await import('../src/routes/dataDeletion.js')).default;
    deletionApp = buildTestApp({ mount: { '/data-deletion': dataDeletionRoutes } });
  });

  /** Build the signed_request shape Meta posts. */
  function signedRequest(payload) {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
      .createHmac('sha256', APP_SECRET)
      .update(encodedPayload)
      .digest('base64url');
    return `${sig}.${encodedPayload}`;
  }

  it('8. a deauthorize callback marks the account disconnected', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-deauth');
    const account = await createAccount({ userId: user.id, igUserId });

    const res = await request(deletionApp)
      .post('/data-deletion/deauthorize')
      .send({
        signed_request: signedRequest({ algorithm: 'HMAC-SHA256', user_id: igUserId }),
      });

    expect(res.status).toBe(200);

    const after = await prisma.instagramAccount.findUnique({ where: { id: account.id } });
    expect(after.connectionStatus).toBe('DISCONNECTED');
    expect(after.tokenStatus).toBe('NEEDS_RECONNECT');
    expect(
      after.tokenCiphertext,
      'a token Meta has already killed must not be kept at rest'
    ).toBeNull();

    // Deauthorization is NOT a deletion request — history must survive.
    expect(
      await prisma.instagramAccount.count({ where: { id: account.id } }),
      'removing an app permission is not a request to erase message history'
    ).toBe(1);
  });

  it('a deauthorize callback with a bad signature changes nothing', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-deauth-bad');
    const account = await createAccount({ userId: user.id, igUserId });

    const encodedPayload = Buffer.from(
      JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: igUserId })
    ).toString('base64url');
    const forged = `${Buffer.from('wrong').toString('base64url')}.${encodedPayload}`;

    const res = await request(deletionApp)
      .post('/data-deletion/deauthorize')
      .send({ signed_request: forged });

    expect(res.status).toBe(400);
    const after = await prisma.instagramAccount.findUnique({ where: { id: account.id } });
    expect(after.connectionStatus).toBe('CONNECTED');
  });

  it('9. a data-deletion callback returns a code that the status endpoint can VERIFY', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-delete');
    await createAccount({ userId: user.id, igUserId });

    const res = await request(deletionApp)
      .post('/data-deletion/instagram')
      .send({
        signed_request: signedRequest({ algorithm: 'HMAC-SHA256', user_id: igUserId }),
      });

    expect(res.status).toBe(200);
    expect(res.body.confirmation_code).toBeTruthy();
    expect(res.body.url, 'Meta requires an ABSOLUTE url').toMatch(/^https?:\/\//);

    const status = await request(deletionApp)
      .get('/data-deletion/status')
      .query({ code: res.body.confirmation_code });
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('completed');
  });

  it('an UNKNOWN confirmation code is not reported as completed', async () => {
    // Previously the status endpoint returned a static "completed" for any
    // string at all, including one nobody had ever issued.
    const status = await request(deletionApp)
      .get('/data-deletion/status')
      .query({ code: 'never-issued-' + uniq('x') });

    expect(status.status).toBe(404);
    expect(status.body.status).toBe('unknown');
  });
});
