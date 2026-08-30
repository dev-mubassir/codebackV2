/**
 * C1/M3 — the Meta data deletion callback, and the retention promise the
 * published privacy policy now makes.
 *
 * This endpoint is unauthenticated by design (Meta calls it server-to-server),
 * so the signed_request HMAC is the only thing standing between an attacker
 * and "delete any tenant by Instagram user id". It is tested accordingly.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';

import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';

const dataDeletionRoutes = (await import('../src/routes/dataDeletion.js')).default;
const { pruneWebhookPayloads } = await import('../src/jobs/retentionJob.js');

const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;

let app;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/data-deletion', dataDeletionRoutes);
});

beforeEach(async () => {
  await resetDb();
});

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Build a signed_request exactly the way Meta does. */
function signedRequest(payload, secret = APP_SECRET) {
  const encodedPayload = b64url(JSON.stringify({ algorithm: 'HMAC-SHA256', ...payload }));
  const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  return `${b64url(sig)}.${encodedPayload}`;
}

describe('C1 — Meta data deletion callback', () => {
  it('deletes the account and all of its data for a validly signed request', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-del');
    const account = await createAccount({ userId: user.id, igUserId, withConversation: true });

    await prisma.webhookLog.create({
      data: {
        instagramAccountId: account.id,
        igUserId,
        eventType: 'messaging',
        status: 'SUCCESS',
        payload: JSON.stringify({ text: 'a private customer message' }),
      },
    });

    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    expect(res.status).toBe(200);
    expect(res.body.confirmation_code, 'Meta requires a confirmation_code').toBeTruthy();
    expect(res.body.url, 'Meta requires a status URL').toContain('/data-deletion');

    expect(await prisma.instagramAccount.findUnique({ where: { igUserId } })).toBeNull();
    expect(await prisma.conversation.count({ where: { instagramAccountId: account.id } })).toBe(0);
    expect(await prisma.contact.count({ where: { instagramAccountId: account.id } })).toBe(0);
  });

  it('leaves no webhook payload behind after deletion (M3)', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-del-logs');
    const account = await createAccount({ userId: user.id, igUserId, withConversation: true });

    await prisma.webhookLog.create({
      data: {
        instagramAccountId: account.id,
        igUserId,
        eventType: 'messaging',
        status: 'SUCCESS',
        payload: JSON.stringify({ text: 'a private customer message' }),
      },
    });

    await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    const orphaned = await prisma.webhookLog.findMany({ where: { igUserId } });
    expect(
      orphaned.length,
      'webhook logs holding customer message text must not survive deletion'
    ).toBe(0);
  });

  it('removes the user record when no other account remains', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-del-user');
    await createAccount({ userId: user.id, igUserId, withConversation: false });

    await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: igUserId }) });

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it('keeps the user when they still have another connected account', async () => {
    const { user } = await createUser({});
    const igA = uniq('ig-keep-a');
    const igB = uniq('ig-keep-b');
    await createAccount({ userId: user.id, igUserId: igA });
    await createAccount({ userId: user.id, igUserId: igB });

    await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: igA }) });

    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(await prisma.instagramAccount.findUnique({ where: { igUserId: igB } })).not.toBeNull();
  });

  it('rejects a request signed with the wrong secret and deletes nothing', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-forged');
    await createAccount({ userId: user.id, igUserId, withConversation: true });

    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: igUserId }, 'attacker-secret') });

    expect(res.status).toBe(400);
    expect(
      await prisma.instagramAccount.findUnique({ where: { igUserId } }),
      'a forged signature must not delete a tenant'
    ).not.toBeNull();
  });

  it('rejects a tampered payload whose signature no longer matches', async () => {
    const { user } = await createUser({});
    const victimIg = uniq('ig-victim');
    await createAccount({ userId: user.id, igUserId: victimIg, withConversation: true });

    // Validly signed for one id, then the payload is swapped for the victim's.
    const valid = signedRequest({ user_id: 'some-other-account' });
    const [sig] = valid.split('.');
    const tamperedPayload = b64url(
      JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: victimIg })
    );

    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: `${sig}.${tamperedPayload}` });

    expect(res.status).toBe(400);
    expect(await prisma.instagramAccount.findUnique({ where: { igUserId: victimIg } })).not.toBeNull();
  });

  it('rejects a missing signed_request', async () => {
    const res = await request(app).post('/data-deletion/instagram').send({});
    expect(res.status).toBe(400);
  });

  it('succeeds harmlessly for an account that does not exist', async () => {
    const res = await request(app)
      .post('/data-deletion/instagram')
      .send({ signed_request: signedRequest({ user_id: 'never-connected' }) });

    expect(res.status).toBe(200);
    expect(res.body.confirmation_code).toBeTruthy();
  });
});

describe('M3 — 30-day webhook payload retention', () => {
  it('redacts payloads older than the window but keeps the metadata row', async () => {
    const { user } = await createUser({});
    const account = await createAccount({ userId: user.id, igUserId: uniq('ig-retain') });

    const old = await prisma.webhookLog.create({
      data: {
        instagramAccountId: account.id,
        igUserId: account.igUserId,
        eventType: 'messaging',
        status: 'SUCCESS',
        payload: JSON.stringify({ text: 'old customer message' }),
        createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      },
    });

    const recent = await prisma.webhookLog.create({
      data: {
        instagramAccountId: account.id,
        igUserId: account.igUserId,
        eventType: 'messaging',
        status: 'SUCCESS',
        payload: JSON.stringify({ text: 'recent customer message' }),
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });

    const count = await pruneWebhookPayloads();
    expect(count).toBeGreaterThanOrEqual(1);

    const oldAfter = await prisma.webhookLog.findUnique({ where: { id: old.id } });
    expect(oldAfter, 'the metadata row is retained').not.toBeNull();
    expect(oldAfter.payload, 'message content past 30 days must be erased').toBeNull();
    expect(oldAfter.eventType).toBe('messaging');

    const recentAfter = await prisma.webhookLog.findUnique({ where: { id: recent.id } });
    expect(recentAfter.payload, 'payloads inside the window are untouched').not.toBeNull();
  });

  it('is idempotent', async () => {
    const { user } = await createUser({});
    const account = await createAccount({ userId: user.id, igUserId: uniq('ig-idem') });
    await prisma.webhookLog.create({
      data: {
        instagramAccountId: account.id,
        eventType: 'messaging',
        status: 'SUCCESS',
        payload: JSON.stringify({ text: 'old' }),
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      },
    });

    await pruneWebhookPayloads();
    const second = await pruneWebhookPayloads();
    expect(second, 'a second run has nothing left to do').toBe(0);
  });
});
