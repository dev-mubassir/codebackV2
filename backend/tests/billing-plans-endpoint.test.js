/**
 * Wave 0 contract — GET /api/billing/plans.
 *
 * Both Wave 1 frontends render from this one endpoint, so its shape is a
 * contract rather than an implementation detail. Three properties matter
 * enough to pin down:
 *
 *   - It is PUBLIC. The marketing pricing section has no session.
 *   - It never leaks the classification limits. Those are enforced in code
 *     but are an internal ceiling, never advertised as a number.
 *   - USD_PRICING_ENABLED changes which currencies are EXPOSED, not which
 *     rows exist — so turning it on is a flag flip, not a migration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';

import { prisma, resetDb } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';

const require = createRequire(import.meta.url);
const billingRoutes = require('../src/routes/billing.js');

const app = buildTestApp({ mount: { '/api/billing': billingRoutes } });

/**
 * The catalogue the seed migration installs. resetDb() truncates tenant
 * data but not the plan catalogue, so these rows are already present —
 * seeded here defensively only if a previous test file cleared them.
 */
async function ensureCatalogue() {
  if ((await prisma.plan.count()) > 0) return;
  const starter = await prisma.plan.create({
    data: {
      code: 'STARTER', name: 'Starter', igAccountLimit: 1,
      autoReplyCreditsPerCycle: 500, autoReplyBankCap: 500,
      classificationCapCycle: 10000, classificationThrottlePerHour: 500,
      cycleLengthDays: 30,
    },
  });
  await prisma.planPrice.createMany({
    data: [
      { planId: starter.id, billingRegion: 'IN', currency: 'INR', amount: 49900 },
      { planId: starter.id, billingRegion: 'INTL', currency: 'USD', amount: 1900 },
    ],
  });
}

beforeEach(async () => {
  await resetDb();
  await ensureCatalogue();
  process.env.BILLING_ENABLED = 'true';
  delete process.env.USD_PRICING_ENABLED;
});

afterEach(() => {
  delete process.env.BILLING_ENABLED;
  delete process.env.USD_PRICING_ENABLED;
});

describe('GET /api/billing/plans', () => {
  it('is reachable with no session at all — the marketing page has no login', async () => {
    const res = await request(app).get('/api/billing/plans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.plans)).toBe(true);
    expect(res.body.plans.length).toBeGreaterThan(0);
  });

  it('404s while BILLING_ENABLED is off, exposing no pricing before approval', async () => {
    delete process.env.BILLING_ENABLED;
    const res = await request(app).get('/api/billing/plans');
    expect(res.status).toBe(404);
  });

  it('NEVER exposes the classification limits', async () => {
    const res = await request(app).get('/api/billing/plans');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('classificationCapCycle');
    expect(serialized).not.toContain('classificationThrottlePerHour');
    for (const plan of res.body.plans) {
      expect(plan.classificationCapCycle).toBeUndefined();
      expect(plan.classificationThrottlePerHour).toBeUndefined();
    }
  });

  it('omits TRIAL — it is granted by connecting Instagram, never purchased', async () => {
    const res = await request(app).get('/api/billing/plans');
    expect(res.body.plans.map((p) => p.code)).not.toContain('TRIAL');
  });

  it('exposes INR only while USD_PRICING_ENABLED is off', async () => {
    const res = await request(app).get('/api/billing/plans');
    expect(res.body.currencies).toEqual(['INR']);
    const currencies = res.body.plans.flatMap((p) => p.prices.map((x) => x.currency));
    expect(new Set(currencies)).toEqual(new Set(['INR']));
  });

  it('exposes USD too once the flag is on, with no migration in between', async () => {
    process.env.USD_PRICING_ENABLED = 'true';
    const res = await request(app).get('/api/billing/plans');
    expect(res.body.currencies).toEqual(['INR', 'USD']);

    const starter = res.body.plans.find((p) => p.code === 'STARTER');
    const usd = starter.prices.find((x) => x.currency === 'USD');
    expect(usd, 'the USD row was in the database the whole time').toBeTruthy();
    expect(usd.amount).toBe(1900);
  });

  it('carries per-tier add-on prices, which is what the Pro upgrade pitch is built on', async () => {
    const res = await request(app).get('/api/billing/plans');
    const starter = res.body.plans.find((p) => p.code === 'STARTER');
    expect(starter.addons).toBeTruthy();
    expect(starter.addons.replyCredits).toBeDefined();
    expect(starter.addons.extraIgAccount).toBeDefined();
    // Every add-on price returned for a plan belongs to that plan's tier.
    for (const pack of starter.addons.replyCredits) {
      for (const price of pack.prices) {
        expect(price.currency).toBe('INR');
      }
    }
  });

  it('marks which plans are actually self-serve purchasable', async () => {
    const res = await request(app).get('/api/billing/plans');
    const starter = res.body.plans.find((p) => p.code === 'STARTER');
    expect(starter.purchasable).toBe(true);

    const enterprise = res.body.plans.find((p) => p.code === 'ENTERPRISE');
    if (enterprise) {
      expect(enterprise.purchasable, 'Enterprise is contact-us, not checkout').toBe(false);
    }
  });
});
