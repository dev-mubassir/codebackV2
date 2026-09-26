/**
 * Email quota safety (Gate 3c): an alert fires at 80 % of the daily cap, and
 * any blocked password-reset / verification email raises its own alert — a
 * critical send is never refused silently.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createRequire } from 'module';

import { prisma } from './helpers/db.js';

const require = createRequire(import.meta.url);
const quota = require('../src/lib/email/quota.js');
const mailer = require('../src/lib/email/index.js');
const { CHECKS } = require('../src/jobs/alertJob.js');
const check = CHECKS.find((c) => c.name === 'checkEmailQuota');

let savedCap;
beforeEach(() => {
  savedCap = process.env.EMAIL_DAILY_CAP;
  process.env.EMAIL_DAILY_CAP = '10';
  quota._reset();
});
afterEach(() => {
  if (savedCap === undefined) delete process.env.EMAIL_DAILY_CAP;
  else process.env.EMAIL_DAILY_CAP = savedCap;
  quota._reset();
});
afterAll(async () => prisma.$disconnect());

describe('email quota alerts', () => {
  it('quiet below 80 %, alerts at 80 % of the cap', async () => {
    for (let i = 0; i < 7; i += 1) quota.recordSend('trialEnding', `u${i}@test.codeback`);
    expect(await check()).toBeNull();
    quota.recordSend('trialEnding', 'u8@test.codeback');
    const alert = await check();
    expect(alert.type).toBe('email_quota_80');
    expect(alert.facts.join(' ')).toContain('8/10');
  });

  it('a blocked password reset raises the critical alert, even below 80 %', async () => {
    // Exhaust the per-recipient limit for one address, so the 4th reset is refused.
    for (let i = 0; i < 3; i += 1) quota.recordSend('passwordReset', 'locked@test.codeback');
    await expect(mailer.sendPasswordReset('locked@test.codeback', { resetUrl: 'https://app.test.local/reset?t=x' })).rejects.toThrow(/quota/i);
    const alert = await check();
    expect(alert.type).toBe('email_critical_blocked');
    expect(alert.title).toMatch(/^1 password-reset\/verification email/);
  });
});
