/**
 * Session Isolation & Tenant Safety Verification Script
 *
 * Verifies that the 8 bugs identified in the audit are fixed:
 * 1. Admin login doesn't overwrite regular user session
 * 2. Admin logout cleans up properly
 * 3. Unauthenticated requests get 401 (no auto-fallback)
 * 4. /auth/me returns 401 when not authenticated
 * 5. getOwnedAccountIds doesn't return all accounts for users with none
 * 6. GET /api/accounts doesn't return other users' accounts
 * 7. Conversation messages can't be read by another user
 * 8. (Socket.io auth is structural — tested by code review)
 *
 * Run with: node scripts/test-isolation.js
 */
const { spawn } = require('child_process');
const path = require('path');
const https = require('https');
const http = require('http');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../src/lib/crypto');

const prisma = new PrismaClient();

// Auto-detect protocol based on cert availability
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

/**
 * HTTP helper that preserves cookies across calls within a "session".
 * Each session is an object { cookies: '' }.
 */
async function httpJson(method, urlPath, body, session) {
  const headers = {};
  if (session && session.cookies) {
    headers['Cookie'] = session.cookies;
  }
  const res = await axios({
    method,
    url: BASE_URL + urlPath,
    data: body,
    httpsAgent: useHttps ? agent : undefined,
    httpAgent: !useHttps ? agent : undefined,
    validateStatus: () => true,
    headers,
    maxRedirects: 0,
  });

  // Parse set-cookie headers and merge into session
  if (session && res.headers['set-cookie']) {
    const cookieParts = res.headers['set-cookie'].map(c => c.split(';')[0]);
    session.cookies = cookieParts.join('; ');
  }

  return { status: res.status, data: res.data, headers: res.headers };
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
    } catch (e) {
      // not ready yet
    }
    await sleep(500);
  }
  return false;
}

async function seedTestData() {
  const userA = await prisma.user.upsert({
    where: { email: 'isolation-test-a@test.codeback' },
    update: {},
    create: { email: 'isolation-test-a@test.codeback', name: 'Isolation User A', role: 'USER' },
  });
  const accountA = await prisma.instagramAccount.upsert({
    where: { igUserId: 'iso-ig-account-a' },
    update: { userId: userA.id, connectionStatus: 'CONNECTED', disconnectedAt: null },
    create: {
      userId: userA.id,
      igUserId: 'iso-ig-account-a',
      igUsername: 'iso_creator_a',
      igName: 'Isolation Creator A',
      accessToken: encrypt('fake-token-iso-a'),
    },
  });

  const userB = await prisma.user.upsert({
    where: { email: 'isolation-test-b@test.codeback' },
    update: {},
    create: { email: 'isolation-test-b@test.codeback', name: 'Isolation User B', role: 'USER' },
  });
  const accountB = await prisma.instagramAccount.upsert({
    where: { igUserId: 'iso-ig-account-b' },
    update: { userId: userB.id, connectionStatus: 'CONNECTED', disconnectedAt: null },
    create: {
      userId: userB.id,
      igUserId: 'iso-ig-account-b',
      igUsername: 'iso_creator_b',
      igName: 'Isolation Creator B',
      accessToken: encrypt('fake-token-iso-b'),
    },
  });

  // Create a conversation + message for User A
  const contactA = await prisma.contact.upsert({
    where: { instagramAccountId_igsid: { instagramAccountId: accountA.id, igsid: 'iso-fan-001' } },
    update: {},
    create: {
      instagramAccountId: accountA.id,
      igsid: 'iso-fan-001',
      username: 'fan_of_a',
      name: 'Fan of A',
    },
  });

  const convA = await prisma.conversation.upsert({
    where: { instagramAccountId_contactId: { instagramAccountId: accountA.id, contactId: contactA.id } },
    update: {},
    create: {
      instagramAccountId: accountA.id,
      contactId: contactA.id,
      lastMessage: 'Secret message for A only',
      lastMessageAt: new Date(),
    },
  });

  await prisma.message.deleteMany({ where: { conversationId: convA.id } });
  await prisma.message.create({
    data: {
      conversationId: convA.id,
      direction: 'inbound',
      content: 'This is a private DM meant only for User A',
      messageType: 'text',
      igTimestamp: new Date(),
    },
  });

  // Create a conversation + message for User B
  const contactB = await prisma.contact.upsert({
    where: { instagramAccountId_igsid: { instagramAccountId: accountB.id, igsid: 'iso-fan-002' } },
    update: {},
    create: {
      instagramAccountId: accountB.id,
      igsid: 'iso-fan-002',
      username: 'fan_of_b',
      name: 'Fan of B',
    },
  });

  const convB = await prisma.conversation.upsert({
    where: { instagramAccountId_contactId: { instagramAccountId: accountB.id, contactId: contactB.id } },
    update: {},
    create: {
      instagramAccountId: accountB.id,
      contactId: contactB.id,
      lastMessage: 'Secret message for B only',
      lastMessageAt: new Date(),
    },
  });

  await prisma.message.deleteMany({ where: { conversationId: convB.id } });
  await prisma.message.create({
    data: {
      conversationId: convB.id,
      direction: 'inbound',
      content: 'This is a private DM meant only for User B',
      messageType: 'text',
      igTimestamp: new Date(),
    },
  });

  return { userA, accountA, convA, userB, accountB, convB };
}

