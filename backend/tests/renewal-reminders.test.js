/**
 * Gate 7 — the paid renewal sequence (jobs/renewalReminderJob.js).
 *
 * There is no autopay on this product, so these four emails are the entire
 * mechanism by which a paying customer keeps paying. The properties that
 * matter are therefore not "a function was called":
 *
 *   - each of the four windows fires, exactly once, with the right message
 *   - a second pass of the job sends NOTHING (it runs ~4x/day over windows
 *     that are a day or more wide — without this, a tenant three days out
 *     would be mailed on every pass)
 *   - a trial tenant never receives the paid sequence
 *   - a renewed tenant becomes eligible again, with no cleanup step
 *   - the subject carries the REAL credit count, and says nothing when the
 *     count is zero
 *   - the expiry and grace notices cannot be starved by the deferrable
 *     email reserve
 *
 * Nothing here stubs the mailer. Sends run all the way through lib/email to
 * the console transport (tests/setup/env.js deletes RESEND_API_KEY, and
 * pickTransport() hard-forces console under NODE_ENV=test), so what these
 * assertions read is the subject and link that ACTUALLY went out, plus the
 * quota counter — which lib/email only advances on a successful send.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createRequire } from 'module';

import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const job = require('../src/jobs/renewalReminderJob.js');
const mailer = require('../src/lib/email/index.js');
const quota = require('../src/lib/email/quota.js');
const entitlementService = require('../src/services/entitlementService.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Offsets chosen well inside each window, never on a boundary — the job
// computes `now` itself, so a fixture sitting exactly on an edge would be
// decided by a few milliseconds of drift.
const IN_DAY_27 = 2 * DAY_MS;
const IN_DAY_29 = 12 * HOUR_MS;
const IN_EXPIRY = -1 * HOUR_MS;
const IN_GRACE_FINAL = -2.5 * DAY_MS;

let mail;

beforeEach(async () => {
  await resetDb();
  // renewal_reminders has no relation to User (same deliberate shape as
  // CreditLedger), so resetDb() — a helper shared with every other gate in
  // flight — does not clear it. Cleaning up here keeps this file from having
  // to edit that helper.
  await prisma.renewalReminder.deleteMany({});
  mailer._resetQuota();
  mailer._resetHealth();
  mail = captureMail();
});

afterEach(() => {
  mail.restore();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Capture what the console transport actually emitted.
 *
 * This reads lib/email's own output rather than replacing the mailer: the
 * subject being asserted is the one the template produced, after deliver()
 * accepted it and the transport wrote it. A stub in place of the mailer would
 * assert only that this test file and the job agree with each other.
 */
function captureMail() {
  const messages = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    const line = args.join(' ');
    const to = (line.match(/\[email:console\] TO: (.+)/) || [])[1];
    if (!to) return;
    messages.push({
      to: to.trim(),
      subject: ((line.match(/\[email:console\] SUBJECT: (.+)/) || [])[1] || '').trim(),
      link: ((line.match(/\[email:console\] LINK: (.+)/) || [])[1] || '').trim(),
      body: line,
    });
  });
  return { messages, restore: () => spy.mockRestore() };
}

/**
 * A paid tenant whose plan expires `msUntilExpiry` from now.
 *
 * graceUntil is set the way grantPlan() sets it (validUntil + 3 days) so the
 * fixture is shaped like a real paid row rather than only like what this job
 * happens to read.
 */
async function createPaidTenant({
  msUntilExpiry,
  current = 0,
  banked = 0,
  planCode = 'STARTER',
  status = 'ACTIVE',
} = {}) {
  const { user } = await createUser({ withTrial: false });
  const validUntil = new Date(Date.now() + msUntilExpiry);
  await prisma.entitlement.create({
    data: {
      userId: user.id,
      planCode,
      status,
      validUntil,
      graceUntil: new Date(validUntil.getTime() + 3 * DAY_MS),
      cycleStartedAt: new Date(validUntil.getTime() - 30 * DAY_MS),
      replyCreditsCurrent: current,
      replyCreditsBanked: banked,
    },
  });
  return user;
}

const remindersFor = (userId) =>
  prisma.renewalReminder.findMany({ where: { tenantId: userId }, orderBy: { sentAt: 'asc' } });

