/**
 * Instagram connect flow with Auto DM's scope flags. For anyone not on the
 * allowlist — and for everyone while AUTODM_ENABLED is off — the authorize
 * URL and the subscribed_apps call must be BYTE-IDENTICAL to the pre-Auto-DM
 * flow. The expected strings below are written out literally on purpose.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb, createUser, prisma, uniq } from './helpers/db.js';
import { saveFlags, setRolloutMode } from './helpers/autodm.js';

const require = createRequire(import.meta.url);
const axios = require('axios');

const BASE_SCOPE = 'instagram_business_basic,instagram_business_manage_messages';
const BASE_FIELDS = 'messages,message_reactions,messaging_seen';

let app;
let restoreFlags;
let ipSeq = 0;
let calls;

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(async () => {
  await resetDb();
  restoreFlags = saveFlags();
  calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreFlags();
});

/** Meta stub for the OAuth dance. `permissions` = what Meta reports as granted (undefined = not reported). */
function stubMeta({ igUserId, permissions, refuseFields = [] }) {
  vi.spyOn(axios, 'post').mockImplementation(async (url, body, config) => {
    const u = String(url);
    calls.push({ url: u, params: config && config.params });
    if (u.includes('oauth/access_token')) {
      return { data: { access_token: `short-${igUserId}`, user_id: igUserId, ...(permissions ? { permissions } : {}) } };
    }
    if (u.includes('subscribed_apps')) {
      if (refuseFields.includes(config.params.subscribed_fields)) {
        const err = new Error('meta');
        err.response = { status: 400, data: { error: { code: 100 } } };
        throw err;
      }
      return { data: { success: true } };
    }
    return { data: {} };
  });
  vi.spyOn(axios, 'get').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/access_token')) return { data: { access_token: `long-${igUserId}`, token_type: 'bearer', expires_in: 5184000 } };
    if (u.endsWith('/me') || u.includes('/me?')) {
      return { data: { id: igUserId, user_id: igUserId, username: `creator_${igUserId}`, name: 'Creator', profile_picture_url: null } };
    }
    return { data: {} };
  });
}

async function connect({ allowlisted, enabled, permissions, refuseFields }) {
  const { user, password } = await createUser({});
  await setRolloutMode('BETA'); // the admin rollout mode; access still needs the flag + the list
  if (enabled) process.env.AUTODM_ENABLED = 'true';
  if (allowlisted) process.env.AUTODM_SCOPE_ALLOWLIST = user.email;
  const igUserId = uniq('ig-connect');
  stubMeta({ igUserId, permissions, refuseFields });

  const agent = request.agent(app);
  const login = await agent.post('/auth/login').set('X-Forwarded-For', `10.99.0.${++ipSeq}`).send({ email: user.email, password });
  expect(login.status).toBe(200);

  const start = await agent.get('/auth/instagram');
  expect(start.status).toBe(302);
  const authorizeUrl = start.headers.location;
  const state = new URL(authorizeUrl).searchParams.get('state');

  await agent.get('/auth/instagram/callback').query({ code: 'auth-code', state });
  const account = await prisma.instagramAccount.findFirst({ where: { igUserId } });
  expect(account, 'the connect itself must succeed').not.toBeNull();

  const subscribes = calls.filter((c) => c.url.includes('subscribed_apps')).map((c) => c.params.subscribed_fields);
  const autodmState = await prisma.autoDmAccountState.findUnique({ where: { instagramAccountId: account.id } });
  return { authorizeUrl, state, subscribes, autodmState };
}

/** The authorize URL exactly as the pre-Auto-DM code built it. */
const expectedUrl = (state) =>
  `https://www.instagram.com/oauth/authorize?client_id=${process.env.INSTAGRAM_APP_ID}` +
  `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
  `&scope=${BASE_SCOPE}&response_type=code&state=${encodeURIComponent(state)}`;

describe('byte-identical for everyone not allowlisted', () => {
  it('feature ON, user not allowlisted: same URL, one subscribe call with the same fields, no Auto DM row', async () => {
    const r = await connect({ enabled: true, allowlisted: false, permissions: `${BASE_SCOPE},instagram_business_manage_comments` });
    expect(r.authorizeUrl).toBe(expectedUrl(r.state));
    expect(r.subscribes).toEqual([BASE_FIELDS]);
    expect(r.autodmState).toBeNull();
  });

  it('feature OFF, even for an allowlisted email: identical', async () => {
    const r = await connect({ enabled: false, allowlisted: true, permissions: BASE_SCOPE });
    expect(r.authorizeUrl).toBe(expectedUrl(r.state));
    expect(r.subscribes).toEqual([BASE_FIELDS]);
    expect(r.autodmState).toBeNull();
  });
});

describe('allowlisted users (feature on)', () => {
  it('asks for the comments scope; after the unchanged first subscribe, a second one adds comments + postbacks', async () => {
    const r = await connect({ enabled: true, allowlisted: true, permissions: `${BASE_SCOPE},instagram_business_manage_comments` });
    expect(new URL(r.authorizeUrl).searchParams.get('scope')).toBe(`${BASE_SCOPE},instagram_business_manage_comments`);
    expect(r.subscribes).toEqual([BASE_FIELDS, `${BASE_FIELDS},comments,messaging_postbacks`]);
    expect(r.autodmState).toMatchObject({ commentsGranted: true });
    expect(r.autodmState.commentsSubscribedAt).not.toBeNull();
  });

  it('comments scope declined on the consent screen: no second subscribe, state says not granted', async () => {
    const r = await connect({ enabled: true, allowlisted: true, permissions: BASE_SCOPE });
    expect(r.subscribes).toEqual([BASE_FIELDS]);
    expect(r.autodmState).toMatchObject({ commentsGranted: false, commentsSubscribedAt: null });
  });

  it('no permissions reported: granted only if the extended subscribe succeeds (postbacks refused -> retried without)', async () => {
    const r = await connect({
      enabled: true,
      allowlisted: true,
      permissions: undefined,
      refuseFields: [`${BASE_FIELDS},comments,messaging_postbacks`],
    });
    expect(r.subscribes).toEqual([BASE_FIELDS, `${BASE_FIELDS},comments,messaging_postbacks`, `${BASE_FIELDS},comments`]);
    expect(r.autodmState).toMatchObject({ commentsGranted: true, grantedScopes: null });
  });

  it('no permissions reported and every extended subscribe refused: not granted, and the connect still succeeds', async () => {
    const r = await connect({
      enabled: true,
      allowlisted: true,
      permissions: undefined,
      refuseFields: [`${BASE_FIELDS},comments,messaging_postbacks`, `${BASE_FIELDS},comments`],
    });
    expect(r.subscribes[0]).toBe(BASE_FIELDS);
    expect(r.autodmState).toMatchObject({ commentsGranted: false });
  });
});
