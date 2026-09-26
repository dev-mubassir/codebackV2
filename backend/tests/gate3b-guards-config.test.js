/**
 * Gate 3b:
 *   - unhandled rejections are counted and alerted on (> 5 in 10 min)
 *   - uncaught exceptions trigger a graceful shutdown with exit code 1
 *   - src/cli/configCheck.js reports set/missing/invalid WITHOUT printing any
 *     value (or a length, prefix or hash of one)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from './helpers/db.js';

const require = createRequire(import.meta.url);
const guards = require('../src/lib/processGuards.js');
const { CHECKS } = require('../src/jobs/alertJob.js');

const here = path.dirname(fileURLToPath(import.meta.url));
afterAll(async () => prisma.$disconnect());

describe('unhandled rejections are visible', () => {
  it('are counted per 10-minute window and alert above the threshold', async () => {
    const check = CHECKS.find((c) => c.name === 'checkUnhandledRejections');
    const now = Date.now();
    const before = await guards.unhandledLast10m(now);
    for (let i = 0; i < guards.UNHANDLED_ALERT_THRESHOLD - before; i += 1) guards.recordUnhandled(now);
    expect(await check(now), 'at the threshold: no alert yet').toBeNull();
    guards.recordUnhandled(now);
    const alert = await check(now);
    expect(alert.type).toBe('unhandled_rejections');
    expect(guards.stats().thisInstanceSinceBoot).toBeGreaterThan(0);
    // Old events age out of the window.
    expect(await guards.unhandledLast10m(now + 11 * 60 * 1000)).toBe(0);
  });

  it('an uncaught exception shuts down gracefully with exit code 1 (never keeps running)', () => {
    const script = `
      const { installProcessGuards } = require(${JSON.stringify(path.join(here, '..', 'src', 'lib', 'processGuards.js'))});
      installProcessGuards({ shutdown: async (reason, code) => { console.log('SHUTDOWN', reason, code); process.exit(code); } });
      setTimeout(() => { throw new Error('boom'); }, 10);
    `;
    let out = '';
    let code = 0;
    try {
      out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      out = String(err.stdout);
      code = err.status;
    }
    expect(out).toContain('SHUTDOWN uncaughtException 1');
    expect(code).toBe(1);
  });
});

describe('configCheck prints statuses, never values', () => {
  const run = (env) => {
    try {
      return { out: execFileSync(process.execPath, [path.join(here, '..', 'src', 'cli', 'configCheck.js')], { env, encoding: 'utf8' }), code: 0 };
    } catch (err) {
      return { out: String(err.stdout), code: err.status };
    }
  };
  const SECRETS = {
    SESSION_SECRET: 'S'.repeat(40) + 'uniqueSessionMarker',
    TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
    OAUTH_STATE_SECRET: 'O'.repeat(40) + 'uniqueOauthMarker',
    IG_IDENTITY_PEPPER: 'P'.repeat(20) + 'uniquePepperMarker',
    INSTAGRAM_APP_SECRET: '0123456789abcdef0123456789abcdef',
    GOOGLE_CLIENT_SECRET: 'GOCSPX-uniqueGoogleMarker',
    CASHFREE_SECRET_KEY: 'cfsk_ma_prod_uniqueCashfreeMarker',
    RESEND_API_KEY: 're_uniqueResendMarker',
    GEMINI_API_KEY: 'AIza' + 'uniqueGeminiMarker'.padEnd(30, 'x'),
    WEBHOOK_VERIFY_TOKEN: 'uniqueVerifyMarker',
    DB_PASSWORD: 'uniqueDbPasswordMarker',
  };
  const base = {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    DB_HOST: 'primary--postgres', DB_PORT: '5432', DB_USER: 'u', DB_NAME: 'd',
    REDIS_URL: 'rediss://default:uniqueRedisMarker@redis:6379',
    FRONTEND_URL: 'https://app.siffty.com', BACKEND_URL: 'https://api.siffty.com',
    REDIRECT_URI: 'https://api.siffty.com/auth/instagram/callback',
    INSTAGRAM_APP_ID: '1234567890', GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com',
    SUPPORT_EMAIL: 'support@siffty.com', BILLING_ENABLED: 'true',
    CASHFREE_ENV: 'production', CASHFREE_APP_ID: 'appid-1234',
    ...SECRETS,
  };

  it('PASSes a complete production config and prints no secret material', () => {
    const { out, code } = run(base);
    expect(out).toContain('CONFIG CHECK: PASS');
    expect(code).toBe(0);
    for (const v of Object.values(SECRETS)) expect(out).not.toContain(v);
    expect(out).not.toMatch(/unique\w*Marker|cfsk_|re_unique|GOCSPX|AIza|rediss:\/\//);
  });

  it('FAILs on production keys with sandbox mode, AI_MOCK in production, or a missing SESSION_SECRET — still without values', () => {
    const { out, code } = run({ ...base, CASHFREE_ENV: 'sandbox', AI_MOCK: 'true', SESSION_SECRET: '' });
    expect(code).toBe(1);
    expect(out).toMatch(/CASHFREE_ENV\s+invalid format — the secret key is for the other Cashfree environment/);
    expect(out).toMatch(/AI_MOCK\s+invalid format — must NOT be set in production/);
    expect(out).toMatch(/SESSION_SECRET\s+missing/);
    expect(out).not.toMatch(/unique\w*Marker/);
  });
});
