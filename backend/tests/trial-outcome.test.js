/**
 * A connect that grants no trial must say WHY — it may never fall silent.
 *
 * The bug this pins: connecting an Instagram account whose identity had
 * already used its free trial correctly granted nothing, and then said
 * nothing. claimInstagramIdentity() knew the reason and returned only
 * `trialGranted: false`; the callback discarded even that and redirected to a
 * bare /dashboard; and Settings rendered "No plan yet". A spent trial, an
 * unconfirmed email and a genuine bug all looked identical.
 *
 * Three layers, each asserted here:
 *   1. claimInstagramIdentity returns a machine-readable trialOutcome on every branch
 *   2. the OAuth callback carries it on the redirect (?trial=<CODE>)
 *   3. GET /api/billing/summary derives trialStatus, so the pages can explain
 *      the state long after the redirect is gone
 * The UI mapping from those codes is covered in trial-ui-state.test.js.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAccount, uniq } from './helpers/db.js';
import { installMetaStubs, restoreMetaStubs, setIgUser } from './helpers/fake-meta.js';

const require = createRequire(import.meta.url);
const igIdentity = require('../src/lib/igIdentity.js');
const billingRoutes = require('../src/routes/billing.js');
const { TRIAL_OUTCOMES } = igIdentity;

const DAY_MS = 24 * 60 * 60 * 1000;

let app;
let ipCounter = 0;
const nextIp = () => `10.66.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

beforeAll(() => {
  app = buildTestApp({ mount: { '/api/billing': billingRoutes } });
});

beforeEach(async () => {
  await resetDb();
  installMetaStubs();
});

afterEach(() => {
  restoreMetaStubs();
});

async function loginAgent(email, password) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password });
  expect(res.status, `login should succeed, got ${res.status}`).toBe(200);
  return agent;
}

/** An identity that used its trial six days ago — exactly the owner's local state. */
async function spentIdentity(igUserId) {
  return prisma.instagramIdentity.create({
    data: {
      igUserIdHash: igIdentity.hashIgUserId(igUserId),
      trialConsumedAt: new Date(Date.now() - 6 * DAY_MS),
      purgeAfter: igIdentity.purgeAfterDate(),
    },
  });
}

/** Run the real OAuth start + callback and return the redirect URL. */
async function connectOverOAuth(agent, igUserId) {
  setIgUser(igUserId);
  const start = await agent.get('/auth/instagram');
  expect(start.status, 'connect start must redirect to Instagram').toBe(302);
  const state = new URL(start.headers.location).searchParams.get('state');
  const callback = await agent.get('/auth/instagram/callback').query({ code: 'real-auth-code', state });
  expect(callback.status).toBe(302);
  return new URL(callback.headers.location);
}

