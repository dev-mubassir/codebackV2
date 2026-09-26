/**
 * Gate 3 changes:
 *   F2  two Siffty tenants DM each other — both store the message (the
 *       Instagram message id is unique per conversation, not globally)
 *   F3  a Meta deletion callback erases only the Meta-derived data for that
 *       Instagram account, for every tenant holding it — never a Siffty login,
 *       billing, or another connected account; the confirmation code and
 *       status URL are still returned
 *   D   the pre-switch secrets self-check (tokens decrypt, identities recompute)
 *   dbUrl  the HA addon's parts build a single-host, encoded DATABASE_URL
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const instagram = require('../src/lib/instagram.js');
const aiService = require('../src/services/aiService.js');
const { encrypt } = require('../src/lib/crypto.js');
const { hashIgUserId } = require('../src/lib/igIdentity.js');
const { runSecretSelfCheck } = require('../src/lib/secretSelfCheck.js');
const { resolveDatabaseUrl } = require('../src/lib/dbUrl.js');

let app;
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;

const sigHub = (raw) => 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
function signedRequest(payload) {
  const body = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', ...payload })).toString('base64url');
  return `${crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url')}.${body}`;
}
async function waitFor(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out: ${what}`);
}

beforeAll(async () => {
  app = buildTestApp({
    mount: {
      '/webhooks/instagram': (await import('../src/routes/webhook.js')).default,
      '/data-deletion': (await import('../src/routes/dataDeletion.js')).default,
    },
  });
});
beforeEach(async () => {
  await resetDb();
  vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
  vi.spyOn(aiService, 'analyzeConversation').mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => prisma.$disconnect());

describe('F2 — two Siffty tenants DM each other', () => {
  it('the sender keeps its outbound row AND the recipient stores the inbound copy of the same Meta message id', async () => {
    const a = await createUser({});
    const b = await createUser({});
    const igA = uniq('ig-a');
    const igB = uniq('ig-b');
    const accountA = await createAccount({ userId: a.user.id, igUserId: igA });
    await createAccount({ userId: b.user.id, igUserId: igB });

    // A replies to B through Siffty: stored as A's outbound message with Meta's id.
    const mid = uniq('mid-shared');
    const contactB = await prisma.contact.create({ data: { instagramAccountId: accountA.id, igsid: igB } });
    const convA = await prisma.conversation.create({ data: { instagramAccountId: accountA.id, contactId: contactB.id } });
    await prisma.message.create({ data: { conversationId: convA.id, direction: 'outbound', content: 'hi from A', igMessageId: mid } });

    // Meta delivers the same message to B's account as an inbound DM.
    const raw = JSON.stringify({
      object: 'instagram',
      entry: [{ id: igB, time: Date.now(), messaging: [{ sender: { id: igA }, recipient: { id: igB }, timestamp: Date.now(), message: { mid, text: 'hi from A' } }] }],
    });
    const res = await request(app).post('/webhooks/instagram').set('Content-Type', 'application/json').set('x-hub-signature-256', sigHub(raw)).send(raw);
    expect(res.status).toBe(200);

    const rows = await waitFor(async () => {
      const r = await prisma.message.findMany({ where: { igMessageId: mid }, include: { conversation: { include: { instagramAccount: true } } } });
      return r.length === 2 ? r : null;
    }, 'both copies stored');
    const owners = rows.map((m) => m.conversation.instagramAccount.userId).sort();
    expect(owners).toEqual([a.user.id, b.user.id].sort());
    expect(rows.find((m) => m.conversation.instagramAccount.userId === b.user.id).direction).toBe('inbound');
  });

  it('within ONE conversation the id is still unique (a Meta retry is not stored twice)', async () => {
    const { user } = await createUser({});
    const account = await createAccount({ userId: user.id, igUserId: uniq('ig') });
    const contact = await prisma.contact.create({ data: { instagramAccountId: account.id, igsid: uniq('c') } });
    const conv = await prisma.conversation.create({ data: { instagramAccountId: account.id, contactId: contact.id } });
    await prisma.message.create({ data: { conversationId: conv.id, direction: 'inbound', igMessageId: 'mid-x' } });
    await expect(prisma.message.create({ data: { conversationId: conv.id, direction: 'inbound', igMessageId: 'mid-x' } })).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('F3 — a Meta deletion erases Instagram data only', () => {
  it('erases the account and its Meta-derived data for every holder; never a Siffty login, billing, or other accounts', async () => {
    const igUserId = uniq('ig-erase');
    const earlier = await createUser({});
    const current = await createUser({});
    const old = await createAccount({ userId: earlier.user.id, igUserId, withConversation: true });
    await prisma.instagramAccount.update({ where: { id: old.id }, data: { connectionStatus: 'DISCONNECTED' } });
    const live = await createAccount({ userId: current.user.id, igUserId, withConversation: true });
    const other = await createAccount({ userId: current.user.id, igUserId: uniq('ig-other'), withConversation: true });

    const conv = await prisma.conversation.findFirst({ where: { instagramAccountId: live.id } });
    await prisma.message.create({ data: { conversationId: conv.id, direction: 'inbound', content: 'erase me', igMessageId: uniq('m') } });
    const note = await prisma.notification.create({ data: { userId: current.user.id, type: 'high_priority_conversation', title: 'from the erased chat', conversationId: conv.id } });
    const order = await prisma.order.create({ data: { cashfreeOrderId: uniq('sfy'), tenantId: earlier.user.id, planCode: 'STARTER', amount: 49900, currency: 'INR' } });

    const res = await request(app).post('/data-deletion/instagram').send({ signed_request: signedRequest({ user_id: igUserId }) });
    expect(res.status).toBe(200);
    expect(res.body.confirmation_code).toMatch(/^[0-9a-f]{24}$/);
    expect(res.body.url).toContain(`/data-deletion?code=${res.body.confirmation_code}`);

    // Erased: both holders' connections, their conversations/messages, and the notification.
    expect(await prisma.instagramAccount.count({ where: { igUserId } })).toBe(0);
    expect(await prisma.conversation.count({ where: { instagramAccountId: { in: [old.id, live.id] } } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(0);
    expect(await prisma.notification.findUnique({ where: { id: note.id } })).toBeNull();

    // Kept: both Siffty logins, the earlier owner's billing, the other account.
    expect(await prisma.user.findUnique({ where: { id: earlier.user.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: current.user.id } })).not.toBeNull();
    expect(await prisma.entitlement.findUnique({ where: { userId: earlier.user.id } })).not.toBeNull();
    expect(await prisma.order.findUnique({ where: { id: order.id } })).not.toBeNull();
    expect(await prisma.instagramAccount.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect(await prisma.conversation.count({ where: { instagramAccountId: other.id } })).toBe(1);

    // The status URL still resolves the request as completed.
    const status = await prisma.deletionRequest.findUnique({ where: { code: res.body.confirmation_code } });
    expect(status.status).toBe('COMPLETED');
  });
});

describe('D — pre-switch secrets self-check', () => {
  it('100% when the tokens and ledger were written with this environment’s key and pepper', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-self');
    await createAccount({ userId: user.id, igUserId });
    await prisma.instagramIdentity.create({ data: { igUserIdHash: hashIgUserId(igUserId) } });
    const r = await runSecretSelfCheck();
    expect(r.tokens).toMatchObject({ total: 1, decryptable: 1, percent: 100 });
    expect(r.identities).toMatchObject({ accounts: 1, matched: 1, percent: 100 });
    expect(r.pass).toBe(true);
  });

  it('fails when a token was written with a different key, or the ledger with a different pepper', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-self');
    const account = await createAccount({ userId: user.id, igUserId });
    // A token encrypted under another key, and a ledger hash under another pepper.
    const savedKey = process.env.TOKEN_ENCRYPTION_KEY;
    const savedPepper = process.env.IG_IDENTITY_PEPPER;
    process.env.TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
    process.env.IG_IDENTITY_PEPPER = 'a-different-pepper-for-this-test-only-000000';
    let foreignToken;
    let foreignHash;
    try {
      foreignToken = encrypt('token-from-another-environment');
      foreignHash = hashIgUserId(igUserId);
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = savedKey;
      process.env.IG_IDENTITY_PEPPER = savedPepper;
    }
    await prisma.instagramAccount.update({ where: { id: account.id }, data: { accessToken: foreignToken } });
    await prisma.instagramIdentity.create({ data: { igUserIdHash: foreignHash } });

    const r = await runSecretSelfCheck();
    expect(r.tokens.percent).toBe(0);
    expect(r.identities.percent).toBe(0);
    expect(r.pass).toBe(false);
  });
});

describe('DATABASE_URL from the HA addon’s parts', () => {
  it('builds a single-host, encoded URL from the parts and prefers it; falls back to DATABASE_URL', () => {
    const url = resolveDatabaseUrl({ DB_HOST: 'primary--pg:5432,read--pg:5432', DB_USER: 'u@1', DB_PASSWORD: 'p:w/#?', DB_NAME: 'db1', DATABASE_URL: 'postgresql://bad' });
    expect(url).toBe('postgresql://u%401:p%3Aw%2F%23%3F@primary--pg:5432/db1?sslmode=require');
    expect(resolveDatabaseUrl({ DB_HOST: 'h', DB_PORT: '6543', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' })).toBe('postgresql://u:p@h:6543/d?sslmode=require');
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgresql://x' })).toBe('postgresql://x');
  });
});
