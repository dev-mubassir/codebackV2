/**
 * Email quotas — per-recipient throttles and the global daily cap.
 *
 * WHY THE GLOBAL CAP EXISTS. Per-recipient limits bound what one person can
 * trigger and say nothing about the total. Forty users sending three emails
 * each is 120 — past the Resend free tier's 100/day — and once that is hit,
 * sending stops for EVERYONE, password resets included. So a burst of
 * trial-ending notices could lock a real user out of their own account.
 *
 * The reserve is what prevents that: deferrable sends stop at (cap - reserve),
 * critical sends may use the whole cap.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const quota = require('../src/lib/email/quota.js');
const mailer = require('../src/lib/email/index.js');

const envBackup = {};

beforeEach(() => {
  envBackup.cap = process.env.EMAIL_DAILY_CAP;
  envBackup.reserve = process.env.EMAIL_CRITICAL_RESERVE;
  quota._reset();
});

afterEach(() => {
  for (const [k, envKey] of [['cap', 'EMAIL_DAILY_CAP'], ['reserve', 'EMAIL_CRITICAL_RESERVE']]) {
    if (envBackup[k] === undefined) delete process.env[envKey];
    else process.env[envKey] = envBackup[k];
  }
  quota._reset();
});

describe('per-recipient, per-type throttle', () => {
  it('allows 3 per hour per recipient per type, then refuses', () => {
    const to = 'someone@test.codeback';
    for (let i = 0; i < 3; i += 1) {
      expect(quota.check('passwordReset', to).ok, `send ${i + 1} should be allowed`).toBe(true);
      quota.recordSend('passwordReset', to);
    }
    const fourth = quota.check('passwordReset', to);
    expect(fourth.ok).toBe(false);
    expect(fourth.reason).toBe('per_recipient');
  });

  it('is PER TYPE — exhausting resets does not block verification', () => {
    const to = 'someone@test.codeback';
    for (let i = 0; i < 3; i += 1) quota.recordSend('passwordReset', to);

    expect(quota.check('passwordReset', to).ok).toBe(false);
    expect(
      quota.check('verification', to).ok,
      'a different mail type to the same person must not be collateral damage'
    ).toBe(true);
  });

  it('is PER RECIPIENT — one address does not throttle another', () => {
    for (let i = 0; i < 3; i += 1) quota.recordSend('passwordReset', 'a@test.codeback');
    expect(quota.check('passwordReset', 'a@test.codeback').ok).toBe(false);
    expect(quota.check('passwordReset', 'b@test.codeback').ok).toBe(true);
  });

  it('is case-insensitive, so casing cannot be used to get more sends', () => {
    for (let i = 0; i < 3; i += 1) quota.recordSend('passwordReset', 'Person@Test.Codeback');
    expect(quota.check('passwordReset', 'person@test.codeback').ok).toBe(false);
  });
});

describe('global daily cap, and the critical reserve', () => {
  it('THE CORE PROPERTY: deferrable sends cannot eat the reserve', () => {
    process.env.EMAIL_DAILY_CAP = '10';
    process.env.EMAIL_CRITICAL_RESERVE = '4';
    quota._reset();

    // Deferrable sends stop at cap - reserve = 6.
    for (let i = 0; i < 6; i += 1) {
      expect(quota.check('trialEnding', `u${i}@test.codeback`).ok).toBe(true);
      quota.recordSend('trialEnding', `u${i}@test.codeback`);
    }

    const blocked = quota.check('trialEnding', 'next@test.codeback');
    expect(blocked.ok, 'the 7th deferrable send must be refused').toBe(false);
    expect(blocked.reason).toBe('daily_cap');

    // But a password reset — someone actually locked out — still gets through.
    expect(
      quota.check('passwordReset', 'locked-out@test.codeback').ok,
      'a burst of notices must never consume the capacity a reset needs'
    ).toBe(true);
  });

  it('critical sends are refused only at the FULL cap', () => {
    process.env.EMAIL_DAILY_CAP = '5';
    process.env.EMAIL_CRITICAL_RESERVE = '2';
    quota._reset();

    for (let i = 0; i < 5; i += 1) quota.recordSend('passwordReset', `u${i}@test.codeback`);
    expect(quota.check('passwordReset', 'last@test.codeback').ok).toBe(false);
  });

  it('the cap is configurable by env var', () => {
    process.env.EMAIL_DAILY_CAP = '3';
    process.env.EMAIL_CRITICAL_RESERVE = '0';
    quota._reset();

    for (let i = 0; i < 3; i += 1) quota.recordSend('verification', `u${i}@test.codeback`);
    expect(quota.check('verification', 'x@test.codeback').ok).toBe(false);
    expect(quota.stats().cap).toBe(3);
  });

  it('a reserve >= cap cannot block every deferrable send outright', () => {
    process.env.EMAIL_DAILY_CAP = '5';
    process.env.EMAIL_CRITICAL_RESERVE = '99'; // nonsense input
    quota._reset();

    // Clamped, so at least one deferrable send is still possible.
    expect(quota.check('trialEnding', 'a@test.codeback').ok).toBe(true);
  });

  it('the default cap sits BELOW the Resend free tier, not at it', () => {
    delete process.env.EMAIL_DAILY_CAP;
    quota._reset();
    expect(
      quota.stats().cap,
      'headroom matters — retries and anything sent outside this module also count'
    ).toBeLessThan(100);
  });
});

describe('quota is consumed on success only, and trips the health gate', () => {
  it('a FAILED send does not burn quota', async () => {
    mailer._resetQuota();
    mailer._resetHealth();

    const before = mailer.quotaStats().sentToday;

    // No recipient -> deliver() throws before the transport is reached.
    await expect(mailer.sendPasswordReset('', { url: 'x', expiresInMinutes: 30 })).rejects.toThrow();

    expect(
      mailer.quotaStats().sentToday,
      'a provider failure must not consume capacity a working send needs'
    ).toBe(before);
  });

  it('a successful send DOES consume quota', async () => {
    mailer._resetQuota();
    mailer._resetHealth();

    const before = mailer.quotaStats().sentToday;
    await mailer.sendPasswordReset('someone@test.codeback', {
      url: 'https://example.test/reset?token=x',
      expiresInMinutes: 30,
    });
    expect(mailer.quotaStats().sentToday).toBe(before + 1);
  });

  it('hitting the cap trips the SAME health gate as a provider outage', async () => {
    process.env.EMAIL_DAILY_CAP = '1';
    process.env.EMAIL_CRITICAL_RESERVE = '0';
    mailer._resetQuota();
    mailer._resetHealth();

    await mailer.sendVerification('first@test.codeback', {
      url: 'https://example.test/v?token=x',
      expiresInMinutes: 60,
    });

    // Second send is over the cap.
    await expect(
      mailer.sendVerification('second@test.codeback', {
        url: 'https://example.test/v?token=y',
        expiresInMinutes: 60,
      })
    ).rejects.toThrow(/quota/i);

    expect(
      mailer.isDegraded(),
      'the cap must degrade the transport, so callers answer honestly instead of claiming success'
    ).toBe(true);
    expect(mailer.degradedReason()).toMatch(/quota/i);
  });
});