describe('the four windows', () => {
  const cases = [
    { name: 'day 27 (3 days out)', offset: IN_DAY_27, type: 'DAY_27', subject: /expires in 3 days/ },
    { name: 'day 29 (1 day out)', offset: IN_DAY_29, type: 'DAY_29', subject: /expires tomorrow/ },
    { name: 'expiry day', offset: IN_EXPIRY, type: 'EXPIRY', subject: /expires today/ },
    { name: 'grace final day', offset: IN_GRACE_FINAL, type: 'GRACE_FINAL', subject: /has expired/ },
  ];

  for (const c of cases) {
    it(`${c.name} sends ${c.type} exactly once`, async () => {
      const user = await createPaidTenant({ msUntilExpiry: c.offset, current: 40 });

      expect(await job.sendRenewalReminders()).toBe(1);

      expect(mail.messages).toHaveLength(1);
      expect(mail.messages[0].to).toBe(user.email);
      expect(mail.messages[0].subject).toMatch(c.subject);

      const rows = await remindersFor(user.id);
      expect(rows.map((r) => r.reminderType)).toEqual([c.type]);

      // The same tenant, the same cycle, a later pass of the same job.
      expect(await job.sendRenewalReminders(), 'a re-run must send nothing').toBe(0);
      expect(mail.messages).toHaveLength(1);
      expect(await remindersFor(user.id)).toHaveLength(1);
    });
  }

  it('sends one email per tenant per pass, and nothing at all on the second pass', async () => {
    await createPaidTenant({ msUntilExpiry: IN_DAY_27, current: 10 });
    await createPaidTenant({ msUntilExpiry: IN_DAY_29, current: 10 });
    await createPaidTenant({ msUntilExpiry: IN_EXPIRY, current: 10 });
    await createPaidTenant({ msUntilExpiry: IN_GRACE_FINAL, current: 10 });

    expect(await job.sendRenewalReminders()).toBe(4);
    expect(
      new Set(mail.messages.map((m) => m.to)).size,
      'the windows are disjoint, so no tenant may receive two emails in one pass'
    ).toBe(4);

    expect(await job.sendRenewalReminders(), 'THE re-run property').toBe(0);
    expect(mail.messages).toHaveLength(4);
  });

  it('leaves tenants outside every window alone', async () => {
    await createPaidTenant({ msUntilExpiry: 10 * DAY_MS }); // mid-cycle
    await createPaidTenant({ msUntilExpiry: 3.5 * DAY_MS }); // not yet day 27
    await createPaidTenant({ msUntilExpiry: -3.5 * DAY_MS }); // grace already over

    expect(await job.sendRenewalReminders()).toBe(0);
    expect(mail.messages).toHaveLength(0);
  });

  it('still sends the expiry notice when the status column already says EXPIRED', async () => {
    // validUntil/graceUntil are the source of truth and `status` is a lazily
    // written cache (entitlementService: "EFFECTIVE STATUS IS LAZY"). If this
    // job filtered on status, whether the customer got their last two notices
    // would depend on whether some other sweep had run first.
    const user = await createPaidTenant({ msUntilExpiry: IN_EXPIRY, status: 'EXPIRED', current: 12 });

    expect(await job.sendRenewalReminders()).toBe(1);
    expect((await remindersFor(user.id))[0].reminderType).toBe('EXPIRY');
  });

  it('ignores a live entitlement carrying no plan code at all', async () => {
    // There is no plan to renew and nothing to put in ?renew=, so a link built
    // from this row would send the customer to a checkout for "null".
    const { user } = await createUser({ withTrial: false });
    await prisma.entitlement.create({
      data: {
        userId: user.id,
        planCode: null,
        status: 'ACTIVE',
        validUntil: new Date(Date.now() + IN_DAY_27),
        cycleStartedAt: new Date(),
      },
    });

    expect(await job.sendRenewalReminders()).toBe(0);
    expect(mail.messages).toHaveLength(0);
  });

  it('ignores an entitlement that was never granted anything', async () => {
    const { user } = await createUser({ withTrial: false });
    await prisma.entitlement.create({
      data: {
        userId: user.id,
        planCode: null,
        status: 'NONE',
        validUntil: new Date(Date.now() + IN_DAY_27),
        cycleStartedAt: new Date(),
      },
    });

    expect(await job.sendRenewalReminders()).toBe(0);
    expect(mail.messages).toHaveLength(0);
  });
});

describe('trial tenants are not in this sequence', () => {
  it('never sends the paid sequence to a TRIAL entitlement', async () => {
    // A trial is 3 days long, so its validUntil sits inside the day-27 and
    // day-29 windows for most of its life — which is exactly why the plan
    // filter has to exist. jobs/trialJob.js owns these tenants.
    const { user } = await createUser({ withTrial: true }); // TRIALING, expires in 3 days
    await prisma.entitlement.update({
      where: { userId: user.id },
      data: { validUntil: new Date(Date.now() + IN_DAY_29) },
    });

    expect(await job.sendRenewalReminders()).toBe(0);
    expect(mail.messages).toHaveLength(0);
    expect(await remindersFor(user.id)).toHaveLength(0);
  });
});