describe('claimInstagramIdentity — every outcome is reported', () => {
  it('a fresh identity: TRIAL_GRANTED, with 25 auto-reply credits and a 3-day validUntil', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const before = Date.now();

    const claim = await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId: uniq('ig-fresh'), emailVerified: true });

    expect(claim.ok).toBe(true);
    expect(claim.trialOutcome).toBe(TRIAL_OUTCOMES.TRIAL_GRANTED);
    expect(claim.trialGranted).toBe(true);

    const e = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(e.planCode).toBe('TRIAL');
    expect(e.status).toBe('TRIALING');
    expect(e.replyCreditsCurrent).toBe(25);
    expect(e.replyCreditsCurrent).toBe(igIdentity.TRIAL_AUTO_REPLY_CREDITS);
    expect(e.validUntil.getTime() - e.cycleStartedAt.getTime(), 'exactly three days').toBe(3 * DAY_MS);
    expect(e.validUntil.getTime()).toBeGreaterThanOrEqual(before + 3 * DAY_MS);
    expect(e.validUntil.getTime()).toBeLessThanOrEqual(Date.now() + 3 * DAY_MS);
  });

  it('trialConsumedAt already set: no entitlement is created, and TRIAL_ALREADY_CONSUMED is returned', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    const igUserId = uniq('ig-spent');
    const spent = await spentIdentity(igUserId);

    const claim = await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId, emailVerified: true });

    expect(claim.ok, 'connecting is still allowed').toBe(true);
    expect(claim.trialOutcome).toBe(TRIAL_OUTCOMES.TRIAL_ALREADY_CONSUMED);
    expect(claim.trialGranted).toBe(false);
    expect(await prisma.entitlement.findUnique({ where: { userId: user.id } })).toBeNull();

    const after = await prisma.instagramIdentity.findUnique({ where: { igUserIdHash: spent.igUserIdHash } });
    expect(after.trialConsumedAt.getTime(), 'the original stamp is untouched').toBe(spent.trialConsumedAt.getTime());
  });

  it('an unverified email on a fresh identity: EMAIL_UNVERIFIED, and the trial is NOT consumed', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: false });
    const igUserId = uniq('ig-unverified');

    const claim = await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId, emailVerified: false });

    expect(claim.trialOutcome).toBe(TRIAL_OUTCOMES.EMAIL_UNVERIFIED);
    const identity = await prisma.instagramIdentity.findUnique({ where: { igUserIdHash: igIdentity.hashIgUserId(igUserId) } });
    expect(identity.trialConsumedAt).toBeNull();
  });

  it('spent AND unverified reports the spent trial — confirming the email would not help', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: false });
    const igUserId = uniq('ig-spent-unverified');
    await spentIdentity(igUserId);

    const claim = await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId, emailVerified: false });
    expect(claim.trialOutcome).toBe(TRIAL_OUTCOMES.TRIAL_ALREADY_CONSUMED);
  });

  it('an account actively linked to another user: ACCOUNT_ALREADY_LINKED', async () => {
    const owner = await createUser({ withTrial: false });
    const intruder = await createUser({ withTrial: false });
    const igUserId = uniq('ig-taken');
    await createAccount({ userId: owner.user.id, igUserId });

    const claim = await igIdentity.claimInstagramIdentity({ userId: intruder.user.id, igUserId, emailVerified: true });
    expect(claim.ok).toBe(false);
    expect(claim.trialOutcome).toBe(TRIAL_OUTCOMES.ACCOUNT_ALREADY_LINKED);
  });

  it('a blocked identity: ACCOUNT_BLOCKED', async () => {
    const { user } = await createUser({ withTrial: false });
    const igUserId = uniq('ig-blocked');
    await prisma.instagramIdentity.create({
      data: { igUserIdHash: igIdentity.hashIgUserId(igUserId), blockedAt: new Date(), purgeAfter: igIdentity.purgeAfterDate() },
    });

    const claim = await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId, emailVerified: true });
    expect(claim.ok).toBe(false);
    expect(claim.trialOutcome).toBe(TRIAL_OUTCOMES.ACCOUNT_BLOCKED);
  });

  it('a second account on a user who already has a trial: ALREADY_ENTITLED, nothing granted, and that account is NOT stamped', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId: uniq('ig-first'), emailVerified: true });
    const before = await prisma.entitlement.findUnique({ where: { userId: user.id } });

    const secondIg = uniq('ig-second');
    const second = await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId: secondIg, emailVerified: true });
    expect(second.trialOutcome).toBe(TRIAL_OUTCOMES.ALREADY_ENTITLED);
    expect(second.trialGranted, 'nothing was granted, so it must not say so').toBe(false);

    const identity = await prisma.instagramIdentity.findUnique({ where: { igUserIdHash: igIdentity.hashIgUserId(secondIg) } });
    expect(identity.trialConsumedAt, 'an identity that received nothing must not be recorded as having had a trial').toBeNull();
    expect(identity.linkCount, 'the link itself is still counted').toBe(1);

    const after = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(after.validUntil.getTime(), 'and the existing trial is untouched').toBe(before.validUntil.getTime());
  });

  it('that unstamped account can still earn a legitimate trial later, on another Siffty account', async () => {
    const first = await createUser({ withTrial: false, emailVerified: true });
    await igIdentity.claimInstagramIdentity({ userId: first.user.id, igUserId: uniq('ig-a'), emailVerified: true });
    const sharedIg = uniq('ig-b');
    await igIdentity.claimInstagramIdentity({ userId: first.user.id, igUserId: sharedIg, emailVerified: true });
    // The first user disconnects it, so it is free to link elsewhere.
    await prisma.instagramAccount.deleteMany({ where: { igUserId: sharedIg } });

    const second = await createUser({ withTrial: false, emailVerified: true });
    const claim = await igIdentity.claimInstagramIdentity({ userId: second.user.id, igUserId: sharedIg, emailVerified: true });

    expect(claim.trialOutcome).toBe(TRIAL_OUTCOMES.TRIAL_GRANTED);
    expect((await prisma.entitlement.findUnique({ where: { userId: second.user.id } })).status).toBe('TRIALING');
  });

  it('a user holding a NONE entitlement row is still granted, and stamped', async () => {
    const { user } = await createUser({ withTrial: false, emailVerified: true });
    await prisma.entitlement.create({ data: { userId: user.id, status: 'NONE' } });
    const igUserId = uniq('ig-none-row');

    const claim = await igIdentity.claimInstagramIdentity({ userId: user.id, igUserId, emailVerified: true });

    expect(claim.trialOutcome).toBe(TRIAL_OUTCOMES.TRIAL_GRANTED);
    expect((await prisma.entitlement.findUnique({ where: { userId: user.id } })).status).toBe('TRIALING');
    const identity = await prisma.instagramIdentity.findUnique({ where: { igUserIdHash: igIdentity.hashIgUserId(igUserId) } });
    expect(identity.trialConsumedAt).not.toBeNull();
  });
});

