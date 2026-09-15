/**
 * A checkout whose Cashfree order creation fails is terminal at once.
 *
 * The local Order row is written before Cashfree is called. If that call fails,
 * the order is marked EXPIRED immediately — nothing waits for reconciliation to
 * discover an order that never existed. Only THAT order: a previous version of
 * this catch marked every in-flight order of the plan for the tenant.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const axios = require('axios');

let app;
let ipSeq = 0;
const nextIp = () => `10.88.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(async () => {
  process.env.CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || 'test-cashfree-app';
  process.env.CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || 'test-cashfree-secret';
  const billingRoutes = (await import('../src/routes/billing.js')).default;
  app = buildTestApp({ mount: { '/api/billing': billingRoutes } });
});

beforeEach(async () => {
  await resetDb();
  const data = { name: 'Starter', igAccountLimit: 1, autoReplyCreditsPerCycle: 500, autoReplyBankCap: 500, classificationCapCycle: 10000, classificationThrottlePerHour: 500, cycleLengthDays: 30, isActive: true };
  const plan = await prisma.plan.upsert({ where: { code: 'STARTER' }, update: data, create: { code: 'STARTER', ...data } });
  // The catalogue survives resetDb (other files seed it too), so upsert.
  await prisma.planPrice.upsert({
    where: { planId_billingRegion: { planId: plan.id, billingRegion: 'IN' } },
    update: { currency: 'INR', amount: 49900 },
    create: { planId: plan.id, billingRegion: 'IN', currency: 'INR', amount: 49900 },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function signedIn() {
  const { user, password } = await createUser({});
  const agent = request.agent(app);
  const login = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password });
  expect(login.status).toBe(200);
  return { user, agent };
}

describe('Cashfree order creation fails', () => {
  it('the new order is EXPIRED immediately, and the tenant’s other in-flight order is untouched', async () => {
    const { user, agent } = await signedIn();
    const inFlight = await prisma.order.create({
      data: { cashfreeOrderId: `sfy_${uniq('inflight')}`, tenantId: user.id, planCode: 'STARTER', amount: 49900, currency: 'INR' },
    });
    vi.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500, data: { message: 'upstream' } } }));

    const res = await agent.post('/api/billing/checkout/plan').send({ planCode: 'STARTER', customerPhone: '9999999999' });

    expect(res.status).toBe(502);
    const orders = await prisma.order.findMany({ where: { tenantId: user.id } });
    const failed = orders.find((o) => o.id !== inFlight.id);
    expect(failed.status, 'terminal at once').toBe('EXPIRED');
    expect(orders.find((o) => o.id === inFlight.id).status).toBe('CREATED');
  });

  it('a timeout is treated the same: the browser never got a payment session, so the order cannot be paid', async () => {
    const { user, agent } = await signedIn();
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('timeout of 15000ms exceeded'));

    const res = await agent.post('/api/billing/checkout/plan').send({ planCode: 'STARTER', customerPhone: '9999999999' });

    expect(res.status).toBe(502);
    const [order] = await prisma.order.findMany({ where: { tenantId: user.id } });
    expect(order.status).toBe('EXPIRED');
  });

  it('a successful checkout leaves its order CREATED', async () => {
    const { user, agent } = await signedIn();
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { payment_session_id: 'session_ok' } });

    const res = await agent.post('/api/billing/checkout/plan').send({ planCode: 'STARTER', customerPhone: '9999999999' });

    expect(res.status).toBe(200);
    const [order] = await prisma.order.findMany({ where: { tenantId: user.id } });
    expect(order.status).toBe('CREATED');
  });
});