describe('a renewal makes the tenant eligible again', () => {
  it('restamps cycleStartedAt, so the next cycle gets its own set of reminders', async () => {
    const plan = await prisma.plan.create({
      data: {
        code: uniq('PLAN').toUpperCase(),
        name: 'Test Plan',
        igAccountLimit: 1,
        autoReplyCreditsPerCycle: 500,
        autoReplyBankCap: 500,
        cycleLengthDays: 30,
      },
    });
    const user = await createPaidTenant({ msUntilExpiry: IN_DAY_27, planCode: plan.code, current: 40 });
    const before = await prisma.entitlement.findUnique({ where: { userId: user.id } });

    expect(await job.sendRenewalReminders()).toBe(1);
    expect(await job.sendRenewalReminders()).toBe(0);

    // A real renewal, through the real service — not a hand-written row.
    await entitlementService.grantPlan(user.id, plan.code, {
      billingRegion: null,
      currency: null,
      regionSource: null,
    });
    const after = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(after.cycleStartedAt.getTime()).toBeGreaterThan(before.cycleStartedAt.getTime());
    expect(
      after.validUntil.getTime(),
      'renewing early extends from validUntil, so the new cycle is 30 days past the OLD expiry'
    ).toBe(before.validUntil.getTime() + 30 * DAY_MS);

    // The only thing simulated here is the passage of those 30 days: the new
    // cycle's expiry comes back into the day-27 window. Nothing else about the
    // row is touched, and no reminder rows are cleaned up.
    await prisma.entitlement.update({
      where: { userId: user.id },
      data: { validUntil: new Date(Date.now() + IN_DAY_27) },
    });

    expect(await job.sendRenewalReminders(), 'the new cycle is a new key').toBe(1);

    const rows = await remindersFor(user.id);
    expect(rows.map((r) => r.reminderType)).toEqual(['DAY_27', 'DAY_27']);
    expect(
      new Set(rows.map((r) => r.cycleStartedAt.getTime())).size,
      'two rows, two cycles — the unique constraint is on the cycle, not on the tenant'
    ).toBe(2);
  });
});

describe('the subject carries the real credit count', () => {
  it('prints the sum of current and banked credits', async () => {
    await createPaidTenant({ msUntilExpiry: IN_DAY_27, current: 200, banked: 140 });

    await job.sendRenewalReminders();

    expect(mail.messages[0].subject).toBe(
      'Your Siffty plan expires in 3 days — you have 340 unused replies waiting'
    );
  });

  it('says nothing about credits when there are none', async () => {
    await createPaidTenant({ msUntilExpiry: IN_EXPIRY, current: 0, banked: 0 });

    await job.sendRenewalReminders();

    // "you have 0 unused replies waiting" advertises that renewing recovers
    // nothing, which is worse than not mentioning it.
    expect(mail.messages[0].subject).toBe('Your Siffty plan expires today');
    expect(mail.messages[0].subject).not.toMatch(/0 unused/);
  });

  it('is singular for a single credit', async () => {
    await createPaidTenant({ msUntilExpiry: IN_DAY_29, current: 1 });

    await job.sendRenewalReminders();

    expect(mail.messages[0].subject).toMatch(/1 unused reply waiting$/);
  });
});

describe('the GRACE_FINAL forfeiture deadline (ruling 3c)', () => {
  it('names the exact instant the credit bank is cleared, not "today"', async () => {
    await createPaidTenant({ msUntilExpiry: IN_GRACE_FINAL, current: 40, banked: 10 });

    await job.sendRenewalReminders();

    const body = mail.messages[0].body;
    // A real clock time with a named zone. This is the only message where
    // something is lost irreversibly, so a reader in any timezone has to be
    // able to act on it without guessing.
    expect(body).toMatch(/Renew before .+ IST/);
    expect(body).toMatch(/\d{1,2}:\d{2}\s?(am|pm)/i);
    expect(body).toMatch(/cleared/);

    // The vague wording this ruling replaced must be gone.
    expect(body).not.toMatch(/Renew today and everything picks up/);
  });

  it('degrades to deadline-free wording rather than printing a broken date', async () => {
    // A row with no graceUntil should never render "Renew before undefined".
    const templates = require('../src/lib/email/templates.js');
    const rendered = templates.renewalReminder({
      reminderType: 'GRACE_FINAL',
      unusedCredits: 5,
      checkoutUrl: 'https://example.test/billing?renew=STARTER',
      forfeitAt: null,
    });
    expect(rendered.text).not.toMatch(/undefined|null|Invalid Date/);
    expect(rendered.text).toMatch(/last day of your grace period/);
  });
});

