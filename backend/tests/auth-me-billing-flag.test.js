/**
 * GET /auth/me — the `features.billing` bootstrap flag.
 *
 * This one boolean is the whole nav gate. AppShell and NavSidebar both call
 * buildNavItems({ billingEnabled: Boolean(user?.features?.billing) }), so if
 * this field stops being sent, the Billing entry silently disappears for
 * every user — and if it is sent when the backend has billing off, the entry
 * links to a route that 404s, which is exactly what BILLING_ENABLED exists to
 * prevent during Meta App Review.
 *
 * It had no coverage. The failure mode is silent in both directions and shows
 * up as "I turned the flag on and still see nothing", so it is pinned here.
 *
 * The flag is read through isBillingEnabled() at call time rather than at
 * module load, which is what makes flipping process.env mid-test meaningful —
 * and what makes it a real kill switch in production rather than something
 * frozen at boot.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

import { resetDb, createUser } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';

const app = buildTestApp();

let ipCounter = 0;
const nextIp = () => `10.77.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

async function loginAgent(email, password) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password });
  expect(res.status, `login should succeed, got ${res.status}`).toBe(200);
  return agent;
}

describe('GET /auth/me — features.billing', () => {
  const PASSWORD = 'correct-horse-1';
  const original = process.env.BILLING_ENABLED;

  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = original;
  });

  it('is false while BILLING_ENABLED is unset — the pre-launch state', async () => {
    delete process.env.BILLING_ENABLED;
    const { user } = await createUser({ password: PASSWORD });
    const agent = await loginAgent(user.email, PASSWORD);

    const res = await agent.get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.features).toEqual({ billing: false });
  });

  it('is true once BILLING_ENABLED is set', async () => {
    process.env.BILLING_ENABLED = 'true';
    const { user } = await createUser({ password: PASSWORD });
    const agent = await loginAgent(user.email, PASSWORD);

    const res = await agent.get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.features).toEqual({ billing: true });
  });

  it('only the exact string "true" enables it — "1"/"yes"/"TRUE" stay off', async () => {
    const { user } = await createUser({ password: PASSWORD });
    const agent = await loginAgent(user.email, PASSWORD);

    for (const value of ['1', 'yes', 'TRUE', 'True', '']) {
      process.env.BILLING_ENABLED = value;
      const res = await agent.get('/auth/me');
      expect(res.body.features, `BILLING_ENABLED=${JSON.stringify(value)}`).toEqual({ billing: false });
    }
  });

  it('is a boolean, never the raw env value — the client is told what it may render', async () => {
    process.env.BILLING_ENABLED = 'true';
    const { user } = await createUser({ password: PASSWORD });
    const agent = await loginAgent(user.email, PASSWORD);

    const res = await agent.get('/auth/me');
    expect(typeof res.body.features.billing).toBe('boolean');
  });
});