describe('the connect callback carries the outcome', () => {
  it('a spent identity redirects with ?trial=TRIAL_ALREADY_CONSUMED, connects, and creates no entitlement', async () => {
    const { user, password } = await createUser({ withTrial: false });
    const agent = await loginAgent(user.email, password);
    const igUserId = uniq('ig-cb-spent');
    await spentIdentity(igUserId);

    const location = await connectOverOAuth(agent, igUserId);

    expect(location.pathname).toBe('/dashboard');
    expect(location.searchParams.get('trial')).toBe('TRIAL_ALREADY_CONSUMED');
    expect(await prisma.instagramAccount.findFirst({ where: { igUserId, userId: user.id } })).not.toBeNull();
    expect(await prisma.entitlement.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it('a fresh identity redirects with ?trial=TRIAL_GRANTED and a 25-credit trial exists', async () => {
    const { user, password } = await createUser({ withTrial: false });
    const agent = await loginAgent(user.email, password);

    const location = await connectOverOAuth(agent, uniq('ig-cb-fresh'));

    expect(location.searchParams.get('trial')).toBe('TRIAL_GRANTED');
    const e = await prisma.entitlement.findUnique({ where: { userId: user.id } });
    expect(e.status).toBe('TRIALING');
    expect(e.replyCreditsCurrent).toBe(25);
  });
});

describe('GET /api/billing/summary — trialStatus explains a tenant with nothing', () => {
  it('after connecting a spent identity, the summary says TRIAL_ALREADY_CONSUMED — never a silent NONE', async () => {
    const { user, password } = await createUser({ withTrial: false });
    const agent = await loginAgent(user.email, password);
    const igUserId = uniq('ig-sum-spent');
    await spentIdentity(igUserId);
    await connectOverOAuth(agent, igUserId);

    const res = await agent.get('/api/billing/summary');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NONE');
    expect(res.body.plan).toBeNull();
    expect(res.body.trialStatus).toBe('TRIAL_ALREADY_CONSUMED');
  });

  it('after connecting a fresh identity, the summary says TRIAL_GRANTED', async () => {
    const { user, password } = await createUser({ withTrial: false });
    const agent = await loginAgent(user.email, password);
    await connectOverOAuth(agent, uniq('ig-sum-fresh'));

    const res = await agent.get('/api/billing/summary');
    expect(res.body.status).toBe('TRIALING');
    expect(res.body.trialStatus).toBe('TRIAL_GRANTED');
  });

  it('a verified tenant with no account connected: TRIAL_NOT_STARTED', async () => {
    const { user, password } = await createUser({ withTrial: false, emailVerified: true });
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/api/billing/summary');
    expect(res.body.trialStatus).toBe('TRIAL_NOT_STARTED');
  });

  it('an unverified tenant: EMAIL_UNVERIFIED', async () => {
    const { user, password } = await createUser({ withTrial: false, emailVerified: false });
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/api/billing/summary');
    expect(res.body.trialStatus).toBe('EMAIL_UNVERIFIED');
  });

  it('a paying tenant: no trialStatus at all', async () => {
    const { user, password } = await createUser();
    await prisma.entitlement.update({
      where: { userId: user.id },
      data: { planCode: 'STARTER', status: 'ACTIVE', validUntil: new Date(Date.now() + 20 * DAY_MS) },
    });
    const agent = await loginAgent(user.email, password);

    const res = await agent.get('/api/billing/summary');
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.trialStatus).toBeNull();
  });
});
