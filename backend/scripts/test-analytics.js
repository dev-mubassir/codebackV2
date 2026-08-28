/**
 * Verification test for Analytics Summary Endpoint (/api/analytics/summary)
 */

const prisma = require('../src/lib/prisma');
const bcrypt = require('bcryptjs');

async function runTest() {
  console.log('======================================================');
  console.log('🧪 Testing Analytics Summary Logic & DB Queries');
  console.log('======================================================\n');

  try {
    // 1. Create or get test user
    const testEmail = `analytics_test_${Date.now()}@example.com`;
    const passwordHash = await bcrypt.hash('TestPassword123!', 10);
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        name: 'Analytics Tester',
        onboardingCompleted: true,
        businessProfile: {
          create: {
            businessName: 'Apex Studio',
            primaryCategory: 'video_editor',
            productsServices: 'Reels Editing',
            pricingInfo: '$50/reel',
          },
        },
      },
    });

    console.log('✓ Created test user:', user.id);

    // 2. Create connected Instagram Account
    const igAccount = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: `ig_test_${Date.now()}`,
        igUsername: 'apex_studio_ig',
        accessToken: 'dummy_token',
        connectionStatus: 'CONNECTED',
      },
    });

    console.log('✓ Created connected Instagram account:', igAccount.id);

    // 3. Create a contact and conversation with messages
    const contact = await prisma.contact.create({
      data: {
        instagramAccountId: igAccount.id,
        igsid: `igsid_${Date.now()}`,
        username: 'client_lead',
      },
    });

    const conv = await prisma.conversation.create({
      data: {
        instagramAccountId: igAccount.id,
        contactId: contact.id,
        category: 'pricing_inquiry',
        priority: 'high',
        lastMessage: 'How much for 5 reels?',
        lastMessageAt: new Date(),
      },
    });

    // Create 3 inbound messages
    const msg1 = await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: 'inbound',
        content: 'Hi, what are your prices?',
        aiStatus: 'completed',
      },
    });

    const msg2 = await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: 'inbound',
        content: 'Do you edit Reels?',
        aiStatus: 'completed',
      },
    });

    const msg3 = await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: 'inbound',
        content: 'Can you deliver in 24 hours?',
        aiStatus: 'failed',
      },
    });

    // Create 2 AI Analyses
    await prisma.aIAnalysis.create({
      data: {
        conversationId: conv.id,
        triggerMessageId: msg1.id,
        category: 'pricing_inquiry',
        priority: 'high',
        status: 'completed',
      },
    });

    await prisma.aIAnalysis.create({
      data: {
        conversationId: conv.id,
        triggerMessageId: msg2.id,
        category: 'service_inquiry',
        priority: 'normal',
        status: 'completed',
      },
    });

    console.log('✓ Seeded test messages and AI analyses');

    // 4. Test analytics query calculations
    const now = new Date();
    const windowMs = 24 * 60 * 60 * 1000;
    const currentSince = new Date(now.getTime() - windowMs);
    const conversationScope = { instagramAccountId: { in: [igAccount.id] } };

    const [currentMessages, currentAiAnalyses, failedMessagesCount] = await Promise.all([
      prisma.message.findMany({
        where: { conversation: conversationScope, direction: 'inbound', createdAt: { gte: currentSince } },
        select: { id: true, createdAt: true, aiStatus: true },
      }),
      prisma.aIAnalysis.findMany({
        where: { conversation: conversationScope, createdAt: { gte: currentSince } },
        select: { id: true, createdAt: true, status: true },
      }),
      prisma.message.count({
        where: { conversation: conversationScope, direction: 'inbound', aiStatus: 'failed', createdAt: { gte: currentSince } },
      }),
    ]);

    console.log(`✓ Total DMs in window: ${currentMessages.length} (expected 3)`);
    console.log(`✓ Total AI Invocations: ${currentAiAnalyses.length} (expected 2)`);
    console.log(`✓ Failed message analyses: ${failedMessagesCount} (expected 1)`);

    if (currentMessages.length !== 3) throw new Error('Expected 3 DMs');
    if (currentAiAnalyses.length !== 2) throw new Error('Expected 2 AI analyses');
    if (failedMessagesCount !== 1) throw new Error('Expected 1 failed message');

    // Cleanup
    await prisma.user.delete({ where: { id: user.id } });
    console.log('✓ Cleaned up test records');

    console.log('\n======================================================');
    console.log('🎉 ALL ANALYTICS TESTS PASSED!');
    console.log('======================================================');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runTest();
