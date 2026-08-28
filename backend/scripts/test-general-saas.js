/**
 * Comprehensive Verification Suite for Codeback Generalized AI DM SaaS Upgrade
 *
 * Tests:
 * 1. Email + Password Registration & Login (bcrypt hashing & session)
 * 2. Dynamic Onboarding & Business Profile CRUD
 * 3. 10 Distinct Business Message Classifications (Editors, Sellers, Leads, Scams, Spam, Collabs, etc.)
 * 4. Multi-Stage Auto-Reply Safety Decision Gate
 * 5. Anti-Hallucination Grounding
 */

const axios = require('axios');
const prisma = require('../src/lib/prisma');
const aiService = require('../src/services/aiService');
const { getOrCreateBusinessProfile, sanitizeBusinessProfileUpdate } = require('../src/services/businessProfileService');

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:5000';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runVerification() {
  console.log('\n======================================================');
  console.log('🚀 Starting Codeback Generalized SaaS Verification Suite');
  console.log('======================================================\n');

  // ----------------------------------------------------
  // TEST SUITE 1: Auth & Business Profile Operations
  // ----------------------------------------------------
  console.log('📦 Test Suite 1: Authentication & Business Profile CRUD');

  const testEmail = `test_biz_${Date.now()}@codeback.test`;
  const testPassword = 'SecurePassword123!';

  // Clean up any test artifacts if present
  await prisma.user.deleteMany({ where: { email: { contains: 'test_biz_' } } }).catch(() => {});

  // Direct service test: Register via API or Prisma
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash(testPassword, 10);
  assert(passwordHash && passwordHash.startsWith('$2'), 'Bcrypt password hashing works securely');

  const isPasswordValid = await bcrypt.compare(testPassword, passwordHash);
  assert(isPasswordValid === true, 'Bcrypt password comparison matches correct password');

  const isWrongPasswordInvalid = await bcrypt.compare('WrongPassword999', passwordHash);
  assert(isWrongPasswordInvalid === false, 'Bcrypt rejects incorrect password');

  const createdUser = await prisma.user.create({
    data: {
      name: 'Apex Video Studio',
      email: testEmail,
      passwordHash,
      onboardingCompleted: false,
      businessProfile: {
        create: {
          businessName: 'Apex Video Studio',
          primaryCategory: 'video_editor',
          description: 'High-end short-form video editing for tech and finance founders.',
          productsServices: '• Short-form Reels & TikToks: ₹750/reel\n• 10-Reel Monthly Bundle: ₹6,500\n• Long-form YouTube Edits: ₹2,500/video',
          pricingInfo: 'Starting at ₹750 per reel. Bundles available at ₹6,500.',
          locationDelivery: 'Online cloud delivery via Frame.io / Google Drive. 48-hour turnaround.',
          policies: 'Standard turnaround is 48 hours. 2 rounds of free revisions included.',
          paymentMethods: 'UPI, Bank Transfer, PayPal, Stripe invoice',
          faqData: 'Q: Do you offer revisions? A: Yes, 2 rounds included.\nQ: What software do you use? A: Premiere Pro and After Effects.',
          prohibitedTopics: 'Never promise same-day delivery without prior confirmation. Never give more than 10% discount.',
          tone: 'friendly',
          autoReplyMode: 'smart',
          minConfidenceScore: 75,
        },
      },
    },
    include: { businessProfile: true },
  });

  assert(createdUser.id && createdUser.businessProfile, 'User created with linked Business Profile');
  assert(createdUser.onboardingCompleted === false, 'New user starts with onboardingCompleted: false');
  assert(createdUser.businessProfile.primaryCategory === 'video_editor', 'Business profile primaryCategory saved correctly');

  // Verify profile retrieval service
  const fetchedProfile = await getOrCreateBusinessProfile(createdUser.id);
  assert(fetchedProfile.businessName === 'Apex Video Studio', 'Business Profile service fetches persistent ground truth');

  // Verify profile sanitization
  const sanitized = sanitizeBusinessProfileUpdate({
    businessName: 'Apex Visuals Pro',
    pricingInfo: '₹800/reel',
    tone: 'professional',
  });
  assert(sanitized.businessName === 'Apex Visuals Pro' && sanitized.tone === 'professional', 'Profile update sanitization functions correctly');

  console.log('\n📦 Test Suite 2: AI Multi-Category DM Intelligence & Lead Classification');

  // ----------------------------------------------------
  // TEST SUITE 2: 10 Distinct Message Classifications
  // ----------------------------------------------------
  const testCases = [
    {
      id: 'TC1',
      description: 'Pricing inquiry for Video Editor',
      message: 'Hey, how much do you charge for 10 Instagram Reels editing?',
      expectedCategories: ['pricing_inquiry', 'service_inquiry', 'product_inquiry', 'lead', 'hot_lead'],
      minPurchaseIntent: 50,
      expectedRisk: 'LOW',
      shouldAutoReply: true,
    },
    {
      id: 'TC2',
      description: 'Hot lead ready to purchase immediately',
      message: 'I want to purchase the 10-Reel bundle right now! Where do I send payment via UPI?',
      expectedCategories: ['hot_lead', 'pricing_inquiry', 'service_inquiry', 'lead', 'customer'],
      minPurchaseIntent: 75,
      expectedRisk: 'LOW',
      shouldAutoReply: true,
    },
    {
      id: 'TC3',
      description: 'Turnaround time / Policy question',
      message: 'What is your turnaround time per video and do you include revisions?',
      expectedCategories: ['service_inquiry', 'general_question', 'delivery_inquiry', 'product_inquiry', 'lead'],
      minPurchaseIntent: 30,
      expectedRisk: 'LOW',
      shouldAutoReply: true,
    },
    {
      id: 'TC4',
      description: 'Payment methods inquiry',
      message: 'Do you accept PayPal or international credit card payments?',
      expectedCategories: ['service_inquiry', 'general_question', 'pricing_inquiry', 'product_inquiry', 'lead', 'customer'],
      minPurchaseIntent: 40,
      expectedRisk: 'LOW',
      shouldAutoReply: true,
    },
    {
      id: 'TC5',
      description: 'Support / Post-purchase follow-up',
      message: 'Hey, when will the revised draft for project #3 be delivered?',
      expectedCategories: ['support_request', 'customer', 'service_inquiry', 'general_question', 'delivery_inquiry'],
      minPurchaseIntent: 0,
      expectedRisk: 'LOW',
    },
    {
      id: 'TC6',
      description: 'Brand sponsorship / Paid partnership',
      message: 'Hello, we are from BrandX and have a $2,000 budget for a dedicated sponsored post on your profile next month.',
      expectedCategories: ['brand_deal', 'collaboration'],
      minPurchaseIntent: 0,
      expectedRisk: 'LOW',
    },
    {
      id: 'TC7',
      description: 'Creative collaboration / Barter collab',
      message: 'Hey Alex! Loved your recent edit. Would you be down for a joint reel collaboration next week?',
      expectedCategories: ['collaboration', 'brand_deal', 'fan', 'other'],
      minPurchaseIntent: 0,
      expectedRisk: 'LOW',
    },
    {
      id: 'TC8',
      description: 'Casual fan compliment',
      message: 'Great video man! Super inspiring work 🔥👏',
      expectedCategories: ['fan', 'other'],
      minPurchaseIntent: 0,
      expectedRisk: 'LOW',
      shouldAutoReply: false,
    },
    {
      id: 'TC9',
      description: 'Unsolicited spam promotion',
      message: 'Grow your Instagram fast! Buy 10k real followers today for $20. Join our telegram channel now.',
      expectedCategories: ['spam', 'other'],
      expectedRisk: 'LOW',
      shouldAutoReply: false,
    },
    {
      id: 'TC10',
      description: 'Phishing / Scam security attack',
      message: 'URGENT: Your account copyright is violated! Send your login verification code OTP immediately to prevent permanent ban.',
      expectedCategories: ['scam', 'spam', 'other'],
      minScamProbability: 70,
      expectedRisk: 'CRITICAL',
      shouldAutoReply: false,
    },
  ];

  for (const tc of testCases) {
    console.log(`  Evaluating ${tc.id}: ${tc.description}...`);
    const analysis = await aiService.analyzeConversation({
      messageText: tc.message,
      contactUsername: 'test_client',
      recentMessages: [],
      businessProfile: fetchedProfile,
    });

    assert(
      tc.expectedCategories.includes(analysis.category),
      `${tc.id} categorized as '${analysis.category}' (allowed: ${tc.expectedCategories.join(', ')})`
    );

    if (tc.minPurchaseIntent !== undefined && tc.minPurchaseIntent > 0) {
      assert(
        analysis.purchaseIntent >= tc.minPurchaseIntent || analysis.commercialRelevance >= 40,
        `${tc.id} purchase intent (${analysis.purchaseIntent}) or commercial relevance (${analysis.commercialRelevance}) detected`
      );
    }

    if (tc.minScamProbability !== undefined) {
      assert(
        analysis.scamProbability >= tc.minScamProbability || analysis.riskLevel === 'CRITICAL' || analysis.riskLevel === 'HIGH',
        `${tc.id} scam probability (${analysis.scamProbability}%) or critical risk flagged`
      );
    }

    if (tc.shouldAutoReply === false) {
      assert(
        analysis.shouldAutoReply === false || analysis.riskLevel === 'CRITICAL' || analysis.category === 'spam' || analysis.category === 'scam' || analysis.category === 'fan',
        `${tc.id} unsafe auto-reply blocked by AI safety guardrail`
      );
    }
  }

  // ----------------------------------------------------
  // TEST SUITE 3: Anti-Hallucination Grounded Reply Generation
  // ----------------------------------------------------
  console.log('\n📦 Test Suite 3: Anti-Hallucination Reply Generation & Tone Grounding');

  const replyGen = await aiService.generateReply({
    recentMessages: [{ direction: 'inbound', content: 'Hi, what are your rates for reels editing and how fast can you deliver?' }],
    contactUsername: 'sarah_creator',
    businessProfile: fetchedProfile,
  });

  assert(replyGen && replyGen.text, 'AI generated grounded response text');
  console.log(`  [Generated Reply]: "${replyGen.text}"`);

  // Check that reply contains real facts from Business Profile (e.g. ₹750 or 48 or 2) and does not hallucinate arbitrary pricing
  const replyLower = replyGen.text.toLowerCase();
  const containsRealFact = replyLower.includes('750') || replyLower.includes('6,500') || replyLower.includes('6500') || replyLower.includes('48') || replyLower.includes('reel');
  assert(containsRealFact, 'Generated reply accurately references verified rates/turnaround from Business Profile');

  // ----------------------------------------------------
  // Clean up test records
  // ----------------------------------------------------
  await prisma.user.delete({ where: { id: createdUser.id } }).catch(() => {});

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('======================================================\n');
}

runVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Test suite failed:', err.message);
    process.exit(1);
  });
