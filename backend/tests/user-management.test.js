/**
 * Admin rebuild, Gate 5 — user management: list filters, detail, suspend /
 * unsuspend, force logout, delete. Every action needs a reason, writes an
 * audit row, and touches no other tenant.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAdmin, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const adminRoutes = require('../src/routes/admin.js');

const ORIGIN = 'https://app.test.local';
const SECRET = 'SECRET-DM-CONTENT-7731';
let app;
let ipSeq = 0;
const ip = () => `10.110.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(async () => {
  const apiRoutes = (await import('../src/routes/api.js')).default;
  app = buildTestApp({ admin: adminRoutes, mount: { '/api': apiRoutes } });
});
beforeEach(async () => {
  await resetDb();
});

async function adminAgent() {
  const { admin, password } = await createAdmin();
  const agent = request.agent(app).set('Origin', ORIGIN).set('X-Forwarded-For', ip());
  expect((await agent.post('/api/admin/login').send({ email: admin.email, password })).status).toBe(200);
  return { agent, admin, password };
}

async function customer(opts = {}) {
  const { user, password } = await createUser(opts);
  const agent = request.agent(app);
  expect((await agent.post('/auth/login').set('X-Forwarded-For', ip()).send({ email: user.email, password })).status).toBe(200);
  return { user, agent };
}

/** A tenant with an account, a conversation, an inbound message and an analysis carrying SECRET text. */
async function tenantWithHistory() {
  const c = await customer();
  const account = await createAccount({ userId: c.user.id, withConversation: true });
  const conversation = await prisma.conversation.findFirst({ where: { instagramAccountId: account.id } });
  await prisma.message.create({ data: { conversationId: conversation.id, direction: 'inbound', content: SECRET, aiStatus: 'completed' } });
  await prisma.aIAnalysis.create({ data: { conversationId: conversation.id, category: 'pricing_inquiry', priority: 'high', summary: SECRET, reason: SECRET } });
  await prisma.aiCallLog.create({ data: { provider: 'gemini', model: 'm', jobType: 'classification', tenantId: c.user.id, latencyMs: 10, success: false, errorCode: 'RESOURCE_EXHAUSTED', httpStatus: 429 } });
  return { ...c, account, conversation };
}

describe('list', () => {
  it('filters by search, plan, status and signup date', async () => {
    const trial = await createUser({ email: `${uniq('trial')}@test.codeback` });
    const none = await createUser({ withTrial: false });
    const suspended = await createUser({});
    await prisma.user.update({ where: { id: suspended.user.id }, data: { isSuspended: true } });
    const old = await createUser({ withTrial: false });
    await prisma.user.update({ where: { id: old.user.id }, data: { createdAt: new Date('2025-01-15T10:00:00Z') } });

    const { agent } = await adminAgent();
    const ids = async (qs) => (await agent.get(`/api/admin/users?limit=100&${qs}`)).body.users.map((u) => u.id).sort();

    expect(await ids(`search=${encodeURIComponent(trial.user.email)}`)).toEqual([trial.user.id]);
    expect(await ids('plan=TRIAL')).toEqual([trial.user.id, suspended.user.id].sort());
    expect(await ids('plan=NONE')).toEqual([none.user.id, old.user.id].sort());
    expect(await ids('status=suspended')).toEqual([suspended.user.id]);
    expect(await ids('signedUpFrom=2025-01-01&signedUpTo=2025-01-31')).toEqual([old.user.id]);

    const row = (await agent.get(`/api/admin/users?search=${encodeURIComponent(trial.user.email)}`)).body.users[0];
    expect(row.plan).toMatchObject({ planCode: 'TRIAL', status: 'TRIALING' });
  });
});

describe('detail', () => {
  it('shows plan, quota, accounts, classification counts, last active and AI errors — never DM content', async () => {
    const t = await tenantWithHistory();
    const other = await tenantWithHistory();
    await prisma.entitlement.update({ where: { userId: t.user.id }, data: { classificationCountCycle: 30 } });

    const { agent } = await adminAgent();
    const res = await agent.get(`/api/admin/users/${t.user.id}`);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.plan.planCode).toBe('TRIAL');
    expect(b.quota.classificationsUsedThisCycle).toBe(30);
    expect(b.quota.classificationCapPerCycle).toBe(100);
    expect(b.quota.classificationsRemaining).toBe(70);
    expect(b.instagramAccounts).toHaveLength(1);
    expect(b.instagramAccounts[0]).toHaveProperty('createdAt');
    expect(b.instagramAccounts[0]).toHaveProperty('tokenExpiresAt');
    expect(b.classifications.total).toBe(1);
    expect(b.classifications.inboundByStatus.completed).toBe(1);
    expect(b.recentAiErrors).toHaveLength(1);
    expect(b.recentAiErrors[0]).toMatchObject({ errorCode: 'RESOURCE_EXHAUSTED', httpStatus: 429 });

    const text = JSON.stringify(b);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(other.user.id);
    expect(text).not.toMatch(/accessToken|tokenCiphertext|passwordHash/);
  });
});

