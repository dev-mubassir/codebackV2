/**
 * P4 — Cross-tenant isolation (IDOR).
 *
 * Two tenants are seeded. As tenant B, every resource-fetch and mutation route
 * is attempted using tenant A's ids.
 *
 * EVERY ONE MUST RETURN 404, NOT 403. A 403 means "this exists, but it isn't
 * yours" — which confirms the id is real and turns the endpoint into an
 * existence oracle. 404 is indistinguishable from "no such thing".
 *
 * The Gate 0 audit found no IDOR candidates in the tenant-facing routes, so
 * most of these are expected to pass on the first run. That is the point: this
 * suite exists to keep it that way. Ownership filtering is the kind of thing
 * that is correct until someone adds a route in a hurry, and nothing here
 * would have caught that before.
 *
 * The final block does the opposite — it demonstrates what an UNSCOPED query
 * would return on the same data, so the passing assertions above are visibly
 * non-vacuous.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';

let app;
let apiRoutes;
let accountRoutes;
let brandDealRoutes;
let notificationRoutes;
let ipCounter = 0;
const nextIp = () => `10.51.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

async function loginAgent(email, password) {
  const agent = request.agent(app);
  const res = await agent
    .post('/auth/login')
    .set('X-Forwarded-For', nextIp())
    .send({ email, password });
  expect(res.status, `login should succeed, got ${res.status}`).toBe(200);
  return agent;
}

/** Tenant A owns an account with a full conversation; tenant B owns nothing. */
async function seedTwoTenants() {
  const a = await createUser({ name: 'Tenant A' });
  const b = await createUser({ name: 'Tenant B' });

  const accountA = await createAccount({
    userId: a.user.id,
    igUserId: uniq('ig-a'),
    withConversation: true,
  });

  const conversationA = await prisma.conversation.findFirst({
    where: { instagramAccountId: accountA.id },
  });
  const contactA = await prisma.contact.findFirst({
    where: { instagramAccountId: accountA.id },
  });

  await prisma.message.create({
    data: {
      conversationId: conversationA.id,
      direction: 'inbound',
      content: 'TENANT-A-SECRET-MESSAGE',
      igMessageId: uniq('mid'),
    },
  });

  const brandDealA = await prisma.brandDeal.create({
    data: {
      conversationId: conversationA.id,
      instagramAccountId: accountA.id,
      userId: a.user.id,
      brandName: 'TENANT-A-SECRET-BRAND',
    },
  });

  const notificationA = await prisma.notification.create({
    data: { userId: a.user.id, type: 'brand_deal', title: 'TENANT-A-SECRET-NOTIFICATION' },
  });

  return { a, b, accountA, conversationA, contactA, brandDealA, notificationA };
}

beforeAll(async () => {
  // Mount the REAL routers. Without this every request 404s, and since 404 is
  // the expected result for most assertions here, the whole suite would pass
  // vacuously against the very bug it exists to catch. The sanity check below
  // guards that directly.
  apiRoutes = (await import('../src/routes/api.js')).default;
  accountRoutes = (await import('../src/routes/accounts.js')).default;
  brandDealRoutes = (await import('../src/routes/brandDeals.js')).default;
  notificationRoutes = (await import('../src/routes/notifications.js')).default;

  app = buildTestApp({
    mount: {
      '/api/accounts': accountRoutes,
      '/api/brand-deals': brandDealRoutes,
      '/api/notifications': notificationRoutes,
      '/api': apiRoutes,
    },
  });
});