describe('the checkout link', () => {
  it('is one prefilled checkout URL, not a login-then-navigate flow', async () => {
    const user = await createPaidTenant({ msUntilExpiry: IN_GRACE_FINAL, planCode: 'PRO', current: 5 });

    await job.sendRenewalReminders();

    // The exact cross-gate contract Gate 5's billing page reads.
    expect(mail.messages[0].link).toBe(
      `${process.env.FRONTEND_URL}/billing?renew=PRO&src=email_GRACE_FINAL`
    );
    expect(mail.messages[0].to).toBe(user.email);
  });

  it('tags each stage separately so the sequence is attributable', async () => {
    await createPaidTenant({ msUntilExpiry: IN_DAY_27, planCode: 'STARTER' });
    await createPaidTenant({ msUntilExpiry: IN_EXPIRY, planCode: 'STARTER' });

    await job.sendRenewalReminders();

    const sources = mail.messages.map((m) => m.link.match(/src=(\S+)/)[1]).sort();
    expect(sources).toEqual(['email_DAY_27', 'email_EXPIRY']);
  });
});

describe('the last two notices cannot be starved by the deferrable reserve', () => {
  const envBackup = {};

  beforeEach(() => {
    envBackup.cap = process.env.EMAIL_DAILY_CAP;
    envBackup.reserve = process.env.EMAIL_CRITICAL_RESERVE;
  });

  afterEach(() => {
    for (const [k, key] of [['cap', 'EMAIL_DAILY_CAP'], ['reserve', 'EMAIL_CRITICAL_RESERVE']]) {
      if (envBackup[k] === undefined) delete process.env[key];
      else process.env[key] = envBackup[k];
    }
    mailer._resetQuota();
    mailer._resetHealth();
  });

  it('maps EXPIRY and GRACE_FINAL onto critical quota types, and the nudges onto deferrable ones', () => {
    expect(quota.CRITICAL_TYPES.has(mailer.RENEWAL_QUOTA_TYPES.EXPIRY)).toBe(true);
    expect(quota.CRITICAL_TYPES.has(mailer.RENEWAL_QUOTA_TYPES.GRACE_FINAL)).toBe(true);
    expect(quota.CRITICAL_TYPES.has(mailer.RENEWAL_QUOTA_TYPES.DAY_27)).toBe(false);
    expect(quota.CRITICAL_TYPES.has(mailer.RENEWAL_QUOTA_TYPES.DAY_29)).toBe(false);
  });

  it('still delivers the expiry notice once deferrable capacity is gone', async () => {
    process.env.EMAIL_DAILY_CAP = '3';
    process.env.EMAIL_CRITICAL_RESERVE = '2'; // deferrable sends stop at 1
    mailer._resetQuota();
    mailer._resetHealth();
    quota.recordSend('trialEnding', 'someone-else@test.codeback'); // that 1 is spent

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await createPaidTenant({ msUntilExpiry: IN_DAY_27, current: 10 });
    const expiring = await createPaidTenant({ msUntilExpiry: IN_EXPIRY, current: 10 });

    // One send, and it is the one someone is about to lose service over.
    expect(await job.sendRenewalReminders()).toBe(1);
    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0].to).toBe(expiring.email);
    expect(mail.messages[0].subject).toMatch(/expires today/);
    expect(errors).toHaveBeenCalled(); // the blocked nudge is reported, not swallowed
    errors.mockRestore();
  });

  it('records the reminder before sending, so a failed send never re-sends later', async () => {
    // The deliberate trade in renewalReminderJob.js: insert-then-send loses at
    // most one notice when the send fails, where send-then-insert would mail a
    // paying customer twice after a crash. This asserts the losing side is the
    // one we chose on purpose.
    process.env.EMAIL_DAILY_CAP = '3';
    process.env.EMAIL_CRITICAL_RESERVE = '2';
    mailer._resetQuota();
    mailer._resetHealth();
    quota.recordSend('trialEnding', 'someone-else@test.codeback');

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const nudged = await createPaidTenant({ msUntilExpiry: IN_DAY_27, current: 10 });

    expect(await job.sendRenewalReminders()).toBe(0);
    expect(mail.messages).toHaveLength(0);
    expect(
      (await remindersFor(nudged.id)).map((r) => r.reminderType),
      'the row is written first, so the blocked nudge is not retried on the next pass'
    ).toEqual(['DAY_27']);
    errors.mockRestore();
  });
});
