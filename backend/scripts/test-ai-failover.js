require('dotenv').config();
const aiService = require('../src/services/aiService');

let passCount = 0;
let failCount = 0;

function check(label, condition, extra) {
  if (condition) {
    passCount++;
    console.log(`  ✅ PASS — ${label}`);
  } else {
    failCount++;
    console.log(`  ❌ FAIL — ${label}${extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''}`);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('  AI Multi-Provider & Auto-Failover Verification');
  console.log('='.repeat(60) + '\n');

  // Test 1: Standard AI Analysis with current env keys (Primary: Gemini)
  console.log('--- TEST 1: Standard DM Analysis with Automatic Provider ---');
  const testMsg = 'Hey! We love your reels. We are GymShark and want to offer you a $2,500 brand sponsorship for 2 dedicated reels next month.';
  const res1 = await aiService.analyzeConversation({
    messageText: testMsg,
    contactUsername: 'gymshark_partners',
    recentMessages: [{ direction: 'inbound', content: testMsg, messageType: 'text' }],
  });

  console.log('Analysis result:', {
    category: res1.category,
    confidence: res1.confidence,
    brandDeal: res1.brandDeal?.brandName,
    budget: res1.brandDeal?.budgetAmount,
    model: res1.model,
    provider: res1.provider,
    failed: res1.failed,
  });

  check('Analysis succeeds', res1.failed === false);
  check('Correctly detected as brand_deal or collaboration', res1.category === 'brand_deal' || res1.category === 'collaboration', res1.category);
  check('Extracted GymShark deal', res1.brandDeal?.brandName?.toLowerCase().includes('gymshark') || res1.brandDeal?.budgetAmount === 2500, res1.brandDeal);
  check('Model and provider recorded', Boolean(res1.model) && Boolean(res1.provider), { model: res1.model, provider: res1.provider });

  // Test 2: AI Summary Generation
  console.log('\n--- TEST 2: AI Summary Generation ---');
  const summaryRes = await aiService.summarizeConversation({
    recentMessages: [
      { direction: 'inbound', content: 'Hey, are you taking brand deals right now?' },
      { direction: 'outbound', content: 'Yes! What brand and budget?' },
      { direction: 'inbound', content: 'We are Gymshark with $2,500 budget for 2 reels.' }
    ],
    brandDeal: res1.brandDeal
  });

  console.log('Summary result:', summaryRes);
  check('Summary generated successfully', summaryRes.failed === false && Boolean(summaryRes.summary), summaryRes);

  // Test 3: Reply Generation
  console.log('\n--- TEST 3: AI Reply Generation ---');
  const replyRes = await aiService.generateReply({
    recentMessages: [{ direction: 'inbound', content: testMsg }],
    contactUsername: 'gymshark_partners',
    brandDeal: res1.brandDeal,
    category: 'brand_deal'
  });

  console.log('Reply result:', replyRes);
  check('Reply generated successfully', replyRes.failed === false && typeof replyRes.text === 'string' && replyRes.text.length > 5, replyRes);

  // Test 4: Auto-failover simulation (Primary configured as failing provider, e.g. grok)
  console.log('\n--- TEST 4: Auto-Shift / Failover Simulation ---');
  const oldProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'grok'; // Force Grok as primary (which has the invalid key)

  console.log('Set AI_PROVIDER=grok (invalid key in OPENAI_API_KEY)... Expecting auto-shift to Gemini:');
  const failoverRes = await aiService.analyzeConversation({
    messageText: 'Can you tell me how to buy your photography preset pack?',
    contactUsername: 'fan_buyer',
  });

  console.log('Failover result:', {
    category: failoverRes.category,
    model: failoverRes.model,
    provider: failoverRes.provider,
    failed: failoverRes.failed,
  });

  check('Auto-failover recovered successfully', failoverRes.failed === false && failoverRes.provider === 'gemini', failoverRes);
  check('Categorized as customer or questions or other', ['customer', 'question', 'other', 'support'].includes(failoverRes.category), failoverRes.category);

  // Restore env
  process.env.AI_PROVIDER = oldProvider;

  // Test 5: Graceful degradation when ALL providers fail
  console.log('\n--- TEST 5: Complete degradation when all keys fail ---');
  const oldGeminiKey = process.env.GEMINI_API_KEY;
  const oldOpenAIKey = process.env.OPENAI_API_KEY;
  process.env.GEMINI_API_KEY = 'invalid-bad-key';
  process.env.OPENAI_API_KEY = 'invalid-bad-key';

  const degradedRes = await aiService.analyzeConversation({
    messageText: 'Hello there, just checking in!',
    contactUsername: 'friend_user',
  });

  console.log('Degraded result:', degradedRes);
  check('Degrades gracefully without throwing', degradedRes.category === 'other' && degradedRes.failed === true, degradedRes);

  // Restore keys
  process.env.GEMINI_API_KEY = oldGeminiKey;
  process.env.OPENAI_API_KEY = oldOpenAIKey;

  // Check stats
  const stats = aiService.getAIStats();
  console.log('\nAI Stats after tests:', stats);
  check('aiStats recorded failovers', stats.providerFailovers > 0, stats.providerFailovers);

  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${passCount} passed, ${failCount} failed out of ${passCount + failCount}`);
  console.log('='.repeat(60) + '\n');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
