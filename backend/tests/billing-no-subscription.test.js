/**
 * Gate 11a — cancellation is a wording problem, not a feature.
 *
 * There is no auto-debit, so there is nothing to cancel. What must hold:
 *   - the billing page and /settings say so, in the exact words
 *   - the one real control (turning off renewal reminder emails) persists,
 *     is reported in /summary, and rejects anything but a boolean
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser } from './helpers/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..', '..', 'frontend', 'src');
const read = (p) => readFileSync(join(FRONTEND, p), 'utf8');

let app;

beforeAll(async () => {
  const billingRoutes = (await import('../src/routes/billing.js')).default;
  app = buildTestApp({ mount: { '/api/billing': billingRoutes } });
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function signedIn() {
  const { user, password } = await createUser({});
  const agent = request.agent(app);
  const login = await agent.post('/auth/login').send({ email: user.email, password });
  expect(login.status).toBe(200);
  return { user, agent };
}

describe('Gate 11a — the renewal reminder switch', () => {
  it('defaults on, can be turned off, and /summary reports it', async () => {
    const { user, agent } = await signedIn();

    const before = await agent.get('/api/billing/summary');
    expect(before.status).toBe(200);
    expect(before.body.reminders).toEqual({ nudgeEmails: true });

    const off = await agent.put('/api/billing/reminders').send({ nudgeEmails: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ nudgeEmails: false });
    expect((await prisma.user.findUnique({ where: { id: user.id } })).renewalNudgeEmails).toBe(false);

    const after = await agent.get('/api/billing/summary');
    expect(after.body.reminders).toEqual({ nudgeEmails: false });
  });

  it.each([
    ['a string', { nudgeEmails: 'false' }],
    ['missing', {}],
    ['an extra key', { nudgeEmails: false, renewalNudgeEmails: true }],
  ])('rejects %s with a 400 and changes nothing', async (_label, body) => {
    const { user, agent } = await signedIn();
    const res = await agent.put('/api/billing/reminders').send(body);
    expect(res.status).toBe(400);
    expect((await prisma.user.findUnique({ where: { id: user.id } })).renewalNudgeEmails).toBe(true);
  });

  it('requires a session', async () => {
    const res = await request(app).put('/api/billing/reminders').send({ nudgeEmails: false });
    expect(res.status).toBe(401);
  });

  it('is dark with the rest of billing while BILLING_ENABLED is off', async () => {
    const previous = process.env.BILLING_ENABLED;
    delete process.env.BILLING_ENABLED;
    try {
      const res = await request(app).put('/api/billing/reminders').send({ nudgeEmails: false });
      expect(res.status).toBe(404);
    } finally {
      process.env.BILLING_ENABLED = previous;
    }
  });
});

describe('Gate 11a — the wording', () => {
  it('says the exact sentence, and both /billing and /settings render it from one component', () => {
    const copy = read('content/billingCopy.js');
    expect(copy).toContain(
      'Nothing renews automatically. Your plan ends on ${date} unless you choose to buy another cycle. There is no subscription to cancel.'
    );
    expect(read('app/components/billing/PlanStatusCard.js')).toMatch(/<NoSubscriptionNote summary=\{summary\}/);
    expect(read('app/components/billing/PlanSummaryPanel.js')).toMatch(/<NoSubscriptionNote summary=\{summary\}/);
  });

  it('the settings switch says which emails it does NOT stop', () => {
    expect(read('content/billingCopy.js')).toMatch(/does not stop the notice on the day your plan ends/);
  });
});
