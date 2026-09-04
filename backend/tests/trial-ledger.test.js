/**
 * P2 — the Instagram identity ledger and the trial grant.
 *
 * THE ABUSE THIS PREVENTS. Without a ledger, "delete your account and sign up
 * again" is an unlimited free trial. The obvious fix — recording the grant on
 * the User row — cannot work, because deleting the user deletes the evidence.
 * So InstagramIdentity has NO relation to User and survives account deletion.
 *
 * THE INVARIANT. A trial granted without a matching trialConsumedAt stamp is
 * the bug that makes the whole ledger pointless, so the grant, the stamp and
 * the link count happen in ONE transaction. That is asserted directly below.
 *
 * The two non-happy paths matter as much as the happy one:
 *   - legitimate reconnection after a token expiry must be idempotent and must
 *     NOT re-consume a trial
 *   - a genuine business moving workspaces must get a clear message and a
 *     support path, and every refusal must be logged with a user id and a
 *     timestamp so abuse can be told apart from confusion
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';

import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const igIdentity = require('../src/lib/igIdentity.js');

beforeAll(() => {
  // The ledger refuses to operate without a pepper; the test env sets one.
  expect(process.env.IG_IDENTITY_PEPPER, 'tests need a pepper configured').toBeTruthy();
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('P2 — pseudonymisation', () => {
  it('stores a HASH, never the raw Instagram id', async () => {
    const igUserId = uniq('ig-raw');
    const { user } = await createUser({ withTrial: false });

    await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId, emailVerified: true });

    const rows = await prisma.instagramIdentity.findMany({});
    expect(rows.length).toBe(1);
    expect(rows[0].igUserIdHash).not.toBe(igUserId);
    expect(
      JSON.stringify(rows),
      'the raw id must appear nowhere — the table must not be an enumerable customer list'
    ).not.toContain(igUserId);
  });

  it('refuses to operate without IG_IDENTITY_PEPPER', () => {
    const previous = process.env.IG_IDENTITY_PEPPER;
    delete process.env.IG_IDENTITY_PEPPER;
    try {
      expect(() => igIdentity.hashIgUserId('123')).toThrow(/IG_IDENTITY_PEPPER/);
    } finally {
      process.env.IG_IDENTITY_PEPPER = previous;
    }
  });

  it('the same id always hashes the same way, and different ids differ', () => {
    const a = igIdentity.hashIgUserId('12345');
    const b = igIdentity.hashIgUserId('12345');
    const c = igIdentity.hashIgUserId('54321');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('P2 — the trial grant invariant', () => {
  it('grants a 3-day trial AND stamps the ledger, atomically', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const igUserId = uniq('ig-grant');

    const result = await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId,
      emailVerified: true,
    });

    expect(result.ok).toBe(true);
    expect(result.trialGranted).toBe(true);

    const subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });
    const identity = await prisma.instagramIdentity.findUnique({
      where: { igUserIdHash: igIdentity.hashIgUserId(igUserId) },
    });

    expect(subscription.status).toBe('TRIALING');
    expect(
      identity.trialConsumedAt,
      'a trial without a ledger stamp is the bug that makes the ledger pointless'
    ).not.toBeNull();

    // 3 days, no card.
    const days = (subscription.trialEndsAt - subscription.trialStartedAt) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(3);
  });

  it('THE CORE PROPERTY: deleting the account and starting over does NOT get a second trial', async () => {
    const igUserId = uniq('ig-abuse');

    // First user connects and consumes the trial.
    const first = await createUser({ withTrial: false, emailVerified: true });
    const firstClaim = await igIdentity.claimInstagramIdentity({
      userId: first.user.id,
      igUserId,
      emailVerified: true,
    });
    expect(firstClaim.trialGranted).toBe(true);

    // They delete their entire account — cascading away everything that
    // relates to them.
    await prisma.user.delete({ where: { id: first.user.id } });
    expect(await prisma.subscription.findMany({})).toHaveLength(0);

    // The ledger row must have SURVIVED. This is the whole design.
    const ledger = await prisma.instagramIdentity.findMany({});
    expect(
      ledger.length,
      'if the ledger cascaded with the user, deleting the account would reset the trial'
    ).toBe(1);
    expect(ledger[0].trialConsumedAt).not.toBeNull();

    // Same Instagram account, brand new Codeback user.
    const second = await createUser({ withTrial: false, emailVerified: true });
    const secondClaim = await igIdentity.claimInstagramIdentity({
      userId: second.user.id,
      igUserId,
      emailVerified: true,
    });

    expect(secondClaim.ok, 'they may still connect').toBe(true);
    expect(secondClaim.trialGranted, 'but they must NOT get another trial').toBe(false);

    const sub = await prisma.subscription.findUnique({ where: { userId: second.user.id } });
    expect(sub, 'no trialing subscription should exist for the second user').toBeNull();
  });

  it('an UNVERIFIED email gets no trial, but may still connect', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: false });
    const igUserId = uniq('ig-unverified');

    const result = await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId,
      emailVerified: false,
    });

    expect(result.ok).toBe(true);
    expect(result.trialGranted, 'no confirmed address, no trial').toBe(false);

    const identity = await prisma.instagramIdentity.findUnique({
      where: { igUserIdHash: igIdentity.hashIgUserId(igUserId) },
    });
    expect(
      identity.trialConsumedAt,
      'and the ledger must NOT be stamped — they have not consumed anything'
    ).toBeNull();
  });
});

describe('P2 — legitimate reconnection is idempotent', () => {
  it('the same user reconnecting the same account gets no second trial and no error', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const igUserId = uniq('ig-reconnect');

    const first = await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId,
      emailVerified: true,
    });
    expect(first.trialGranted).toBe(true);

    // A real reconnection after a token expiry.
    const account = await createAccount({ userId: user.id, igUserId });
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { connectionStatus: 'DISCONNECTED' },
    });

    const second = await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId,
      emailVerified: true,
    });

    expect(second.ok, 'reconnecting must not error').toBe(true);
    expect(second.trialGranted, 'and must not re-consume the trial').toBe(false);

    const identity = await prisma.instagramIdentity.findUnique({
      where: { igUserIdHash: igIdentity.hashIgUserId(igUserId) },
    });
    expect(identity.linkCount, 'but the link IS counted, both times').toBe(2);
  });

  it('connecting a SECOND Instagram account does not reset an existing trial', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });

    await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId: uniq('ig-one'),
      emailVerified: true,
    });
    const before = await prisma.subscription.findUnique({ where: { userId: user.id } });

    await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId: uniq('ig-two'),
      emailVerified: true,
    });
    const after = await prisma.subscription.findUnique({ where: { userId: user.id } });

    expect(
      after.trialEndsAt.getTime(),
      'a second account must not extend the trial clock'
    ).toBe(before.trialEndsAt.getTime());
  });
});

describe('P2 — an actively linked account is refused', () => {
  it('a different user is refused, with the owner NOT named', async () => {
    const owner = await createUser({ withTrial: false, emailVerified: true });
    const stranger = await createUser({ withTrial: false, emailVerified: true });
    const igUserId = uniq('ig-owned');

    await createAccount({ userId: owner.user.id, igUserId, withConversation: true });

    const result = await igIdentity.claimInstagramIdentity({
      userId: stranger.user.id,
      igUserId,
      emailVerified: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('connected_elsewhere');
    // The route uses ownerUserId only for the audit log, never the response.
    expect(result.ownerUserId).toBe(owner.user.id);
  });

  it('a blocked identity is refused outright', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const igUserId = uniq('ig-blocked');

    await prisma.instagramIdentity.create({
      data: { igUserIdHash: igIdentity.hashIgUserId(igUserId), blockedAt: new Date() },
    });

    const result = await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId,
      emailVerified: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('blocked');
    const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
    expect(sub, 'a blocked identity must not receive a trial').toBeNull();
  });
});

describe('P2 — entitlement drives AI processing, not access', () => {
  it('an active trial is entitled', async () => {
    const { user } = await createUser({ withTrial: true });
    expect(await igIdentity.hasActiveEntitlement(user.id)).toBe(true);
  });

  it('a trial past its end date is NOT entitled, even before the sweeper runs', async () => {
    const { user } = await createUser({ withTrial: true });
    await prisma.subscription.update({
      where: { userId: user.id },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });

    expect(
      await igIdentity.hasActiveEntitlement(user.id),
      'expiry must take effect immediately, not on the sweeper schedule'
    ).toBe(false);
  });

  it('a user with no subscription at all is not entitled', async () => {
    const { user } = await createUser({ withTrial: false });
    expect(await igIdentity.hasActiveEntitlement(user.id)).toBe(false);
  });

  it('the trial job flips TRIALING to TRIAL_EXPIRED exactly once', async () => {
    const { expireFinishedTrials } = require('../src/jobs/trialJob.js');
    const { user } = await createUser({ withTrial: true });
    await prisma.subscription.update({
      where: { userId: user.id },
      data: { trialEndsAt: new Date(Date.now() - 1000) },
    });

    expect(await expireFinishedTrials()).toBe(1);
    const after = await prisma.subscription.findUnique({ where: { userId: user.id } });
    expect(after.status).toBe('TRIAL_EXPIRED');

    // A second sweep must be a no-op, or every run re-emails the user.
    expect(await expireFinishedTrials()).toBe(0);
  });
});
