/**
 * PUT /api/onboarding — the flag and the profile must move together.
 *
 * The route used to set `onboardingCompleted = true` FIRST, in both the
 * with-displayName and without-displayName branches, each wrapped in
 * `.catch(() => {})`. A failing profile write therefore left an account
 * flagged complete with nothing stored.
 *
 * That is worse than it sounds, because the flag is a one-way door. Every
 * guard in the product — /login, the landing page, /dashboard — only ever asks
 * "is onboardingCompleted true?". Once it is true there is no path back to the
 * wizard, so the business profile stays empty forever and the assistant
 * answers customers out of nothing. A Meta reviewer hitting this would see a
 * dashboard with no data and no way to fix it.
 *
 * The two properties below are the fix, and both fail silently if they
 * regress: nothing throws, the user just ends up in the broken state.
 *
 *   1. profile save FAILS  -> flag stays false, caller gets an error
 *   2. profile save WORKS  -> flag is true AND the profile is stored
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

import { resetDb, createUser, prisma } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';

const require = createRequire(import.meta.url);
const settingsRoutes = require('../src/routes/settings.js');

// Mirrors src/index.js, which mounts this router twice. /api/onboarding is
// served by the bare '/api' mount, so a test app with only '/api/settings'
// would 404 and prove nothing.
const app = buildTestApp({ mount: { '/api/settings': settingsRoutes, '/api': settingsRoutes } });

let ipCounter = 0;
const nextIp = () => `10.73.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

const PASSWORD = 'correct-horse-1';

/**
 * The shared createUser helper defaults onboardingCompleted to TRUE, because
 * almost every other suite wants a user who is already past setup. A test
 * about the flag has to undo that first, or it asserts nothing.
 */
async function createFreshUser(opts = {}) {
  const { user } = await createUser({ password: PASSWORD, ...opts });
  await prisma.user.update({ where: { id: user.id }, data: { onboardingCompleted: false } });
  return user;
}

async function loginAgent(email) {
  const agent = request.agent(app);
  const res = await agent
    .post('/auth/login')
    .set('X-Forwarded-For', nextIp())
    .send({ email, password: PASSWORD });
  expect(res.status, `login should succeed, got ${res.status}`).toBe(200);
  return agent;
}

/** A complete, realistic onboarding payload. */
const payload = () => ({
  displayName: 'Alex Rivera',
  businessName: 'PixelCraft Studios',
  primaryCategory: 'video_editor',
  businessTypes: JSON.stringify(['video_editor', 'agency']),
  description: 'Short-form video editing for founders.',
  productsServices: 'Reels, shorts, long-form edits.',
  pricingInfo: 'From INR 5,000 per reel.',
  locationDelivery: 'Remote, worldwide. Delivery in 3 working days.',
  policies: 'One round of revisions included.',
  paymentMethods: 'UPI, bank transfer',
  faqData: 'Q: Turnaround? A: Three working days.',
  aiInstructions: 'Never quote a price not listed above.',
  tone: 'friendly',
});

describe('PUT /api/onboarding — completion flag', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT mark onboarding complete when the profile save fails', async () => {
    const user = await createFreshUser();
    const agent = await loginAgent(user.email);

    // Fail the one write that stores what the user typed.
    const update = vi
      .spyOn(prisma.businessProfile, 'update')
      .mockRejectedValue(new Error('database is not available'));

    const res = await agent.put('/api/onboarding').send(payload());

    expect(res.status, 'a failed save must surface as an error').toBe(500);
    expect(res.body.error, 'the UI needs something to show').toBeTruthy();
    expect(res.body.onboardingCompleted).toBeUndefined();
    expect(update).toHaveBeenCalled();

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(
      row.onboardingCompleted,
      'the flag is a one-way door: setting it on a failed save strands the user outside the wizard forever',
    ).toBe(false);
  });

  it('leaves the display name alone when the profile save fails', async () => {
    const user = await createFreshUser({ name: 'Original Name' });
    const agent = await loginAgent(user.email);

    vi.spyOn(prisma.businessProfile, 'update').mockRejectedValue(new Error('nope'));

    await agent.put('/api/onboarding').send(payload());

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row.name, 'a half-applied save is still a failed save').toBe('Original Name');
    expect(row.onboardingCompleted).toBe(false);
  });

  it('marks complete and stores the profile when the save succeeds', async () => {
    const user = await createFreshUser();
    const agent = await loginAgent(user.email);

    const body = payload();
    const res = await agent.put('/api/onboarding').send(body);

    expect(res.status).toBe(200);
    expect(res.body.onboardingCompleted).toBe(true);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row.onboardingCompleted).toBe(true);
    expect(row.name, 'displayName is applied on success').toBe(body.displayName);

    const profile = await prisma.businessProfile.findUnique({ where: { userId: user.id } });
    expect(profile.businessName).toBe(body.businessName);
    expect(profile.description).toBe(body.description);
    expect(profile.pricingInfo).toBe(body.pricingInfo);
    expect(
      profile.locationDelivery,
      'locationDelivery is sent by the wizard and must be stored',
    ).toBe(body.locationDelivery);
    expect(profile.tone).toBe(body.tone);
  });

  it('marks complete without a displayName, leaving the existing name', async () => {
    const user = await createFreshUser({ name: 'Existing Name' });
    const agent = await loginAgent(user.email);

    const { displayName, ...rest } = payload();
    const res = await agent.put('/api/onboarding').send(rest);

    expect(res.status).toBe(200);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row.onboardingCompleted).toBe(true);
    expect(row.name).toBe('Existing Name');
  });

  it('requires a session', async () => {
    const res = await request(app).put('/api/onboarding').send(payload());
    expect(res.status).toBe(401);
  });
});
