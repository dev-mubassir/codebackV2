require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const https = require('https');
const http = require('http');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../src/lib/crypto');
const { maybeAutoReply } = require('../src/jobs/messageAnalysisJob');
const instagram = require('../src/lib/instagram');

const prisma = new PrismaClient();

const fs = require('fs');
const certPath = path.join(__dirname, '..', 'certs', 'local.codeback.test.pem');
const useHttps = fs.existsSync(certPath);
const BASE_URL = useHttps ? 'https://localhost:5000' : 'http://localhost:5000';
const agent = useHttps ? new https.Agent({ rejectUnauthorized: false }) : new http.Agent();

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpJson(method, urlPath, body, headers = {}) {
  const res = await axios({
    method,
    url: BASE_URL + urlPath,
    data: body,
    httpsAgent: useHttps ? agent : undefined,
    httpAgent: !useHttps ? agent : undefined,
    validateStatus: () => true,
    headers,
  });
  return { status: res.status, data: res.data };
}

async function waitForServerReady(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await axios({
        method: 'GET',
        url: BASE_URL + '/health',
        httpsAgent: useHttps ? agent : undefined,
        httpAgent: !useHttps ? agent : undefined,
        validateStatus: () => true,
      });
      if (res.status === 200) return true;
    } catch (e) {}
    await sleep(500);
  }
  return false;
}

