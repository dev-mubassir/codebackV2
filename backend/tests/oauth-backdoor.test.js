/**
 * C3 — the mock-OAuth backdoor must not exist.
 *
 * Before the fix, lib/instagram.js short-circuits four functions on magic
 * prefixes (`test_code_`, `mock_short_token_`, `mock_long_token_`) whenever
 * NODE_ENV !== 'production', minting a token and a profile for an ARBITRARY
 * Instagram user id with no call to Meta at all. Chained with the OAuth
 * callback, that is unauthenticated takeover of any tenant's account row.
 *
 * These assert the only property that matters: a magic value must be treated
 * as an ordinary, untrusted input and must reach the network like any other.
 * NODE_ENV is 'test' here — exactly the non-production condition the backdoor
 * keyed on.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { installMetaStubs, restoreMetaStubs, setIgUser } from './helpers/fake-meta.js';

const require = createRequire(import.meta.url);
const instagram = require('../src/lib/instagram.js');

let stubs;

beforeEach(() => {
  setIgUser('42');
  stubs = installMetaStubs();
});

afterEach(() => {
  restoreMetaStubs();
});

describe('C3 — mock-OAuth backdoor removal', () => {
  it('exchangeCodeForToken does not mint a token for a test_code_ value', async () => {
    await instagram.exchangeCodeForToken('test_code_999999', 'app-id', 'app-secret', 'https://cb');

    // The only acceptable behaviour is "went to Meta like any other code".
    expect(stubs.post).toHaveBeenCalled();
    expect(String(stubs.post.mock.calls[0][0])).toContain('api.instagram.com/oauth/access_token');
  });

  it('exchangeCodeForToken never returns a mock_short_token_ for any input', async () => {
    const result = await instagram.exchangeCodeForToken('test_code_999999', 'a', 'b', 'c');
    expect(String(result.access_token)).not.toContain('mock_short_token_');
  });

  it('exchangeForLongLivedToken does not short-circuit a mock_short_token_', async () => {
    const result = await instagram.exchangeForLongLivedToken('mock_short_token_999999', 'app-secret');

    expect(stubs.get).toHaveBeenCalled();
    expect(String(stubs.get.mock.calls[0][0])).toContain('graph.instagram.com/access_token');
    expect(String(result.access_token)).not.toContain('mock_long_token_');
  });

  it('fetchMyProfile does not fabricate a profile for a mock_long_token_', async () => {
    const profile = await instagram.fetchMyProfile('mock_long_token_999999');

    expect(stubs.get).toHaveBeenCalled();
    // The fabricated profile derived its username from the magic token's payload.
    expect(profile.username).not.toBe('creator_999999');
  });

  it('subscribeToWebhooks does not fake success for a mock_long_token_', async () => {
    await instagram.subscribeToWebhooks('999999', 'mock_long_token_999999');

    expect(stubs.post).toHaveBeenCalled();
    expect(String(stubs.post.mock.calls[0][0])).toContain('/subscribed_apps');
  });

  it('the magic prefixes appear nowhere in the shipped source', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'instagram.js'), 'utf8');

    expect(src).not.toContain('test_code_');
    expect(src).not.toContain('mock_short_token_');
    expect(src).not.toContain('mock_long_token_');
  });
});
