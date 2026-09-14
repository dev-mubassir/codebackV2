/**
 * Test fixtures. Everything created here is namespaced with a run-unique
 * suffix and torn down by resetDb(), which only ever touches prisma/test.db
 * (see tests/setup/env.js).
 */

import prismaModule from '../../src/lib/prisma.js';
import cryptoLib from '../../src/lib/crypto.js';

const prisma = prismaModule;
const { encrypt } = cryptoLib;

let seq = 0;
export const uniq = (label) => `${label}-${Date.now()}-${seq++}`;

/** Wipe every table, children first. Used in beforeEach. */
export async function resetDb() {
  await prisma.adminLog.deleteMany({});
  await prisma.webhookLog.deleteMany({});
  // Auth-hardening tables. The first three cascade from User, but deleting
  // them explicitly keeps the teardown order readable and independent of
  // whether a given test created a user at all.
  await prisma.authToken.deleteMany({});
  await prisma.authIdentity.deleteMany({});
  await prisma.entitlement.deleteMany({});
  // No relation to User by design — these survive account deletion, so
  // nothing else clears them.
  //
  // The billing three (orders, credit_ledger, renewal_reminders) are in this
  // group for the same reason InstagramIdentity is: they deliberately carry a
  // plain tenantId with no foreign key, so deleting a User cascades nothing
  // here. Without these lines a tenantId reused across test files would
  // inherit the previous file's ledger rows and reminder history — and
  // renewal_reminders in particular is an idempotency guard, so a stale row
  // silently suppresses the send a later test is asserting.
  await prisma.renewalReminder.deleteMany({});
  await prisma.creditLedger.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.instagramIdentity.deleteMany({});
  await prisma.oAuthNonce.deleteMany({});
  await prisma.deletionRequest.deleteMany({});
  await prisma.webhookDelivery.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.replyGeneration.deleteMany({});
  await prisma.brandDeal.deleteMany({});
  await prisma.conversationSummary.deleteMany({});
  await prisma.aIAnalysis.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.contact.deleteMany({});
  await prisma.instagramAccount.deleteMany({});
  await prisma.creatorPreference.deleteMany({});
  await prisma.businessProfile.deleteMany({});
  await prisma.user.deleteMany({});
}

/** A registered tenant with a known password, ready to log in over HTTP. */
/**
 * @param {object} [opts]
 * @param {boolean} [opts.emailVerified=true]
 *   Most tests want a usable account. Pass false to exercise the gates that
 *   depend on an unproven address — Google auto-link refusal, and the trial
 *   grant.
 * @param {'bcrypt'|'argon2'} [opts.hashWith='bcrypt']
 *   Defaults to bcrypt at cost 4 — cheap, and it is exactly the legacy shape
 *   the lazy-rehash-on-login path is supposed to migrate.
 * @param {boolean} [opts.withPassword=true]
 *   false produces a Google-only account (passwordHash null).
 * @param {boolean} [opts.withTrial=true]
 *   Gives the user an ACTIVE trial. Defaults to true because AI classification
 *   and auto-reply are gated on entitlement, so without it most fixtures would
 *   silently exercise the "expired" path instead of what they mean to test.
 *   Set false when the test is ABOUT entitlement.
 */
export async function createUser({
  email,
  name = 'Test User',
  password = 'correct-horse-1',
  emailVerified = true,
  hashWith = 'bcrypt',
  withPassword = true,
  withTrial = true,
} = {}) {
  let passwordHash = null;
  if (withPassword) {
    if (hashWith === 'argon2') {
      const { hashPassword } = await import('../../src/lib/password.js');
      passwordHash = await hashPassword(password);
    } else {
      const bcrypt = (await import('bcryptjs')).default;
      passwordHash = await bcrypt.hash(password, 4);
    }
  }

  const user = await prisma.user.create({
    data: {
      email: email || `${uniq('user')}@test.codeback`,
      name,
      passwordHash,
      emailVerifiedAt: emailVerified ? new Date() : null,
      onboardingCompleted: true,
      businessProfile: { create: { businessName: name, autoReplyMode: 'human_only' } },
      preferences: { create: {} },
      ...(withTrial
        ? {
            entitlement: {
              create: {
                planCode: 'TRIAL',
                status: 'TRIALING',
                cycleStartedAt: new Date(),
                validUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
              },
            },
          }
        : {}),
    },
  });
  return { user, password };
}

/** Force a user's trial into the expired state, for entitlement tests. */
export async function expireTrial(userId) {
  return prisma.entitlement.upsert({
    where: { userId },
    create: {
      userId,
      planCode: 'TRIAL',
      status: 'EXPIRED',
      cycleStartedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      validUntil: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
    update: {
      status: 'EXPIRED',
      validUntil: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });
}

/** An Instagram account owned by `userId`, optionally carrying real history. */
export async function createAccount({ userId, igUserId, withConversation = false }) {
  const account = await prisma.instagramAccount.create({
    data: {
      userId,
      igUserId: igUserId || uniq('ig'),
      igUsername: uniq('handle'),
      accessToken: encrypt('token-for-test'),
    },
  });

  if (withConversation) {
    const contact = await prisma.contact.create({
      data: { instagramAccountId: account.id, igsid: uniq('igsid'), username: 'a_customer' },
    });
    await prisma.conversation.create({
      data: { instagramAccountId: account.id, contactId: contact.id, lastMessage: 'hi there' },
    });
  }

  return account;
}

export { prisma };