describe('actions', () => {
  it('unsuspend is audited with before/after', async () => {
    const t = await customer();
    await prisma.user.update({ where: { id: t.user.id }, data: { isSuspended: true } });
    const { agent } = await adminAgent();
    const res = await agent.post(`/api/admin/users/${t.user.id}/suspend`).send({ suspend: false, reason: 'appeal accepted' });
    expect(res.status).toBe(200);
    const row = await prisma.adminAuditLog.findFirst({ where: { action: 'USER_UNSUSPEND' } });
    expect(row).toMatchObject({ targetId: t.user.id, reason: 'appeal accepted', before: { isSuspended: true }, after: { isSuspended: false } });
  });

  it('force logout needs a reason, ends only that customer’s sessions, and is audited', async () => {
    const victim = await customer();
    const bystander = await customer();
    const { agent } = await adminAgent();

    expect((await agent.post(`/api/admin/users/${victim.user.id}/logout`).send({})).status).toBe(400);
    expect((await agent.post(`/api/admin/users/${victim.user.id}/logout`).send({ reason: 'shared device' })).status).toBe(200);

    expect((await victim.agent.get('/auth/me')).status).toBe(401);
    expect((await bystander.agent.get('/auth/me')).status).toBe(200);
    expect(await prisma.adminAuditLog.count({ where: { action: 'USER_FORCE_LOGOUT', targetId: victim.user.id, reason: 'shared device' } })).toBe(1);
    expect((await prisma.user.findUnique({ where: { id: victim.user.id } })).isSuspended, 'not suspended').toBe(false);
  });

  it('delete needs step-up and a reason, removes only that tenant, and audits without personal data', async () => {
    const victim = await tenantWithHistory();
    const bystander = await tenantWithHistory();
    const { agent, password } = await adminAgent();
    const url = `/api/admin/users/${victim.user.id}`;

    const noStep = await agent.delete(url).send({ reason: 'requested by customer' });
    expect(noStep.status).toBe(403);
    expect(noStep.body.code).toBe('STEP_UP_REQUIRED');
    expect((await agent.post('/api/admin/step-up').send({ password })).status).toBe(200);
    expect((await agent.delete(url).send({})).status, 'reason required').toBe(400);

    const res = await agent.delete(url).send({ reason: 'requested by customer' });
    expect(res.status).toBe(200);

    expect(await prisma.user.findUnique({ where: { id: victim.user.id } })).toBeNull();
    expect(await prisma.instagramAccount.count({ where: { userId: victim.user.id } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: victim.conversation.id } })).toBe(0);
    expect(await prisma.aiCallLog.count({ where: { tenantId: victim.user.id } })).toBe(0);
    expect((await victim.agent.get('/auth/me')).status).toBe(401);

    // The other tenant is untouched.
    expect(await prisma.user.findUnique({ where: { id: bystander.user.id } })).not.toBeNull();
    expect(await prisma.message.count({ where: { conversationId: bystander.conversation.id } })).toBe(1);
    expect(await prisma.aiCallLog.count({ where: { tenantId: bystander.user.id } })).toBe(1);
    expect((await bystander.agent.get('/auth/me')).status).toBe(200);

    const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'USER_DELETE' } });
    expect(audit.targetId).toBe(victim.user.id);
    expect(audit.reason).toBe('requested by customer');
    expect(JSON.stringify(audit)).not.toContain(victim.user.email);
  });
});

describe('self-service delete uses the same path', () => {
  it('DELETE /auth/account now ends the user’s OTHER sessions too', async () => {
    const { user, password } = await createUser({});
    const deviceA = request.agent(app);
    const deviceB = request.agent(app);
    await deviceA.post('/auth/login').set('X-Forwarded-For', ip()).send({ email: user.email, password });
    await deviceB.post('/auth/login').set('X-Forwarded-For', ip()).send({ email: user.email, password });

    expect((await deviceA.delete('/auth/account').set('Origin', ORIGIN)).status).toBe(200);
    expect((await deviceB.get('/auth/me')).status).toBe(401);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });
});
