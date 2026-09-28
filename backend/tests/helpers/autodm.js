/**
 * Auto DM test fixtures. Real signed webhooks through the real routes; only
 * Meta's HTTP layer (the shared axios object) is replaced, and every call is
 * recorded so a test can assert exactly what would have been sent.
 */

import crypto from 'crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { createRequire } from 'node:module';
import { prisma, createUser, createAccount, uniq } from './db.js';

const require = createRequire(import.meta.url);
const axios = require('axios');
const access = require('../../src/features/autodm/access.js');
const limits = require('../../src/features/autodm/limits.js');
const quota = require('../../src/features/autodm/quota.js');

export const AUTODM_FLAGS = ['AUTODM_ENABLED', 'AUTODM_SCOPE_ALLOWLIST', 'AUTODM_SCOPE_ALL', 'AUTODM_POLL_MODE'];

export function saveFlags() {
  const saved = Object.fromEntries(AUTODM_FLAGS.map((k) => [k, process.env[k]]));
  for (const k of AUTODM_FLAGS) delete process.env[k];
  access.resetAccessCache(); // the DB (and its rollout-mode row) is reset between tests
  limits.resetLimitsCache();
  quota.resetQuotaState();
  return () => {
    access.resetAccessCache();
    limits.resetLimitsCache();
    quota.resetQuotaState();
    for (const k of AUTODM_FLAGS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

export const sign = (raw) =>
  'sha256=' + crypto.createHmac('sha256', process.env.INSTAGRAM_APP_SECRET).update(raw).digest('hex');

export function postWebhook(app, body) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return request(app)
    .post('/webhooks/instagram')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', sign(raw))
    .send(raw);
}

export async function waitFor(fn, what, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * Meta stub. `routes` lets a test override one endpoint: a function
 * (url, body, config) => data | throws. Default answers are the happy path.
 */
export function installGraphStub(overrides = {}) {
  const calls = [];
  const answer = (kind, url, body, config) => {
    calls.push({ kind, url: String(url), body, params: config && config.params });
    for (const [pattern, fn] of Object.entries(overrides)) {
      if (String(url).includes(pattern) && (!fn.kind || fn.kind === kind)) {
        return Promise.resolve().then(() => ({ data: fn(String(url), body, config) }));
      }
    }
    const u = String(url);
    if (kind === 'post' && u.includes('subscribed_apps')) return Promise.resolve({ data: { success: true } });
    if (kind === 'post' && u.includes('/replies')) return Promise.resolve({ data: { id: uniq('reply') } });
    if (kind === 'post' && u.includes('/messages')) {
      const recipient = body && body.recipient;
      return Promise.resolve({
        data: { recipient_id: recipient && recipient.comment_id ? `igsid-${recipient.comment_id}` : recipient && recipient.id, message_id: uniq('mid') },
      });
    }
    if (kind === 'get' && u.includes('/me/media')) return Promise.resolve({ data: { data: [] } });
    if (kind === 'get' && u.includes('/comments')) return Promise.resolve({ data: { data: [] } });
    if (kind === 'get') return Promise.resolve({ data: { username: 'a_contact', name: 'A Contact', profile_pic: null } });
    return Promise.resolve({ data: {} });
  };
  const post = vi.spyOn(axios, 'post').mockImplementation((url, body, config) => answer('post', url, body, config));
  const get = vi.spyOn(axios, 'get').mockImplementation((url, config) => answer('get', url, undefined, config));
  return { calls, post, get, sends: () => calls.filter((c) => c.kind === 'post' && c.url.includes('/messages')) };
}

export function metaError(code, subcode, status = 400) {
  const err = new Error('meta');
  err.response = { status, data: { error: { code, error_subcode: subcode, message: 'secret meta text' } } };
  return err;
}

/** Admin rollout mode (OFF | BETA | EVERYONE), as the admin page sets it. */
export function setRolloutMode(mode) {
  return access.setRolloutMode(mode, null);
}

/**
 * A tenant with a connected account that holds the comments scope. Puts the
 * rollout in BETA (unless told otherwise) and, with `allowlist`, names the
 * tenant a beta user through the env bootstrap list.
 */
export async function autodmTenant({ commentsGranted = true, allowlist = true, mode = 'BETA' } = {}) {
  if (mode) await access.setRolloutMode(mode, null);
  const { user, password } = await createUser({});
  const igUserId = uniq('ig');
  const account = await createAccount({ userId: user.id, igUserId });
  await prisma.autoDmAccountState.create({
    data: { instagramAccountId: account.id, userId: user.id, commentsGranted, commentsSubscribedAt: new Date() },
  });
  if (allowlist) {
    const list = (process.env.AUTODM_SCOPE_ALLOWLIST || '').split(',').filter(Boolean);
    process.env.AUTODM_SCOPE_ALLOWLIST = [...list, user.email].join(',');
  }
  return { user, password, account, igUserId };
}

export async function createAutomation(tenant, overrides = {}) {
  return prisma.autoDmAutomation.create({
    data: {
      userId: tenant.user.id,
      instagramAccountId: tenant.account.id,
      name: 'Guide',
      status: 'active',
      postScope: 'ANY',
      mediaIds: [],
      triggerType: 'KEYWORDS',
      keywords: ['guide'],
      excludeKeywords: [],
      openerText: 'Tap below for the guide, or reply LINK.',
      openerButtonLabel: 'Send me the link',
      fallbackKeyword: 'LINK',
      mainText: 'Here is your guide',
      linkUrl: 'https://example.com/guide',
      linkLabel: 'Open guide',
      ...overrides,
    },
  });
}

export function commentWebhook(igUserId, { commentId = uniq('c'), fromId = uniq('fan'), username = 'fan_one', text = 'send the guide', mediaId = 'media-1', time = Date.now() } = {}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: igUserId,
        time,
        changes: [
          { field: 'comments', value: { id: commentId, from: { id: fromId, username }, text, media: { id: mediaId, media_product_type: 'FEED' } } },
        ],
      },
    ],
  };
}

export function postbackWebhook(igUserId, senderId, payload) {
  return {
    object: 'instagram',
    entry: [
      {
        id: igUserId,
        time: Date.now(),
        messaging: [{ sender: { id: senderId }, recipient: { id: igUserId }, timestamp: Date.now(), postback: { mid: uniq('pb'), title: 'Send me the link', payload } }],
      },
    ],
  };
}

export function dmWebhook(igUserId, senderId, { text = 'hello', mid = uniq('mid'), quickReplyPayload } = {}) {
  const message = { mid, text };
  if (quickReplyPayload) message.quick_reply = { payload: quickReplyPayload };
  return {
    object: 'instagram',
    entry: [{ id: igUserId, time: Date.now(), messaging: [{ sender: { id: senderId }, recipient: { id: igUserId }, timestamp: Date.now(), message }] }],
  };
}

export { prisma, uniq };
