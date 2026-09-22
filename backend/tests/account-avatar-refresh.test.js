/**
 * GET /auth/me — refreshing the account owner's own Instagram profile picture.
 *
 * `InstagramAccount.igProfilePic` is written once at OAuth connect and never
 * again. It is a signed Instagram CDN URL carrying an `oe=` expiry a few days
 * out, so within a week the owner's own avatar is a URL that returns 403. The
 * frontend degrades to an initial, so nobody notices; the photo simply never
 * comes back.
 *
 * The refresh rides on /auth/me because that is the one call every
 * authenticated screen makes. That placement is also the risk: /auth/me is the
 * bootstrap call, so anything slow here is slow everywhere and anything that
 * throws here logs the user out. The three properties below are what make it
 * safe to put it there at all, and each one is silent if it regresses:
 *
 *   1. an expiring URL triggers exactly ONE refresh
 *   2. a second call inside 24h does NOT call Instagram again — otherwise a
 *      permanently failing account hits the Graph API on every page load
 *   3. a Graph error changes NOTHING about the response, and leaves the
 *      stored URL alone
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

import { resetDb, createUser, createAccount, prisma } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';

const require = createRequire(import.meta.url);
const instagram = require('../src/lib/instagram.js');
const accountAvatar = require('../src/lib/accountAvatar.js');

const app = buildTestApp();

let ipCounter = 0;
const nextIp = () => `10.91.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

/** A signed CDN URL whose `oe=` sits `seconds` from now. Hex, as Meta writes it. */
const signedUrl = (seconds, tag = 'a') =>
  `https://scontent.cdninstagram.com/v/${tag}.jpg?oe=${Math.floor((Date.now() + seconds * 1000) / 1000).toString(16).toUpperCase()}&_nc_ht=x`;

const EXPIRED = () => signedUrl(-3 * 86400, 'old');
const FRESH = () => signedUrl(4 * 86400, 'new');

async function loginAgent(email, password) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password });
  expect(res.status, `login should succeed, got ${res.status}`).toBe(200);
  return agent;
}

/**
 * The refresh is fire-and-forget by design — /auth/me returns before it
 * finishes. Tests therefore wait for the side effect rather than for the
 * request, or they race it.
 */
async function waitFor(predicate, { timeout = 2000, step = 20 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, step));
  }
}

describe('GET /auth/me — account avatar refresh', () => {
  const PASSWORD = 'correct-horse-1';
  let fetchMyProfile;

  beforeEach(async () => {
    await resetDb();
    accountAvatar.resetAvatarRefreshThrottle();
    fetchMyProfile = vi.spyOn(instagram, 'fetchMyProfile');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes an expiring picture exactly once, and stores the new URL', async () => {
    const { user } = await createUser({ password: PASSWORD });
    const account = await createAccount({ userId: user.id });
    const stale = EXPIRED();
    const replacement = FRESH();
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { igProfilePic: stale },
    });

    fetchMyProfile.mockResolvedValue({ profile_picture_url: replacement });

    const agent = await loginAgent(user.email, PASSWORD);
    const res = await agent.get('/auth/me');
    expect(res.status).toBe(200);

    const stored = await waitFor(async () => {
      const row = await prisma.instagramAccount.findUnique({ where: { id: account.id } });
      return row.igProfilePic === replacement;
    });
    expect(stored, 'the refreshed URL should be persisted').toBe(true);
    expect(fetchMyProfile).toHaveBeenCalledTimes(1);
  });

  it('does not call Instagram again within 24 hours of a failed attempt', async () => {
    const { user } = await createUser({ password: PASSWORD });
    const account = await createAccount({ userId: user.id });
    const stale = EXPIRED();
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { igProfilePic: stale },
    });

    // A failing account is the case that matters: on success the new URL is no
    // longer expiring, so nothing would retry anyway. It is the FAILURE that
    // would otherwise hit the Graph API on every single page load.
    fetchMyProfile.mockRejectedValue(new Error('Graph API unavailable'));

    const agent = await loginAgent(user.email, PASSWORD);
    await agent.get('/auth/me');
    await waitFor(() => fetchMyProfile.mock.calls.length >= 1);
    expect(fetchMyProfile).toHaveBeenCalledTimes(1);

    // Three more bootstraps, as a user clicking around the app would produce.
    await agent.get('/auth/me');
    await agent.get('/auth/me');
    await agent.get('/auth/me');
    await new Promise((r) => setTimeout(r, 150));

    expect(fetchMyProfile, 'throttled to one attempt per account per day').toHaveBeenCalledTimes(1);

    const row = await prisma.instagramAccount.findUnique({ where: { id: account.id } });
    expect(row.igProfilePic, 'a failed refresh must leave the old value alone').toBe(stale);
  });

  it('a Graph API error does not affect the /auth/me response', async () => {
    const { user } = await createUser({ password: PASSWORD });
    const account = await createAccount({ userId: user.id });
    const stale = EXPIRED();
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { igProfilePic: stale },
    });

    fetchMyProfile.mockRejectedValue(new Error('Graph API exploded'));

    const agent = await loginAgent(user.email, PASSWORD);
    const res = await agent.get('/auth/me');

    expect(res.status, 'a cosmetic refresh must never fail the bootstrap call').toBe(200);
    expect(res.body.id).toBe(user.id);
    expect(res.body.instagramAccounts).toHaveLength(1);
    // The payload is built before the refresh runs, so it carries the old URL.
    expect(res.body.instagramAccounts[0].igProfilePic).toBe(stale);

    await waitFor(() => fetchMyProfile.mock.calls.length >= 1);
    const row = await prisma.instagramAccount.findUnique({ where: { id: account.id } });
    expect(row.igProfilePic).toBe(stale);
  });

  it('leaves a still-valid picture alone', async () => {
    const { user } = await createUser({ password: PASSWORD });
    const account = await createAccount({ userId: user.id });
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { igProfilePic: FRESH() },
    });

    fetchMyProfile.mockResolvedValue({ profile_picture_url: FRESH() });

    const agent = await loginAgent(user.email, PASSWORD);
    await agent.get('/auth/me');
    await new Promise((r) => setTimeout(r, 150));

    expect(fetchMyProfile, 'a URL days from expiry needs no Graph call').not.toHaveBeenCalled();
  });

  it('does not spend a token on a disconnected account', async () => {
    const { user } = await createUser({ password: PASSWORD });
    const account = await createAccount({ userId: user.id });
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { igProfilePic: EXPIRED(), connectionStatus: 'DISCONNECTED' },
    });

    fetchMyProfile.mockResolvedValue({ profile_picture_url: FRESH() });

    const agent = await loginAgent(user.email, PASSWORD);
    await agent.get('/auth/me');
    await new Promise((r) => setTimeout(r, 150));

    expect(fetchMyProfile).not.toHaveBeenCalled();
  });
});