async function main() {
  console.log('='.repeat(60));
  console.log('  Session Isolation & Tenant Safety Verification');
  console.log('='.repeat(60));
  console.log(`\nUsing ${useHttps ? 'HTTPS' : 'HTTP'} — Base URL: ${BASE_URL}`);
  console.log('Starting backend server...');

  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
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

  const { userA, accountA, convA, userB, accountB, convB } = await seedTestData();

  // ===============================
  // TEST GROUP 1: Auth Boundary
  // ===============================
  console.log('\n--- TEST GROUP 1: Auth Boundary (no auto-fallback) ---\n');

  const noSession = {};

  let r = await httpJson('GET', '/auth/me', null, noSession);
  check('GET /auth/me without session returns 401', r.status === 401, r.status);

  r = await httpJson('GET', '/api/conversations', null, noSession);
  check('GET /api/conversations without session returns 401', r.status === 401, r.status);

  r = await httpJson('GET', '/api/accounts', null, noSession);
  check('GET /api/accounts without session returns 401', r.status === 401, r.status);

  r = await httpJson('GET', '/api/dashboard/summary', null, noSession);
  check('GET /api/dashboard/summary without session returns 401', r.status === 401, r.status);

  r = await httpJson('GET', '/api/notifications', null, noSession);
  check('GET /api/notifications without session returns 401', r.status === 401, r.status);

  // ===============================
  // TEST GROUP 2: Admin/User Session Isolation
  // ===============================
  console.log('\n--- TEST GROUP 2: Admin/User Session Isolation ---\n');

  const adminSession = {};
  r = await httpJson('POST', '/api/admin/login', {
    username: process.env.ADMIN_USERNAME || 'Mubassir',
    password: process.env.ADMIN_PASSWORD || 'Mubassir',
  }, adminSession);
  check('Admin login succeeds', r.status === 200 && r.data?.success === true, r.data);

  // BUG 1: After admin login, /auth/me should NOT work (no userId set)
  r = await httpJson('GET', '/auth/me', null, adminSession);
  check('Admin session does NOT authenticate as regular user on /auth/me', r.status === 401, { status: r.status, data: r.data });

  // Admin endpoints should still work
  r = await httpJson('GET', '/api/admin/me', null, adminSession);
  check('Admin /api/admin/me still works', r.status === 200 && r.data?.isAdmin === true, r.data);

  r = await httpJson('GET', '/api/admin/stats', null, adminSession);
  check('Admin /api/admin/stats still works', r.status === 200, r.status);

  // User A session via dev escape hatch
  const userASession = {};
  r = await httpJson('GET', `/auth/me?user_id=${userA.id}`, null, userASession);
  check('User A auth via ?user_id= dev escape hatch', r.status === 200 && r.data?.id === userA.id, r.data?.id);

  // BUG 2: Admin logout cleanup
  r = await httpJson('POST', '/api/admin/logout', null, adminSession);
  check('Admin logout succeeds', r.status === 200 && r.data?.success === true, r.data);

  r = await httpJson('GET', '/api/admin/me', null, adminSession);
  check('After admin logout, not authenticated', r.data?.authenticated === false, r.data);

  // ===============================
  // TEST GROUP 3: Tenant Data Isolation
  // ===============================
  console.log('\n--- TEST GROUP 3: Tenant Data Isolation ---\n');

  const sessionA = {};
  r = await httpJson('GET', `/api/accounts?user_id=${userA.id}`, null, sessionA);
  check('User A accounts endpoint returns 200', r.status === 200, r.status);
  if (r.status === 200 && Array.isArray(r.data)) {
    const containsBAccount = r.data.some(a => a.igUserId === 'iso-ig-account-b');
    check('User A does NOT see User B accounts', !containsBAccount, r.data.map(a => a.igUsername));
  }

  r = await httpJson('GET', `/api/conversations?user_id=${userA.id}`, null, sessionA);
  check('User A conversations endpoint returns 200', r.status === 200, r.status);
  if (r.status === 200 && Array.isArray(r.data)) {
    const containsBConv = r.data.some(c => c.id === convB.id);
    check('User A does NOT see User B conversations', !containsBConv);
  }

  const sessionB = {};
  r = await httpJson('GET', `/api/accounts?user_id=${userB.id}`, null, sessionB);
  check('User B accounts endpoint returns 200', r.status === 200, r.status);
  if (r.status === 200 && Array.isArray(r.data)) {
    const containsAAccount = r.data.some(a => a.igUserId === 'iso-ig-account-a');
    check('User B does NOT see User A accounts', !containsAAccount);
  }

  r = await httpJson('GET', `/api/conversations?user_id=${userB.id}`, null, sessionB);
  check('User B conversations endpoint returns 200', r.status === 200, r.status);
  if (r.status === 200 && Array.isArray(r.data)) {
    const containsAConv = r.data.some(c => c.id === convA.id);
    check('User B does NOT see User A conversations', !containsAConv);
  }

  // ===============================
  // TEST GROUP 4: Conversation Ownership
  // ===============================
  console.log('\n--- TEST GROUP 4: Conversation Ownership Protection ---\n');

  r = await httpJson('GET', `/api/conversations/${convA.id}/messages?user_id=${userB.id}`, null, sessionB);
  check('User B cannot read User A conversation messages (404)', r.status === 404, { status: r.status });

  r = await httpJson('GET', `/api/conversations/${convB.id}/messages?user_id=${userA.id}`, null, sessionA);
  check('User A cannot read User B conversation messages (404)', r.status === 404, { status: r.status });

  r = await httpJson('GET', `/api/conversations/${convA.id}/messages?user_id=${userA.id}`, null, sessionA);
  check('User A CAN read their own conversation messages', r.status === 200, { status: r.status });

  r = await httpJson('GET', `/api/conversations/${convB.id}/messages?user_id=${userB.id}`, null, sessionB);
  check('User B CAN read their own conversation messages', r.status === 200, { status: r.status });

  // ===============================
  // TEST GROUP 5: Other Tenant Routes
  // ===============================
  console.log('\n--- TEST GROUP 5: Other Tenant-Scoped Routes ---\n');

  r = await httpJson('GET', `/api/brand-deals?user_id=${userA.id}`, null, sessionA);
  check('User A brand deals endpoint returns 200', r.status === 200);

  r = await httpJson('GET', `/api/notifications?user_id=${userA.id}`, null, sessionA);
  check('User A notifications endpoint returns 200', r.status === 200);

  r = await httpJson('GET', `/api/settings/ai?user_id=${userA.id}`, null, sessionA);
  check('User A settings endpoint returns 200', r.status === 200);

  r = await httpJson('GET', `/api/subscription?user_id=${userA.id}`, null, sessionA);
  check('User A subscription endpoint returns 200', r.status === 200);

  r = await httpJson('GET', `/api/dashboard/summary?user_id=${userA.id}`, null, sessionA);
  check('User A dashboard summary returns 200', r.status === 200);

  // ===============================
  // RESULTS
  // ===============================
  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${passCount} passed, ${failCount} failed out of ${passCount + failCount}`);
  console.log('='.repeat(60) + '\n');

  server.kill();
  await prisma.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test script error:', err);
  process.exit(1);
});
