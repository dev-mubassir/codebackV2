/**
 * One-off end-to-end manual test script (not part of the app).
 *
 * Spawns the real server as a child process, seeds two tenants, simulates
 * Instagram webhook deliveries (brand deal, spam, duplicate, echo, and a
 * second tenant's message), waits for async AI processing, then verifies
 * persistence, deduplication, tenant isolation, AI-failure resilience, the
 * new product routes (AI analysis, reply generation, brand deals,
 * notifications, settings, subscription/usage), soft-disconnect data
 * retention, and the admin panel's previously-broken token routes.
 *
 * Safe to delete after manual verification. Run with: node scripts/e2e-test.js
 */
const { spawn } = require('child_process');
const path = require('path');
const https = require('https');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../src/lib/crypto');

const prisma = new PrismaClient();
const BASE_URL = 'https://localhost:5000';
const agent = new https.Agent({ rejectUnauthorized: false });

let passCount = 0;
let failCount = 0;
function check(label, condition, extra) {
  if (condition) {
    passCount++;
    console.log(`  PASS - ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL - ${label}${extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpJson(method, urlPath, body, headers) {
  const res = await axios({
    method,
    url: BASE_URL + urlPath,
    data: body,
    httpsAgent: agent,
    validateStatus: () => true,
    headers,
  });
  return { status: res.status, data: res.data, cookies: res.headers['set-cookie'] };
}

async function waitForServerReady(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { status } = await httpJson('GET', '/health');
      if (status === 200) return true;
    } catch (e) {
      // not ready yet
    }
    await sleep(500);
  }
  return false;
}

async function seedTenants() {
  const userA = await prisma.user.upsert({
    where: { email: 'creator-a@test.codeback' },
    update: {},
    create: { email: 'creator-a@test.codeback', name: 'Creator A', role: 'USER' },
  });
  const accountA = await prisma.instagramAccount.upsert({
    where: { igUserId: 'test-ig-account-a' },
    update: { userId: userA.id, connectionStatus: 'CONNECTED', disconnectedAt: null },
    create: {
      userId: userA.id,
      igUserId: 'test-ig-account-a',
      igUsername: 'creator_a_ig',
      igName: 'Creator A',
      accessToken: encrypt('fake-token-for-testing'),
    },
  });

  const userB = await prisma.user.upsert({
    where: { email: 'creator-b@test.codeback' },
    update: {},
    create: { email: 'creator-b@test.codeback', name: 'Creator B', role: 'USER' },
  });
  const accountB = await prisma.instagramAccount.upsert({
    where: { igUserId: 'test-ig-account-b' },
    update: { userId: userB.id, connectionStatus: 'CONNECTED', disconnectedAt: null },
    create: {
      userId: userB.id,
      igUserId: 'test-ig-account-b',
      igUsername: 'creator_b_ig',
      igName: 'Creator B',
      accessToken: encrypt('fake-token-for-testing-b'),
    },
  });

  // Clean slate for repeatable test runs.
  await prisma.message.deleteMany({ where: { conversation: { instagramAccountId: { in: [accountA.id, accountB.id] } } } });
  await prisma.aIAnalysis.deleteMany({ where: { conversation: { instagramAccountId: { in: [accountA.id, accountB.id] } } } });
  await prisma.brandDeal.deleteMany({ where: { instagramAccountId: { in: [accountA.id, accountB.id] } } });
  await prisma.conversation.deleteMany({ where: { instagramAccountId: { in: [accountA.id, accountB.id] } } });
  await prisma.usageEvent.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
  await prisma.creatorPreference.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });

  return { userA, accountA, userB, accountB };
}

function webhookPayload(igUserId, senderId, mid, text, timestamp, extra = {}) {
  return {
    object: 'instagram',
    entry: [
      {
        id: igUserId,
        time: timestamp,
        messaging: [
          {
            sender: { id: senderId },
            recipient: { id: igUserId },
            timestamp,
            message: { mid, text, ...extra },
          },
        ],
      },
    ],
  };
}

async function main() {
  console.log('Starting backend server...');
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  const ready = await waitForServerReady();
  if (!ready) {
    console.error('Server did not become ready in time.');
    server.kill();
    process.exit(1);
  }
  console.log('Server ready.\n');

  const { userA, accountA, userB, accountB } = await seedTenants();

  console.log('--- Sending simulated webhook events ---');

  let r = await httpJson('POST', '/webhooks/instagram', webhookPayload(
    accountA.igUserId, 'fan-user-123', 'mid.brand.001',
    'Hi! I run marketing for a shoe brand and want to discuss a paid collaboration with a $500 budget for one reel.',
    1700000000000
  ));
  check('Webhook accepted (brand message)', r.status === 200);

  r = await httpJson('POST', '/webhooks/instagram', webhookPayload(
    accountA.igUserId, 'fan-user-456', 'mid.spam.001',
    'Buy followers fast, DM @ for a crypto investment opportunity!!',
    1700000001000
  ));
  check('Webhook accepted (spam message)', r.status === 200);

  r = await httpJson('POST', '/webhooks/instagram', webhookPayload(
    accountA.igUserId, 'fan-user-123', 'mid.brand.001',
    'Hi! I run marketing for a shoe brand and want to discuss a paid collaboration with a $500 budget for one reel.',
    1700000000000
  ));
  check('Duplicate webhook accepted (200, but should not double-insert)', r.status === 200);

  r = await httpJson('POST', '/webhooks/instagram', webhookPayload(
    accountA.igUserId, accountA.igUserId, 'mid.echo.001',
    'Thanks for reaching out!', 1700000002000, { is_echo: true }
  ));
  check('Echo webhook accepted (200, but should not create a message)', r.status === 200);

  r = await httpJson('POST', '/webhooks/instagram', webhookPayload(
    accountB.igUserId, 'fan-user-789', 'mid.fan.001',
    'OMG I love your videos so much, you are amazing!!', 1700000003000
  ));
  check('Webhook accepted (tenant B message)', r.status === 200);

  console.log('\nWaiting for async AI processing...');
  await sleep(4000);

  console.log('\n--- Verifying persistence & dedup at the database layer ---');
  const accountAMessages = await prisma.message.findMany({
    where: { conversation: { instagramAccountId: accountA.id } },
    orderBy: { createdAt: 'asc' },
  });
  check('Exactly 2 messages persisted for account A (brand + spam, dup/echo excluded)', accountAMessages.length === 2, accountAMessages.map((m) => m.igMessageId));

  const brandMsg = accountAMessages.find((m) => m.igMessageId === 'mid.brand.001');
  const spamMsg = accountAMessages.find((m) => m.igMessageId === 'mid.spam.001');
  check('Brand message persisted with original text intact', brandMsg && brandMsg.content.includes('paid collaboration'));
  check('Brand message aiStatus is completed or failed (never stuck pending)', brandMsg && ['completed', 'failed'].includes(brandMsg.aiStatus), brandMsg && brandMsg.aiStatus);
  check('Spam message classified as spam via free keyword engine (no AI key needed)', spamMsg && spamMsg.category === 'spam', spamMsg && spamMsg.category);

  const conversationA = await prisma.conversation.findFirst({ where: { instagramAccountId: accountA.id, contact: { igsid: 'fan-user-123' } } });
  check('Conversation A category set (from AI pipeline, degrades to "other" without an API key)', Boolean(conversationA?.category), conversationA?.category);

  const accountBMessages = await prisma.message.findMany({ where: { conversation: { instagramAccountId: accountB.id } } });
  check('Exactly 1 message persisted for account B', accountBMessages.length === 1);

  console.log('\n--- Verifying tenant isolation at the REST API layer ---');
  const convsA = await httpJson('GET', `/api/conversations?user_id=${userA.id}`);
  const convsB = await httpJson('GET', `/api/conversations?user_id=${userB.id}`);
  check('User A sees exactly their own conversation(s) for account A', convsA.data.every((c) => c.instagramAccountId === accountA.id) && convsA.data.length >= 1, convsA.data.map((c) => c.instagramAccountId));
  check('User B sees exactly their own conversation(s) for account B', convsB.data.every((c) => c.instagramAccountId === accountB.id) && convsB.data.length >= 1, convsB.data.map((c) => c.instagramAccountId));
  check("User A cannot see User B's conversation", !convsA.data.some((c) => c.instagramAccountId === accountB.id));
  check("User B cannot see User A's conversation", !convsB.data.some((c) => c.instagramAccountId === accountA.id));

  const dashA = await httpJson('GET', `/api/dashboard/summary?user_id=${userA.id}`);
  check('Dashboard summary works for user A', dashA.status === 200 && typeof dashA.data.totalDmsReviewed === 'number', dashA.data);

  console.log('\n--- Verifying persistence survives "logout" (no session) ---');
  const messagesAfter = await httpJson('GET', `/api/conversations/${conversationA.id}/messages?user_id=${userA.id}`);
  check('All messages still visible after simulated logout/relogin', messagesAfter.status === 200 && messagesAfter.data.messages.length === 1, messagesAfter.data.messages?.length);

  console.log('\n--- Verifying new AI/product routes ---');
  const analysis = await httpJson('GET', `/api/conversations/${conversationA.id}/ai-analysis?user_id=${userA.id}`);
  check('AI analysis endpoint returns latestAnalysis', analysis.status === 200 && analysis.data.latestAnalysis !== undefined, analysis.data);

  const genReply = await httpJson('POST', `/api/conversations/${conversationA.id}/generate-reply?user_id=${userA.id}`, {});
  check(
    'Generate-reply degrades gracefully without an API key (502, not a crash) — AI never sends automatically',
    genReply.status === 502,
    genReply
  );

  const brandDealsList = await httpJson('GET', `/api/brand-deals?user_id=${userA.id}`);
  check('Brand deals list endpoint works (tenant-scoped)', brandDealsList.status === 200 && Array.isArray(brandDealsList.data));

  const notifs = await httpJson('GET', `/api/notifications?user_id=${userA.id}`);
  check('Notifications endpoint works', notifs.status === 200 && Array.isArray(notifs.data.notifications));

  const aiSettingsGet = await httpJson('GET', `/api/settings/ai?user_id=${userA.id}`);
  check('AI settings GET auto-creates defaults', aiSettingsGet.status === 200 && aiSettingsGet.data.tone === 'friendly', aiSettingsGet.data);

  const aiSettingsPut = await httpJson('PUT', `/api/settings/ai?user_id=${userA.id}`, { tone: 'professional', brandDealsPriority: 'critical' });
  check('AI settings PUT persists changes', aiSettingsPut.status === 200 && aiSettingsPut.data.tone === 'professional' && aiSettingsPut.data.brandDealsPriority === 'critical', aiSettingsPut.data);

  const subscription = await httpJson('GET', `/api/subscription?user_id=${userA.id}`);
  check('Subscription endpoint auto-creates a trial', subscription.status === 200 && subscription.data.status === 'trial', subscription.data);

  const usage = await httpJson('GET', `/api/usage?user_id=${userA.id}`);
  check('Usage endpoint reports messages_received', usage.status === 200 && usage.data.allTime.messages_received >= 1, usage.data);

  console.log('\n--- Verifying soft-disconnect preserves history (spec: never lose data on disconnect) ---');
  const disconnectRes = await httpJson('DELETE', `/api/accounts/${accountA.id}?user_id=${userA.id}`);
  check('Disconnect (soft) succeeds', disconnectRes.status === 200, disconnectRes.data);

  const accountAfterDisconnect = await prisma.instagramAccount.findUnique({ where: { id: accountA.id } });
  check('Account marked DISCONNECTED (not deleted)', accountAfterDisconnect.connectionStatus === 'DISCONNECTED');

  const messagesStillThere = await prisma.message.count({ where: { conversation: { instagramAccountId: accountA.id } } });
  check('Historical messages still present after disconnect', messagesStillThere === 2, messagesStillThere);

  const conversationsStillThere = await prisma.conversation.count({ where: { instagramAccountId: accountA.id } });
  check('Historical conversations still present after disconnect', conversationsStillThere >= 1, conversationsStillThere);

  console.log('\n--- Verifying admin panel (previously-broken token routes) ---');
  const adminLogin = await httpJson('POST', '/api/admin/login', { username: 'Mubassir', password: 'Mubassir' });
  const adminCookie = (adminLogin.cookies || []).map((c) => c.split(';')[0]).join('; ');
  check('Admin login succeeds', adminLogin.status === 200 && adminLogin.data.success === true);

  const adminStats = await httpJson('GET', '/api/admin/stats', undefined, { Cookie: adminCookie });
  check('Admin stats endpoint works and reports queue mode', adminStats.status === 200 && ['memory', 'redis'].includes(adminStats.data.queueMode), adminStats.data.queueMode);

  const refreshTokenRes = await httpJson('POST', `/api/admin/accounts/${accountB.id}/refresh-token`, {}, { Cookie: adminCookie });
  check(
    'Admin "Refresh Token" no longer crashes with ReferenceError (fails cleanly with 502 due to fake token)',
    refreshTokenRes.status === 502,
    refreshTokenRes.data
  );

  const resubscribeRes = await httpJson('POST', `/api/admin/accounts/${accountB.id}/resubscribe-webhook`, {}, { Cookie: adminCookie });
  check(
    'Admin "Re-Subscribe Webhook" no longer crashes with ReferenceError (fails cleanly with 502 due to fake token)',
    resubscribeRes.status === 502,
    resubscribeRes.data
  );

  console.log(`\n=== RESULT: ${passCount} passed, ${failCount} failed ===`);

  // Leave the dev database clean for repeated runs / handoff.
  await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });

  server.kill();
  await sleep(500);
  process.exit(failCount > 0 ? 1 : 0);
}

main()
  .catch((err) => {
    console.error('Test script crashed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
