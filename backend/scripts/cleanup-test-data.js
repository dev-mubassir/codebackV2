/**
 * Remove seeded test tenants and everything they own.
 *
 * Older test suites (test-auto-reply, test-isolation, the socket isolation
 * scripts) created users under @test.codeback and left them behind, carrying
 * real InstagramAccount / Conversation / Message rows. This removes them.
 *
 * Dry run by default — prints what it WOULD delete and exits without touching
 * anything. Pass --confirm to actually delete:
 *
 *   node scripts/cleanup-test-data.js            # dry run
 *   node scripts/cleanup-test-data.js --confirm  # delete
 *
 * Matching is deliberately narrow: only the @test.codeback domain, which no
 * real account can use. Real-looking addresses are never matched, even if they
 * were originally created for testing — deleting a live account by accident is
 * far worse than leaving a stale row behind.
 *
 * Rows are removed in dependency order rather than relying on cascade, so the
 * outcome is the same regardless of how referential actions are configured.
 */

const prisma = require('../src/lib/prisma');

const TEST_EMAIL_DOMAIN = '@test.codeback';
const CONFIRM = process.argv.includes('--confirm');

(async () => {
  const targets = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    select: { id: true, email: true },
  });

  if (targets.length === 0) {
    console.log(`\nNo users matching *${TEST_EMAIL_DOMAIN} — nothing to do.\n`);
    await prisma.$disconnect();
    return;
  }

  const userIds = targets.map((u) => u.id);
  const accounts = await prisma.instagramAccount.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);
  const conversations = await prisma.conversation.findMany({
    where: { instagramAccountId: { in: accountIds } },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  const counts = {
    users: targets.length,
    instagramAccounts: accountIds.length,
    contacts: await prisma.contact.count({ where: { instagramAccountId: { in: accountIds } } }),
    conversations: conversationIds.length,
    messages: await prisma.message.count({ where: { conversationId: { in: conversationIds } } }),
    aiAnalyses: await prisma.aIAnalysis.count({ where: { conversationId: { in: conversationIds } } }),
    conversationSummaries: await prisma.conversationSummary.count({ where: { conversationId: { in: conversationIds } } }),
    replyGenerations: await prisma.replyGeneration.count({ where: { conversationId: { in: conversationIds } } }),
    brandDeals: await prisma.brandDeal.count({ where: { userId: { in: userIds } } }),
    notifications: await prisma.notification.count({ where: { userId: { in: userIds } } }),
    usageEvents: await prisma.usageEvent.count({ where: { userId: { in: userIds } } }),
    webhookLogs: await prisma.webhookLog.count({ where: { instagramAccountId: { in: accountIds } } }),
    businessProfiles: await prisma.businessProfile.count({ where: { userId: { in: userIds } } }),
    creatorPreferences: await prisma.creatorPreference.count({ where: { userId: { in: userIds } } }),
    subscriptions: await prisma.subscription.count({ where: { userId: { in: userIds } } }),
  };

  console.log(`\n${CONFIRM ? 'DELETING' : 'DRY RUN — would delete'}:\n`);
  targets.forEach((u) => console.log(`  user  ${u.email}`));
  console.log('');
  for (const [table, n] of Object.entries(counts)) {
    if (n > 0) console.log(`  ${String(n).padStart(4)}  ${table}`);
  }

  if (!CONFIRM) {
    console.log('\nDry run only. Re-run with --confirm to delete.\n');
    await prisma.$disconnect();
    return;
  }

  await prisma.aIAnalysis.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationSummary.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.replyGeneration.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.brandDeal.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.contact.deleteMany({ where: { instagramAccountId: { in: accountIds } } });
  await prisma.webhookLog.deleteMany({ where: { instagramAccountId: { in: accountIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.usageEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.instagramAccount.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.businessProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.creatorPreference.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  const remaining = await prisma.user.count({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
  console.log(`\nDone. Remaining *${TEST_EMAIL_DOMAIN} users: ${remaining}\n`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