async function main() {
  console.log('='.repeat(60));
  console.log('  Per-Conversation AI Auto-Reply Feature Verification');
  console.log('='.repeat(60) + '\n');

  console.log('Starting backend server...');
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  const ready = await waitForServerReady();
  if (!ready) {
    console.error('Server did not start in time.');
    server.kill();
    process.exit(1);
  }
  console.log('Server ready.\n');

  // 1. Seed user & account
  const user = await prisma.user.upsert({
    where: { email: 'creator-autoreply@test.codeback' },
    update: {},
    create: { email: 'creator-autoreply@test.codeback', name: 'Creator AutoReply', role: 'USER' },
  });

  const account = await prisma.instagramAccount.upsert({
    where: { igUserId: 'autoreply-ig-account' },
    update: { userId: user.id },
    create: {
      userId: user.id,
      igUserId: 'autoreply-ig-account',
      igUsername: 'creator_autoreply_ig',
      igName: 'Creator AutoReply IG',
      accessToken: encrypt('fake-ig-token'),
    },
  });

  // Create Chat 1 (will have auto-reply enabled)
  const contact1 = await prisma.contact.upsert({
    where: { instagramAccountId_igsid: { instagramAccountId: account.id, igsid: 'fan-auto-01' } },
    update: {},
    create: {
      instagramAccountId: account.id,
      igsid: 'fan-auto-01',
      username: 'vip_fan_sarah',
      name: 'Sarah VIP',
    },
  });

  const conv1 = await prisma.conversation.upsert({
    where: { instagramAccountId_contactId: { instagramAccountId: account.id, contactId: contact1.id } },
    update: { autoReplyEnabled: false },
    create: {
      instagramAccountId: account.id,
      contactId: contact1.id,
      lastMessage: 'Hi! What are your rates for sponsored posts?',
      lastMessageAt: new Date(),
      autoReplyEnabled: false,
    },
  });

  // Create Chat 2 (will have auto-reply disabled)
  const contact2 = await prisma.contact.upsert({
    where: { instagramAccountId_igsid: { instagramAccountId: account.id, igsid: 'fan-auto-02' } },
    update: {},
    create: {
      instagramAccountId: account.id,
      igsid: 'fan-auto-02',
      username: 'random_user_99',
      name: 'Random User',
    },
  });

  const conv2 = await prisma.conversation.upsert({
    where: { instagramAccountId_contactId: { instagramAccountId: account.id, contactId: contact2.id } },
    update: { autoReplyEnabled: false },
    create: {
      instagramAccountId: account.id,
      contactId: contact2.id,
      lastMessage: 'Hello there!',
      lastMessageAt: new Date(),
      autoReplyEnabled: false,
    },
  });

  // 2. Test PATCH /api/conversations/:id/auto-reply
  console.log('--- TEST 1: Toggle Auto-Reply for specific conversation ---');
  let r = await httpJson('PATCH', `/api/conversations/${conv1.id}/auto-reply?user_id=${user.id}`, {
    autoReplyEnabled: true,
    autoReplyPrompt: 'Mention media kit link https://example.com/kit and ask for their campaign dates.',
  });

  check('PATCH auto-reply endpoint returns 200', r.status === 200, r.status);
  check('autoReplyEnabled is true for Chat 1', r.data?.autoReplyEnabled === true, r.data);
  check('autoReplyPrompt saved', r.data?.autoReplyPrompt?.includes('media kit link'), r.data?.autoReplyPrompt);

  // 3. Test GET /api/settings/auto-reply-chats
  console.log('\n--- TEST 2: GET /api/settings/auto-reply-chats ---');
  r = await httpJson('GET', `/api/settings/auto-reply-chats?user_id=${user.id}`);
  check('GET auto-reply-chats returns 200', r.status === 200, r.status);
  if (Array.isArray(r.data)) {
    const chat1Data = r.data.find(c => c.id === conv1.id);
    const chat2Data = r.data.find(c => c.id === conv2.id);
    check('Chat 1 listed with autoReplyEnabled: true', chat1Data?.autoReplyEnabled === true, chat1Data);
    check('Chat 2 listed with autoReplyEnabled: false', chat2Data?.autoReplyEnabled === false, chat2Data);
  }

  // 4. Test Auto-Reply Execution via maybeAutoReply
  console.log('\n--- TEST 3: Auto-Reply Execution ---');
  // Seed an inbound message
  await prisma.message.deleteMany({ where: { conversationId: conv1.id } });
  const inMsg = await prisma.message.create({
    data: {
      conversationId: conv1.id,
      direction: 'inbound',
      content: 'Hey! We love your videos and want to book a sponsorship. How much do you charge?',
      messageType: 'text',
      igTimestamp: new Date(),
    },
  });

  // Mock instagram.sendMessage to avoid making real network call to Meta
  const originalSendMessage = instagram.sendMessage;
  let sentMessagePayload = null;
  instagram.sendMessage = async (igsid, text, token) => {
    sentMessagePayload = { igsid, text, token };
    return { recipient_id: igsid, message_id: 'mid.mock.auto_reply.001' };
  };

  // Opt this conversation in directly. TEST 1's PATCH is the HTTP path and is
  // asserted separately; this block exercises maybeAutoReply() in isolation, so
  // it must not depend on that request having succeeded. Previously the seed
  // left autoReplyEnabled=false and the send happened anyway — that was the
  // bug in the old gate (smart mode ignored the per-conversation override), so
  // asserting a send from a `false` conversation was asserting the bug.
  await prisma.conversation.update({
    where: { id: conv1.id },
    data: { autoReplyEnabled: true },
  });

  const refreshedConv1 = await prisma.conversation.findUnique({ where: { id: conv1.id } });
  await maybeAutoReply({
    conversation: refreshedConv1,
    contact: contact1,
    instagramAccount: account,
    userId: user.id,
    preferences: { tone: 'friendly' },
    brandDeal: null,
  });

  check('Auto-reply called Instagram sendMessage API', Boolean(sentMessagePayload), sentMessagePayload);
  check('Auto-reply sent to correct recipient IGSID', sentMessagePayload?.igsid === contact1.igsid);
  check('Auto-reply text generated and sent', typeof sentMessagePayload?.text === 'string' && sentMessagePayload.text.length > 5, sentMessagePayload?.text);

  // Verify outbound message was created in DB
  const outboundMsgs = await prisma.message.findMany({
    where: { conversationId: conv1.id, direction: 'outbound' },
  });
  check('Outbound message saved to database with aiStatus: auto_replied', outboundMsgs.length > 0 && outboundMsgs[0].aiStatus === 'auto_replied', outboundMsgs[0]);

  // --- Regression guard for finding #3: an explicit opt-out must win, even
  // though the tenant's autoReplyMode is still "smart".
  await prisma.conversation.update({
    where: { id: conv1.id },
    data: { autoReplyEnabled: false },
  });
  const optedOutConv = await prisma.conversation.findUnique({ where: { id: conv1.id } });
  sentMessagePayload = null;
  await maybeAutoReply({
    conversation: optedOutConv,
    contact: contact1,
    instagramAccount: account,
    userId: user.id,
    preferences: { tone: 'friendly' },
    brandDeal: null,
  });
  check('Opted-out conversation is NOT auto-replied to under smart mode', sentMessagePayload === null, sentMessagePayload);

  // --- Regression guard for finding #1: suggest_only must never auto-send,
  // even for a conversation explicitly opted in.
  await prisma.conversation.update({
    where: { id: conv1.id },
    data: { autoReplyEnabled: true },
  });
  const optedInConv = await prisma.conversation.findUnique({ where: { id: conv1.id } });
  sentMessagePayload = null;
  await maybeAutoReply({
    conversation: optedInConv,
    contact: contact1,
    instagramAccount: account,
    userId: user.id,
    businessProfile: { autoReplyMode: 'suggest_only' },
    preferences: { tone: 'friendly' },
    brandDeal: null,
  });
  check('suggest_only never auto-sends, even when opted in', sentMessagePayload === null, sentMessagePayload);

  // Restore mock
  instagram.sendMessage = originalSendMessage;

  // 5. Test turning auto-reply back OFF for that chat
  console.log('\n--- TEST 4: Turn Auto-Reply back OFF ---');
  r = await httpJson('PATCH', `/api/conversations/${conv1.id}/auto-reply?user_id=${user.id}`, {
    autoReplyEnabled: false,
  });
  check('Turned OFF auto-reply for Chat 1', r.data?.autoReplyEnabled === false, r.data);

  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${passCount} passed, ${failCount} failed out of ${passCount + failCount}`);
  console.log('='.repeat(60) + '\n');

  server.kill();
  await prisma.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