describe('P4 — harness sanity check', () => {
  it('the API routes are actually mounted (otherwise every 404 below is vacuous)', async () => {
    const { a } = await seedTwoTenants();
    const agentA = await loginAgent(a.user.email, a.password);

    // Tenant A asking for tenant A's OWN data must succeed. If this 404s, the
    // router is not mounted and no other assertion in this file means anything.
    const res = await agentA.get('/api/conversations');
    expect(
      res.status,
      'routes must be reachable — a 404 here makes every cross-tenant 404 below meaningless'
    ).toBe(200);
  });
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('P4 — tenant B cannot reach tenant A by id', () => {
  it('GET /api/conversations/:id/messages -> 404', async () => {
    const { b, conversationA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB.get(`/api/conversations/${conversationA.id}/messages`);

    expect(res.status, 'must be 404 — a 403 would confirm the id is real').toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('TENANT-A-SECRET-MESSAGE');
  });

  it('GET /api/conversations/:id/ai-analysis -> 404', async () => {
    const { b, conversationA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);
    const res = await agentB.get(`/api/conversations/${conversationA.id}/ai-analysis`);
    expect(res.status).toBe(404);
  });

  it('POST /api/conversations/:id/read -> 404 and changes nothing', async () => {
    const { b, conversationA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const before = await prisma.conversation.findUnique({ where: { id: conversationA.id } });
    const res = await agentB.post(`/api/conversations/${conversationA.id}/read`).send({});
    const after = await prisma.conversation.findUnique({ where: { id: conversationA.id } });

    expect(res.status).toBe(404);
    expect(after.unread, "tenant A's conversation must be untouched").toBe(before.unread);
  });

  it('PATCH /api/conversations/:id/auto-reply -> 404 and does not enable sending', async () => {
    const { b, conversationA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB
      .patch(`/api/conversations/${conversationA.id}/auto-reply`)
      .send({ autoReplyEnabled: true });

    expect(res.status).toBe(404);
    const after = await prisma.conversation.findUnique({ where: { id: conversationA.id } });
    expect(
      after.autoReplyEnabled,
      'enabling auto-reply on a stranger\'s conversation would send DMs as them'
    ).not.toBe(true);
  });

  it('DELETE /api/conversations/:id -> 404 and does not delete', async () => {
    const { b, conversationA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB.delete(`/api/conversations/${conversationA.id}`);

    expect(res.status).toBe(404);
    expect(
      await prisma.conversation.findUnique({ where: { id: conversationA.id } }),
      'the conversation must still exist'
    ).not.toBeNull();
  });

  it('DELETE /api/conversations/:id/messages -> 404 and deletes nothing', async () => {
    const { b, conversationA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const before = await prisma.message.count({ where: { conversationId: conversationA.id } });
    const res = await agentB.delete(`/api/conversations/${conversationA.id}/messages`);
    const after = await prisma.message.count({ where: { conversationId: conversationA.id } });

    expect(res.status).toBe(404);
    expect(after, 'messages must survive').toBe(before);
  });

  it('POST /api/conversations/:id/generate-reply -> 404', async () => {
    const { b, conversationA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);
    const res = await agentB
      .post(`/api/conversations/${conversationA.id}/generate-reply`)
      .send({ instructions: 'anything' });
    expect(res.status).toBe(404);
  });

  it('POST /api/conversations/:id/reply -> 404 and sends no DM', async () => {
    const { b, conversationA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB
      .post(`/api/conversations/${conversationA.id}/reply`)
      .send({ text: 'a message from the wrong tenant' });

    expect(res.status).toBe(404);
    const outbound = await prisma.message.count({
      where: { conversationId: conversationA.id, direction: 'outbound' },
    });
    expect(outbound, 'no DM may be sent into another tenant\'s conversation').toBe(0);
  });

  it('POST /api/contacts/:id/refresh-profile -> 404', async () => {
    const { b, contactA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);
    const res = await agentB.post(`/api/contacts/${contactA.id}/refresh-profile`).send({});
    expect(res.status).toBe(404);
  });

  it('DELETE /api/accounts/:id -> 404 and does not disconnect', async () => {
    const { b, accountA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB.delete(`/api/accounts/${accountA.id}`);

    expect(res.status).toBe(404);
    const after = await prisma.instagramAccount.findUnique({ where: { id: accountA.id } });
    expect(after, 'the account must still exist').not.toBeNull();
    expect(after.connectionStatus).toBe('CONNECTED');
  });

  it('GET /api/brand-deals/:id -> 404', async () => {
    const { b, brandDealA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB.get(`/api/brand-deals/${brandDealA.id}`);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('TENANT-A-SECRET-BRAND');
  });

  it('PATCH /api/brand-deals/:id -> 404 and does not mutate', async () => {
    const { b, brandDealA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB.patch(`/api/brand-deals/${brandDealA.id}`).send({ status: 'confirmed' });

    expect(res.status).toBe(404);
    const after = await prisma.brandDeal.findUnique({ where: { id: brandDealA.id } });
    expect(after.status).toBe('new');
  });

  it('POST /api/notifications/:id/read -> 404 and does not mark read', async () => {
    const { b, notificationA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB.post(`/api/notifications/${notificationA.id}/read`).send({});

    expect(res.status).toBe(404);
    const after = await prisma.notification.findUnique({ where: { id: notificationA.id } });
    expect(after.isRead).toBe(false);
  });
});

describe('P4 — collection routes never leak across tenants', () => {
  it('GET /api/conversations returns only tenant B\'s own (i.e. none)', async () => {
    const { b } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB.get('/api/conversations');

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('TENANT-A-SECRET-MESSAGE');
    const list = res.body.conversations || res.body.data || res.body;
    expect(Array.isArray(list) ? list.length : 0, 'tenant B owns nothing').toBe(0);
  });

  it('a FORGED ?accountId belonging to tenant A yields nothing, not everything', async () => {
    const { b, accountA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB.get('/api/conversations').query({ accountId: accountA.id });

    expect(res.status).toBe(200);
    expect(
      JSON.stringify(res.body),
      'a foreign accountId must collapse the filter to an empty set, never widen it'
    ).not.toContain('TENANT-A-SECRET-MESSAGE');
  });

  it('GET /api/brand-deals and /api/notifications are scoped to the caller', async () => {
    const { b } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const deals = await agentB.get('/api/brand-deals');
    const notifications = await agentB.get('/api/notifications');

    expect(JSON.stringify(deals.body)).not.toContain('TENANT-A-SECRET-BRAND');
    expect(JSON.stringify(notifications.body)).not.toContain('TENANT-A-SECRET-NOTIFICATION');
  });

  it('GET /api/accounts lists only the caller\'s accounts', async () => {
    const { b, accountA } = await seedTwoTenants();
    const agentB = await loginAgent(b.user.email, b.password);

    const res = await agentB.get('/api/accounts');
    expect(JSON.stringify(res.body)).not.toContain(accountA.id);
  });
});

describe('P4 — the assertions above are not vacuous', () => {
  it("DEMONSTRATION: an UNSCOPED query does return tenant A's data", async () => {
    const { conversationA } = await seedTwoTenants();

    // This is what any of the routes above would return if its ownership
    // filter were dropped — the shape of the bug the suite exists to catch.
    const unscoped = await prisma.message.findMany({
      where: { conversationId: conversationA.id },
    });
    expect(unscoped.length, 'the data really is there to be leaked').toBeGreaterThan(0);
    expect(unscoped.map((m) => m.content).join()).toContain('TENANT-A-SECRET-MESSAGE');

    // And the scoped form, as the routes actually write it, returns nothing
    // for the wrong tenant.
    const { b } = await seedTwoTenants();
    const scoped = await prisma.conversation.findFirst({
      where: { id: conversationA.id, instagramAccount: { userId: b.user.id } },
    });
    expect(scoped, 'the ownership join is what makes it 404').toBeNull();
  });
});
