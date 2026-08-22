/**
 * Test script for Clear Chat and Delete Conversation features.
 */

const prisma = require('../src/lib/prisma');
const axios = require('axios');

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const certPath = path.join(__dirname, '..', 'certs', 'local.codeback.test.pem');
const useHttps = fs.existsSync(certPath);
const BASE_URL = useHttps ? 'https://localhost:5000' : 'http://localhost:5000';
const agent = useHttps ? new https.Agent({ rejectUnauthorized: false }) : new http.Agent();

const client = axios.create({
  baseURL: BASE_URL,
  httpsAgent: agent,
  httpAgent: agent,
});

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

async function runTests() {
  console.log('\n======================================================');
  console.log('🧹 Testing Clear Chat & Full Chat Delete Functionality');
  console.log('======================================================\n');

  // 1. Setup Test User A and User B
  const userA = await prisma.user.upsert({
    where: { email: 'chat_test_user_a@test.com' },
    update: {},
    create: {
      name: 'User A',
      email: 'chat_test_user_a@test.com',
      passwordHash: 'hash_a',
    },
  });

  const userB = await prisma.user.upsert({
    where: { email: 'chat_test_user_b@test.com' },
    update: {},
    create: {
      name: 'User B',
      email: 'chat_test_user_b@test.com',
      passwordHash: 'hash_b',
    },
  });

  const accountA = await prisma.instagramAccount.upsert({
    where: { igUserId: 'ig_test_user_a_del' },
    update: {},
    create: {
      userId: userA.id,
      igUserId: 'ig_test_user_a_del',
      igUsername: 'account_a_del',
      accessToken: 'dummy',
    },
  });

  const accountB = await prisma.instagramAccount.upsert({
    where: { igUserId: 'ig_test_user_b_del' },
    update: {},
    create: {
      userId: userB.id,
      igUserId: 'ig_test_user_b_del',
      igUsername: 'account_b_del',
      accessToken: 'dummy',
    },
  });

  const contactA = await prisma.contact.upsert({
    where: {
      instagramAccountId_igsid: {
        instagramAccountId: accountA.id,
        igsid: 'igsid_contact_del_1',
      },
    },
    update: {},
    create: {
      instagramAccountId: accountA.id,
      igsid: 'igsid_contact_del_1',
      username: 'client_to_clear',
      name: 'Client To Clear',
    },
  });

  const convA = await prisma.conversation.upsert({
    where: {
      instagramAccountId_contactId: {
        instagramAccountId: accountA.id,
        contactId: contactA.id,
      },
    },
    update: {
      lastMessage: 'Latest message before clearing',
      lastMessageAt: new Date(),
      unread: true,
    },
    create: {
      instagramAccountId: accountA.id,
      contactId: contactA.id,
      lastMessage: 'Latest message before clearing',
      lastMessageAt: new Date(),
      unread: true,
      category: 'product_inquiry',
      priority: 'high',
    },
  });

  // Clean up any old messages for this conversation before starting
  await prisma.message.deleteMany({ where: { conversationId: convA.id } });

  // Create 3 test messages
  await prisma.message.createMany({
    data: [
      { conversationId: convA.id, direction: 'inbound', content: 'Hello there!' },
      { conversationId: convA.id, direction: 'outbound', content: 'Hi! How can I help?' },
      { conversationId: convA.id, direction: 'inbound', content: 'How much for this?' },
    ],
  });

  let messageCountBefore = await prisma.message.count({ where: { conversationId: convA.id } });
  assert(messageCountBefore === 3, 'Created conversation with 3 messages');

  // TEST 1: User B tries to clear User A's chat (Tenant Isolation Check)
  console.log('\n--- TEST 1: Tenant Protection on Clear Chat ---');
  try {
    await client.delete(`/api/conversations/${convA.id}/messages?user_id=${userB.id}`);
    assert(false, 'User B should not be able to clear User A chat');
  } catch (err) {
    assert(err.response?.status === 404, 'User B receives 404 when trying to clear User A chat');
  }

  // TEST 2: User A clears chat messages
  console.log('\n--- TEST 2: User A Clears Chat Messages ---');
  const clearRes = await client.delete(`/api/conversations/${convA.id}/messages?user_id=${userA.id}`);
  assert(clearRes.status === 200, 'DELETE /api/conversations/:id/messages returns 200 OK');
  assert(clearRes.data.deletedCount === 3, 'Returned deleted count is 3');

  const messageCountAfter = await prisma.message.count({ where: { conversationId: convA.id } });
  assert(messageCountAfter === 0, 'Database message count for conversation is now 0');

  const convAfterClear = await prisma.conversation.findUnique({ where: { id: convA.id } });
  assert(convAfterClear !== null, 'Conversation still exists in database');
  assert(convAfterClear.lastMessage === null, 'Conversation lastMessage was reset to null');
  assert(convAfterClear.unread === false, 'Conversation unread status was reset to false');

  // TEST 3: User B tries to delete User A's conversation
  console.log('\n--- TEST 3: Tenant Protection on Full Conversation Delete ---');
  try {
    await client.delete(`/api/conversations/${convA.id}?user_id=${userB.id}`);
    assert(false, 'User B should not be able to delete User A conversation');
  } catch (err) {
    assert(err.response?.status === 404, 'User B receives 404 when trying to delete User A conversation');
  }

  // TEST 4: User A fully deletes the conversation
  console.log('\n--- TEST 4: User A Fully Deletes Conversation ---');
  const deleteRes = await client.delete(`/api/conversations/${convA.id}?user_id=${userA.id}`);
  assert(deleteRes.status === 200, 'DELETE /api/conversations/:id returns 200 OK');

  const convAfterDelete = await prisma.conversation.findUnique({ where: { id: convA.id } });
  assert(convAfterDelete === null, 'Conversation is permanently deleted from database');

  // Clean up
  await prisma.user.deleteMany({
    where: { email: { in: ['chat_test_user_a@test.com', 'chat_test_user_b@test.com'] } },
  }).catch(() => {});

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('======================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  });
