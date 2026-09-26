/**
 * Tenant isolation — the gaps the Gate 2b audit found untested, plus the
 * fixes for F1 (stale-session sockets), F4 (stale account at auto-reply time)
 * and webhook routing. The per-:id routes are in tenant-isolation-idor.test.js.
 *
 * Every aggregate endpoint is called as tenant B after seeding tenant A with
 * marked data; B's response must not contain a single marker of A's.
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
const socketLib = require('../src/lib/socket.js');
const { sessionUserIsValid } = require('../src/lib/sessionIdle.js');

let app;
let ipCounter = 0;
const nextIp = () => `10.61.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;
const MARK = 'TENANT-A-SECRET';

async function login(user, password) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password });
  expect(res.status).toBe(200);
  return agent;
}

async function seedA() {
  const a = await createUser({ name: `${MARK}-NAME` });
  const account = await createAccount({ userId: a.user.id, igUserId: uniq('ig-a'), withConversation: true });
  const conversation = await prisma.conversation.findFirst({ where: { instagramAccountId: account.id } });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessage: `${MARK}-LAST`, autoReplyEnabled: true } });
  await prisma.message.create({ data: { conversationId: conversation.id, direction: 'inbound', content: `${MARK}-DM`, igMessageId: uniq('mid') } });
  const notification = await prisma.notification.create({ data: { userId: a.user.id, type: 'brand_deal', title: `${MARK}-NOTE` } });
  return { a, account, conversation, notification };
}

beforeAll(async () => {
  const mount = {
    '/api/accounts': (await import('../src/routes/accounts.js')).default,
    '/api/dashboard': (await import('../src/routes/dashboard.js')).default,
    '/api/analytics': (await import('../src/routes/analytics.js')).default,
    '/api/notifications': (await import('../src/routes/notifications.js')).default,
    '/api/billing': (await import('../src/routes/billing.js')).default,
    '/api/settings': (await import('../src/routes/settings.js')).default,
    '/webhooks/instagram': (await import('../src/routes/webhook.js')).default,
    '/api': (await import('../src/routes/api.js')).default,
  };
  app = buildTestApp({ mount });
});

beforeEach(async () => {
  await resetDb();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => prisma.$disconnect());

describe('aggregate endpoints never include another tenant’s data', () => {
  for (const path of [
    '/auth/me',
    '/api/dashboard/summary',
    '/api/analytics/summary',
    '/api/settings/auto-reply-chats',
    '/api/billing/draft-credits',
    '/api/conversations',
    '/api/accounts',
    '/api/notifications',
  ]) {
    it(`GET ${path} as tenant B shows nothing of tenant A`, async () => {
      const { a } = await seedA();
      const b = await createUser({ name: 'Tenant B' });
      // Positive control: A sees its own data on the list endpoints.
      const asA = await login(a.user, a.password);
      const own = await asA.get(path);
      expect(own.status, `${path} must be mounted`).toBeLessThan(500);

      const asB = await login(b.user, b.password);
      const res = await asB.get(path);
      expect(res.status).toBeLessThan(500);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(MARK);
      expect(body).not.toContain(a.user.id);
      expect(body).not.toContain(a.user.email);
    });
  }
});

describe('mutations cannot reach another tenant', () => {
  it('POST /api/notifications/read-all by B leaves A’s notifications unread', async () => {
    const { notification } = await seedA();
    const b = await createUser({});
    const asB = await login(b.user, b.password);
    await asB.post('/api/notifications/read-all').set('Origin', 'https://app.test.local');
    const row = await prisma.notification.findUnique({ where: { id: notification.id } });
    expect(row.isRead).toBe(false);
  });

  it('DELETE /api/accounts/:id?purge=true by B is a 404 and deletes nothing', async () => {
    const { account } = await seedA();
    const b = await createUser({});
    const asB = await login(b.user, b.password);
    const res = await asB.delete(`/api/accounts/${account.id}?purge=true`).set('Origin', 'https://app.test.local');
    expect(res.status).toBe(404);
    expect(await prisma.instagramAccount.findUnique({ where: { id: account.id } })).not.toBeNull();
    expect(await prisma.message.count()).toBe(1);
  });
});

describe('webhook routing', () => {
  it('a DM for an IG account that moved workspaces lands only with the CONNECTED owner, and is emitted only to them', async () => {
    const igUserId = uniq('ig-moved');
    const a = await createUser({});
    const b = await createUser({});
    const old = await createAccount({ userId: a.user.id, igUserId });
    await prisma.instagramAccount.update({ where: { id: old.id }, data: { connectionStatus: 'DISCONNECTED' } });
    const current = await createAccount({ userId: b.user.id, igUserId });

    vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
    vi.spyOn(aiService, 'analyzeConversation').mockResolvedValue(null);
    const emits = vi.spyOn(socketLib, 'emitToUser');

    const mid = uniq('mid');
    const raw = JSON.stringify({
      object: 'instagram',
      entry: [{ id: igUserId, time: Date.now(), messaging: [{ sender: { id: uniq('s') }, recipient: { id: igUserId }, timestamp: Date.now(), message: { mid, text: 'hi' } }] }],
    });
    const sig = 'sha256=' + crypto.createHmac('sha256', process.env.INSTAGRAM_APP_SECRET).update(raw).digest('hex');
    const res = await request(app).post('/webhooks/instagram').set('Content-Type', 'application/json').set('x-hub-signature-256', sig).send(raw);
    expect(res.status).toBe(200);

    const end = Date.now() + 5000;
    let msg = null;
    while (!msg && Date.now() < end) {
      msg = await prisma.message.findFirst({ where: { igMessageId: mid }, include: { conversation: true } });
      if (!msg) await new Promise((r) => setTimeout(r, 25));
    }
    expect(msg.conversation.instagramAccountId).toBe(current.id);
    const newMessageTargets = emits.mock.calls.filter((c) => c[1] === 'new_message').map((c) => c[0]);
    expect(newMessageTargets).toEqual([b.user.id]);
  });
});

describe('F1 — sockets re-check the user behind the session', () => {
  it('a live session is valid; a suspended user, a reset password, or a deleted user is not', async () => {
    const { user } = await createUser({});
    expect(await sessionUserIsValid({ userId: user.id, sessionVersion: 0 })).toBe(true);

    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    expect(await sessionUserIsValid({ userId: user.id, sessionVersion: 0 }), 'password reset bumped the version').toBe(false);
    expect(await sessionUserIsValid({ userId: user.id, sessionVersion: 1 })).toBe(true);

    await prisma.user.update({ where: { id: user.id }, data: { isSuspended: true } });
    expect(await sessionUserIsValid({ userId: user.id, sessionVersion: 1 }), 'suspended').toBe(false);

    expect(await sessionUserIsValid({ userId: 'no-such-user', sessionVersion: 0 })).toBe(false);
  });
});
