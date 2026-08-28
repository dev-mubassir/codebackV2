/**
 * Socket.io Tenant Isolation & Real-Time Security Verification Script
 *
 * Verifies:
 * 1. Unauthenticated socket connection (no session cookie) is strictly rejected & disconnected.
 * 2. Authenticated socket for User A automatically joins room `user:${userA.id}`.
 * 3. Authenticated socket for User B automatically joins room `user:${userB.id}`.
 * 4. User B cannot eavesdrop or join User A's room by emitting `join` with `userA.id`.
 * 5. Real-time events emitted to User A (via emitToUser) are received by User A and NEVER by User B.
 * 6. Disconnected account webhooks are skipped with WebhookLog event 'skipped_disconnected'.
 * 7. Account re-linking with existing BrandDeal history under a different owner is blocked (409 / conflict).
 *
 * Run with: node scripts/test-socket-isolation.js
 */

const { spawn } = require('child_process');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../src/lib/crypto');

// Resolve socket.io-client from frontend if not in backend node_modules
let ioClient;
try {
  ioClient = require('socket.io-client');
} catch (e) {
  ioClient = require(path.resolve(__dirname, '../../frontend/node_modules/socket.io-client'));
}

const prisma = new PrismaClient();

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

async function httpJson(method, urlPath, body, session = {}, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (session.cookies) {
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

  if (res.headers['set-cookie']) {
    const cookieParts = res.headers['set-cookie'].map((c) => c.split(';')[0]);
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
    } catch (e) {}
    await sleep(500);
  }
  return false;
}

async function seedData() {
  const passwordHash = await bcrypt.hash('Secret123!', 10);

  // User A
  const userA = await prisma.user.upsert({
    where: { email: 'socket-iso-a@test.codeback' },
    update: { passwordHash },
    create: {
      email: 'socket-iso-a@test.codeback',
      name: 'Socket User A',
      passwordHash,
      role: 'USER',
    },
  });

  const accountA = await prisma.instagramAccount.upsert({
    where: { igUserId: 'socket-ig-acc-a' },
    update: { userId: userA.id, connectionStatus: 'CONNECTED', disconnectedAt: null },
    create: {
      userId: userA.id,
      igUserId: 'socket-ig-acc-a',
      igUsername: 'socket_creator_a',
      accessToken: encrypt('token-socket-a'),
    },
  });

  // User B
  const userB = await prisma.user.upsert({
    where: { email: 'socket-iso-b@test.codeback' },
    update: { passwordHash },
    create: {
      email: 'socket-iso-b@test.codeback',
      name: 'Socket User B',
      passwordHash,
      role: 'USER',
    },
  });

  const accountB = await prisma.instagramAccount.upsert({
    where: { igUserId: 'socket-ig-acc-b' },
    update: { userId: userB.id, connectionStatus: 'CONNECTED', disconnectedAt: null },
    create: {
      userId: userB.id,
      igUserId: 'socket-ig-acc-b',
      igUsername: 'socket_creator_b',
      accessToken: encrypt('token-socket-b'),
    },
  });

  return { userA, accountA, userB, accountB };
}

