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
export async function createUser({ email, name = 'Test User', password = 'correct-horse-1' } = {}) {
  const bcrypt = (await import('bcryptjs')).default;
  const user = await prisma.user.create({
    data: {
      email: email || `${uniq('user')}@test.codeback`,
      name,
      passwordHash: await bcrypt.hash(password, 4),
      onboardingCompleted: true,
      businessProfile: { create: { businessName: name, autoReplyMode: 'human_only' } },
      preferences: { create: {} },
    },
  });
  return { user, password };
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
