/**
 * Fake Meta network boundary.
 *
 * The source tree is CommonJS, so `vi.mock('axios')` does not reach
 * `require('axios')` inside src/lib/instagram.js — that call resolves through
 * Node and bypasses vitest's module graph. Spying on the shared axios
 * instance obtained via createRequire does reach it, because instagram.js
 * looks the method up on the same object at call time.
 *
 * This keeps every real code path in instagram.js under test while
 * guaranteeing no test ever makes a live request to Meta.
 */

import { vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axios = require('axios');

export const meta = { igUserId: 'ig-default', username: null };

export function setIgUser(igUserId) {
  meta.igUserId = igUserId;
  meta.username = `creator_${igUserId}`;
}

/** Install URL-routed stubs for every Meta endpoint instagram.js calls. */
export function installMetaStubs() {
  const post = vi.spyOn(axios, 'post').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('oauth/access_token')) {
      return { data: { access_token: `short-${meta.igUserId}`, user_id: meta.igUserId } };
    }
    if (u.includes('subscribed_apps')) return { data: { success: true } };
    if (u.includes('/messages')) return { data: { message_id: `mid-${Date.now()}` } };
    return { data: {} };
  });

  const get = vi.spyOn(axios, 'get').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/access_token')) {
      return { data: { access_token: `long-${meta.igUserId}`, token_type: 'bearer', expires_in: 5184000 } };
    }
    if (u.endsWith('/me') || u.includes('/me?')) {
      return {
        data: {
          id: meta.igUserId,
          user_id: meta.igUserId,
          username: meta.username || `creator_${meta.igUserId}`,
          name: 'Creator',
          profile_picture_url: null,
        },
      };
    }
    return { data: { username: 'a_contact', name: 'A Contact', profile_pic: null } };
  });

  return { post, get, axios };
}

export function restoreMetaStubs() {
  vi.restoreAllMocks();
}
