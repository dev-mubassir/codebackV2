/**
 * Which Cashfree environment the backend calls.
 *
 * The bug this pins: a production deploy ALWAYS called the live API
 * (api.cashfree.com), so running the production site against Cashfree's test
 * account was impossible — sandbox keys failed there with an opaque
 * `authentication_error`, and checkout said only "Couldn't start checkout".
 * CASHFREE_ENV now overrides the NODE_ENV rule, and the frontend's
 * NEXT_PUBLIC_CASHFREE_MODE must follow the same rule so the two never
 * disagree.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getBaseUrl, cashfreeEnvironment } = require('../src/lib/cashfree.js');

const SANDBOX = 'https://sandbox.cashfree.com';
const PRODUCTION = 'https://api.cashfree.com';

const saved = { NODE_ENV: process.env.NODE_ENV, CASHFREE_ENV: process.env.CASHFREE_ENV };
afterEach(() => {
  process.env.NODE_ENV = saved.NODE_ENV;
  if (saved.CASHFREE_ENV === undefined) delete process.env.CASHFREE_ENV;
  else process.env.CASHFREE_ENV = saved.CASHFREE_ENV;
});

function withEnv({ NODE_ENV, CASHFREE_ENV }) {
  process.env.NODE_ENV = NODE_ENV;
  if (CASHFREE_ENV === undefined) delete process.env.CASHFREE_ENV;
  else process.env.CASHFREE_ENV = CASHFREE_ENV;
}

describe('getBaseUrl — NODE_ENV decides when CASHFREE_ENV is unset (unchanged behaviour)', () => {
  it('production -> live API', () => {
    withEnv({ NODE_ENV: 'production' });
    expect(getBaseUrl()).toBe(PRODUCTION);
  });

  it('anything else -> sandbox', () => {
    for (const NODE_ENV of ['development', 'test', '']) {
      withEnv({ NODE_ENV });
      expect(getBaseUrl(), NODE_ENV).toBe(SANDBOX);
    }
  });
});

describe('getBaseUrl — CASHFREE_ENV overrides NODE_ENV', () => {
  it('a production deploy can run against the Cashfree TEST account', () => {
    withEnv({ NODE_ENV: 'production', CASHFREE_ENV: 'sandbox' });
    expect(cashfreeEnvironment()).toBe('sandbox');
    expect(getBaseUrl()).toBe(SANDBOX);
  });

  it('a non-production deploy can be forced onto the live API', () => {
    withEnv({ NODE_ENV: 'development', CASHFREE_ENV: 'production' });
    expect(getBaseUrl()).toBe(PRODUCTION);
  });

  it('tolerates case and surrounding whitespace in the value', () => {
    withEnv({ NODE_ENV: 'production', CASHFREE_ENV: '  Sandbox ' });
    expect(getBaseUrl()).toBe(SANDBOX);
  });

  it('an unrecognised value is ignored, never guessed at — NODE_ENV decides', () => {
    for (const CASHFREE_ENV of ['test', 'live', 'true', '1', '']) {
      withEnv({ NODE_ENV: 'production', CASHFREE_ENV });
      expect(getBaseUrl(), CASHFREE_ENV).toBe(PRODUCTION);
    }
  });

  it('is read at call time, so a changed setting applies without reloading the module', () => {
    withEnv({ NODE_ENV: 'production' });
    expect(getBaseUrl()).toBe(PRODUCTION);
    process.env.CASHFREE_ENV = 'sandbox';
    expect(getBaseUrl()).toBe(SANDBOX);
  });
});

describe('the frontend follows the same rule', () => {
  it('useCheckout.js honours NEXT_PUBLIC_CASHFREE_MODE and otherwise uses NODE_ENV', () => {
    const src = fs.readFileSync(new URL('../../frontend/src/app/components/billing/useCheckout.js', import.meta.url), 'utf8');
    expect(src).toMatch(/process\.env\.NEXT_PUBLIC_CASHFREE_MODE/);
    expect(src).toMatch(/override === 'sandbox' \|\| override === 'production'/);
    expect(src).toMatch(/process\.env\.NODE_ENV === 'production' \? 'production' : 'sandbox'/);
  });
});