function createSocketClient(cookies) {
  return ioClient(BASE_URL, {
    extraHeaders: cookies ? { Cookie: cookies } : {},
    rejectUnauthorized: false,
    transports: ['polling', 'websocket'],
    reconnection: false,
    timeout: 5000,
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('  Socket.io Isolation & Security Regression Test');
  console.log('='.repeat(60));
  console.log(`\nUsing ${useHttps ? 'HTTPS' : 'HTTP'} — Base URL: ${BASE_URL}`);

  // Free port 5000 if lingering from previous test run
  try {
    if (process.platform === 'win32') {
      const netstat = require('child_process').execSync('netstat -ano -p tcp | findstr :5000', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const pids = new Set(netstat.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((p) => p && p !== '0' && !isNaN(p)));
      for (const p of pids) {
        try { require('child_process').execSync(`taskkill /pid ${p} /T /F`, { stdio: 'ignore' }); } catch (e) {}
      }
      await sleep(500);
    }
  } catch (e) {}

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

  const { userA, accountA, userB, accountB } = await seedData();

  // Log in as User A and User B via standard login to acquire real session cookies
  const sessionA = {};
  const loginResA = await httpJson('POST', '/auth/login', { email: userA.email, password: 'Secret123!' }, sessionA);
  check('User A login sets session cookie', loginResA.status === 200 && sessionA.cookies.includes('codeback.sid'));

  const sessionB = {};
  const loginResB = await httpJson('POST', '/auth/login', { email: userB.email, password: 'Secret123!' }, sessionB);
  check('User B login sets session cookie', loginResB.status === 200 && sessionB.cookies.includes('codeback.sid'));

  // ===============================
  // TEST GROUP 1: Unauthenticated Socket Rejection
  // ===============================
  console.log('\n--- TEST GROUP 1: Unauthenticated Socket Connection ---\n');

  const unauthSocket = createSocketClient(null);
  let unauthDisconnected = false;
  let unauthReceivedEvent = false;

  unauthSocket.on('connect_error', () => {
    unauthDisconnected = true;
  });
  unauthSocket.on('disconnect', () => {
    unauthDisconnected = true;
  });
  unauthSocket.on('new_message', () => {
    unauthReceivedEvent = true;
  });

  // Attempt to emit join with User A's id
  unauthSocket.emit('join', { userId: userA.id });
  await sleep(1000);

  check('Unauthenticated socket is rejected/disconnected', unauthDisconnected || !unauthSocket.connected);
  check('Unauthenticated socket receives zero events', !unauthReceivedEvent);

  unauthSocket.close();

  // ===============================
  // TEST GROUP 2: Authenticated Sockets & Auto-Room Join
  // ===============================
  console.log('\n--- TEST GROUP 2: Authenticated Socket Room Isolation ---\n');

  const socketA = createSocketClient(sessionA.cookies);
  const socketB = createSocketClient(sessionB.cookies);

  await Promise.all([
    new Promise((resolve) => socketA.on('connect', resolve)),
    new Promise((resolve) => socketB.on('connect', resolve)),
  ]);

  check('Socket A connected successfully with User A session', socketA.connected);
  check('Socket B connected successfully with User B session', socketB.connected);

  // User B attempts to maliciously join User A's room
  socketB.emit('join', { userId: userA.id });
  await sleep(500);

  // Set up event listeners
  const eventsForA = [];
  const eventsForB = [];

  socketA.on('new_message', (msg) => eventsForA.push(msg));
  socketB.on('new_message', (msg) => eventsForB.push(msg));

  // Trigger a webhook/message for User A's account
  const webhookPayloadA = {
    object: 'instagram',
    entry: [
      {
        id: accountA.igUserId,
        time: Date.now(),
        messaging: [
          {
            sender: { id: 'test-sender-101' },
            recipient: { id: accountA.igUserId },
            timestamp: Date.now(),
            message: { mid: `msg-${Date.now()}-A`, text: 'Confidential message for User A only' },
          },
        ],
      },
    ],
  };

  const webhookRes = await axios({
    method: 'POST',
    url: `${BASE_URL}/webhooks/instagram`,
    data: webhookPayloadA,
    headers: { 'Content-Type': 'application/json' },
    httpsAgent: useHttps ? agent : undefined,
    httpAgent: !useHttps ? agent : undefined,
    validateStatus: () => true,
  });

  check('Webhook POST for User A returns 200', webhookRes.status === 200);

  // Wait for real-time socket delivery
  await sleep(1000);

  check('User A socket received the real-time message event', eventsForA.length >= 1 && eventsForA[0].message?.content === 'Confidential message for User A only');
  check('User B socket NEVER received User A private message (0 events leaked)', eventsForB.length === 0, { eventsForBCount: eventsForB.length });

  socketA.close();
  socketB.close();

  // ===============================
  // TEST GROUP 3: Disconnected Account Webhook Skipping (FIX 2)
  // ===============================
  console.log('\n--- TEST GROUP 3: Disconnected Account Webhook Skipping ---\n');

  // Disconnect User A's account
  await prisma.instagramAccount.update({
    where: { id: accountA.id },
    data: { connectionStatus: 'DISCONNECTED', disconnectedAt: new Date() },
  });

  const discPayload = {
    object: 'instagram',
    entry: [
      {
        id: accountA.igUserId,
        time: Date.now(),
        messaging: [
          {
            sender: { id: 'test-sender-102' },
            recipient: { id: accountA.igUserId },
            timestamp: Date.now(),
            message: { mid: `msg-${Date.now()}-disc`, text: 'Message to disconnected account' },
          },
        ],
      },
    ],
  };

  const discRes = await axios({
    method: 'POST',
    url: `${BASE_URL}/webhooks/instagram`,
    data: discPayload,
    headers: { 'Content-Type': 'application/json' },
    httpsAgent: useHttps ? agent : undefined,
    httpAgent: !useHttps ? agent : undefined,
    validateStatus: () => true,
  });

  check('Webhook POST for disconnected account responds 200', discRes.status === 200);
  await sleep(500);

  const skippedLog = await prisma.webhookLog.findFirst({
    where: { igUserId: accountA.igUserId, eventType: 'skipped_disconnected' },
    orderBy: { createdAt: 'desc' },
  });

  check('Webhook event for disconnected account logged as skipped_disconnected', Boolean(skippedLog));

  // ===============================
  // TEST GROUP 4: BrandDeal Account Re-Linking Protection (FIX 3)
  // ===============================
  console.log('\n--- TEST GROUP 4: BrandDeal Account Re-Linking Protection ---\n');

  // Step 1: User A owns accountA with an existing BrandDeal row
  await prisma.instagramAccount.update({
    where: { id: accountA.id },
    data: { userId: userA.id, connectionStatus: 'CONNECTED' },
  });

  const contactA = await prisma.contact.findFirst({ where: { instagramAccountId: accountA.id } });
  const convA = await prisma.conversation.findFirst({ where: { instagramAccountId: accountA.id } });

  if (convA) {
    await prisma.brandDeal.deleteMany({ where: { instagramAccountId: accountA.id } });
    await prisma.brandDeal.create({
      data: {
        conversationId: convA.id,
        instagramAccountId: accountA.id,
        userId: userA.id,
        brandName: 'Nike Sponsorship Deal',
        status: 'new',
      },
    });
  }

  // Step 2 & 3: User B attempts to re-link accountA via real OAuth callback with Accept: application/json
  const relinkConflictRes = await httpJson(
    'GET',
    `/auth/instagram/callback?code=test_code_${accountA.igUserId}`,
    null,
    sessionB,
    { Accept: 'application/json' }
  );

  check('Conflict re-link attempt responds with 409 status', relinkConflictRes.status === 409, relinkConflictRes.status);
  check(
    '409 response includes expected error details',
    relinkConflictRes.data?.error === 'Account re-link conflict' &&
      relinkConflictRes.data?.message?.includes('existing brand deal history'),
    relinkConflictRes.data
  );

  // Step 4: Assert instagramAccount.userId in DB is STILL User A (transfer blocked)
  const accountCheckAfterBlock = await prisma.instagramAccount.findUnique({
    where: { id: accountA.id },
  });
  check('Instagram account ownership remained with User A (transfer blocked)', accountCheckAfterBlock.userId === userA.id);

  // Step 5: Negative case — User A owns a clean account with NO BrandDeal history
  const cleanAccount = await prisma.instagramAccount.upsert({
    where: { igUserId: 'socket-clean-relink-acc' },
    update: { userId: userA.id, connectionStatus: 'CONNECTED' },
    create: {
      userId: userA.id,
      igUserId: 'socket-clean-relink-acc',
      igUsername: 'socket_clean_creator',
      accessToken: encrypt('token-clean-relink'),
    },
  });

  // Ensure no BrandDeal exists for this clean account
  await prisma.brandDeal.deleteMany({ where: { instagramAccountId: cleanAccount.id } });

  // User B attempts to re-link this clean account
  const cleanRelinkRes = await httpJson(
    'GET',
    `/auth/instagram/callback?code=test_code_${cleanAccount.igUserId}`,
    null,
    sessionB,
    { Accept: 'application/json' }
  );

  check('Clean re-link attempt succeeds (302 redirect or 200)', cleanRelinkRes.status === 302 || cleanRelinkRes.status === 200, cleanRelinkRes.status);

  const cleanAccountCheck = await prisma.instagramAccount.findUnique({
    where: { igUserId: 'socket-clean-relink-acc' },
  });
  check('Clean account ownership successfully transferred to User B', cleanAccountCheck.userId === userB.id);

  // ===============================
  // TEST GROUP 5: Force-Disconnect Sockets on Logout
  // ===============================
  console.log('\n--- TEST GROUP 5: Force-Disconnect Sockets on Logout ---\n');

  // Connect active socket for User B
  const activeSocketB = createSocketClient(sessionB.cookies);
  await new Promise((resolve) => activeSocketB.on('connect', resolve));
  check('User B socket connected before logout', activeSocketB.connected);

  let socketBDisconnectedOnLogout = false;
  activeSocketB.on('disconnect', () => {
    socketBDisconnectedOnLogout = true;
  });

  // Call POST /auth/logout for User B
  const logoutRes = await httpJson('POST', '/auth/logout', null, sessionB);
  check('User B logout succeeds with 200', logoutRes.status === 200);

  await sleep(500);
  check('Active socket for User B was force-disconnected upon logout', socketBDisconnectedOnLogout || !activeSocketB.connected);
  activeSocketB.close();

  // ===============================
  // TEST GROUP 6: Production Signature Verification Security Gate
  // ===============================
  console.log('\n--- TEST GROUP 6: Production Signature Security Gate ---\n');

  // Test 6.1: Startup fatal refusal if SKIP_SIGNATURE_VERIFICATION=true in production
  const prodMisconfiguredServer = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SKIP_SIGNATURE_VERIFICATION: 'true',
      PORT: '5099',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let prodStderr = '';
  prodMisconfiguredServer.stderr.on('data', (d) => {
    prodStderr += d.toString();
  });

  const exitCode = await new Promise((resolve) => {
    prodMisconfiguredServer.on('exit', (code) => resolve(code));
  });

  check('Server refuses to start when SKIP_SIGNATURE_VERIFICATION=true in production', exitCode === 1);
  check(
    'Server startup logs fatal security error message',
    prodStderr.includes('FATAL SECURITY MISCONFIGURATION: SKIP_SIGNATURE_VERIFICATION=true is strictly forbidden in production mode')
  );

  // ===============================
  // SUMMARY
  // ===============================
  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${passCount} passed, ${failCount} failed out of ${passCount + failCount}`);
  console.log('='.repeat(60) + '\n');

  try {
    if (server.pid) {
      require('child_process').execSync(`taskkill /pid ${server.pid} /T /F 2>nul`, { stdio: 'ignore' });
    }
  } catch (e) {
    server.kill();
  }
  await prisma.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
