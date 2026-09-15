/**
 * Instagram connect must work with billing switched OFF.
 *
 * THE GAP THIS CLOSES. The Subscription -> Entitlement merge rewrote
 * claimInstagramIdentity()'s transaction — the path every Instagram connect
 * runs through — and nothing asserted that connect still completed. It was
 * caught only because a human tried to connect an account by hand.
 *
 * The failure mode is specifically nasty: Prisma Client SELECTs every column
 * its schema declares, so once the client knew about `entitlements.
 * region_source` and a database did not have it yet, the full-row read in
 * this transaction threw, the transaction aborted, and connect failed for
 * EVERY user. `/health` returned 200 the whole time.
 *
 * BILLING_ENABLED is explicitly unset in every test here. The flag gates
 * ENFORCEMENT (classification, auto-reply credits), never account
 * connection — a user must be able to connect Instagram with billing
 * entirely switched off, which is the state the product ships in until Meta
 * App Review lands. A regression that only appeared with the flag on would
 * be missed by every other test in this suite, all of which run with it off.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

import { prisma, resetDb, createUser, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const igIdentity = require('../src/lib/igIdentity.js');

beforeEach(async () => {
  await resetDb();
  // The state the product actually ships in today.
  delete process.env.BILLING_ENABLED;
});

afterEach(() => {
  delete process.env.BILLING_ENABLED;
});

describe('Instagram connect with BILLING_ENABLED off', () => {
  it('completes the claim and creates a TRIALING entitlement', async () => {
    expect(process.env.BILLING_ENABLED, 'precondition: billing is off').toBeUndefined();

    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const igUserId = uniq('ig-connect');

    const claim = await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId,
      emailVerified: true,
    });

    expect(claim.ok, 'the connect claim itself must succeed').toBe(true);
    expect(claim.trialGranted).toBe(true);

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(entitlement, 'a connect that grants no entitlement has silently half-failed').not.toBeNull();
    expect(entitlement.status).toBe('TRIALING');
    expect(entitlement.planCode).toBe('TRIAL');
    expect(entitlement.validUntil).not.toBeNull();

    // The nullable trio: a TRIALING row has no plan purchase behind it, so
    // it has locked no region and no currency. If these were ever made NOT
    // NULL again, the trial grant would fail at the insert.
    expect(entitlement.billingRegion).toBeNull();
    expect(entitlement.currency).toBeNull();
    expect(entitlement.regionSource).toBeNull();

    // The invariant the whole anti-abuse ledger rests on: grant and stamp
    // are one transaction.
    const identity = await prisma.instagramIdentity.findUnique({
      where: { igUserIdHash: igIdentity.hashIgUserId(igUserId) },
    });
    expect(identity.trialConsumedAt).not.toBeNull();
  });

  it('links the account end to end — the row a user would actually see', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const igUserId = uniq('ig-link');

    const claim = await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId,
      emailVerified: true,
    });
    expect(claim.ok).toBe(true);

    // routes/auth.js writes this row immediately after a successful claim.
    const account = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId,
        igUsername: uniq('handle'),
        accessToken: 'iv:ct:tag',
        connectionStatus: 'CONNECTED',
      },
    });

    expect(account.connectionStatus).toBe('CONNECTED');
    const linked = await prisma.instagramAccount.findFirst({
      where: { userId: user.id, connectionStatus: 'CONNECTED' },
    });
    expect(linked, 'the account must actually be linked and findable').not.toBeNull();
    expect(linked.id).toBe(account.id);
  });

  it('is idempotent — reconnecting does not error and does not re-grant', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const igUserId = uniq('ig-reconnect');

    const first = await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId, emailVerified: true });
    expect(first.trialGranted).toBe(true);
    const afterFirst = await prisma.entitlement.findUnique({ where: { userId: user.id } });

    const second = await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId, emailVerified: true });
    expect(second.ok, 'a reconnect must not error').toBe(true);
    expect(second.trialGranted, 'and must not hand out a second trial').toBe(false);

    const afterSecond = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(afterSecond.validUntil.getTime(), 'the trial clock must not move').toBe(
      afterFirst.validUntil.getTime()
    );
  });

  it('connects without a trial when the email is unverified — connect still succeeds', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: false });

    const claim = await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId: uniq('ig-unverified'),
      emailVerified: false,
    });

    // No trial, but connecting is NOT blocked — those are separate decisions.
    expect(claim.ok).toBe(true);
    expect(claim.trialGranted).toBe(false);
    expect(await prisma.entitlement.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it('reads only the pinned entitlement columns, so a forward-drifted schema cannot break connect', async () => {
    // The actual regression: a column existing in the client but not yet in
    // the database. Asserted structurally — the claim result must expose the
    // pinned field list and nothing wider, so adding a column to Entitlement
    // tomorrow cannot quietly become a connect dependency.
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const claim = await igIdentity.claimInstagramIdentity({
      userId: user.id,
      igUserId: uniq('ig-fields'),
      emailVerified: true,
    });

    expect(claim.entitlement).toBeTruthy();
    // replyCreditsBanked joined the list deliberately: the trial grant now
    // writes a ledger row, and that row's balanceAfter needs the true banked
    // balance. A NAMED addition like this is the point of pinning — what this
    // test forbids is a column becoming a connect dependency by accident.
    expect(Object.keys(claim.entitlement).sort()).toEqual(
      ['cycleStartedAt', 'id', 'planCode', 'replyCreditsBanked', 'replyCreditsCurrent', 'status', 'userId', 'validUntil'].sort()
    );
    expect(
      Object.keys(claim.entitlement),
      'region_source was the column that broke connect — it must not be read here'
    ).not.toContain('regionSource');
  });
});
