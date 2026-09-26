/**
 * End-to-end multi-tenant isolation verification.
 *
 * Provisions two throwaway tenants with generated credentials, logs each in
 * over real HTTPS to obtain genuine session cookies, then attempts every
 * cross-tenant access path as User B against User A's resources.
 *
 * Covers:
 *   1. Unauthenticated access          -> must 401
 *   2. Cross-tenant READ  (GET)        -> must 404 / empty
 *   3. Cross-tenant WRITE (PATCH/POST) -> must 404
 *   4. Cross-tenant DELETE             -> must 404, and A's data must survive
 *   5. Webhook spoofing: a correctly-signed webhook naming A's IG account,
 *      delivered while holding B's session cookie, must land in A's tenant
 *      and never in B's.
 *   6. Socket.io room isolation: B's authenticated socket must not receive
 *      events emitted to A.
 *
 * Creates only data it owns and deletes all of it at the end.
 * Run with the backend already listening on :5000.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../src/lib/crypto');

// socket.io-client is a frontend dependency; resolve it from there.
let ioClient = null;
try {
  ioClient = require(path.join(__dirname, '../../frontend/node_modules/socket.io-client'));
} catch { /* socket section will be skipped and reported */ }

const prisma = new PrismaClient();

const certPath = path.join(__dirname, '..', 'certs', 'local.codeback.test.pem');
const useHttps = fs.existsSync(certPath);
const BASE_URL = useHttps ? 'https://localhost:5000' : 'http://localhost:5000';
const agent = useHttps
  ? new https.Agent({ rejectUnauthorized: false })
  : new http.Agent();

let pass = 0;
let fail = 0;
const failures = [];
function check(label, condition, extra) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else {
    fail++; failures.push(label);
    console.error(`  ❌ ${label}${extra !== undefined ? ` :: ${JSON.stringify(extra)?.slice(0, 200)}` : ''}`);
  }
}

const TAG = `iso${Date.now()}`;
const PASSWORD = 'Test-' + crypto.randomBytes(12).toString('hex');
const createdUserIds = [];

/** Raw request that never throws on 4xx/5xx, so we can assert on status. */
async function req(method, url, { cookie, data, headers = {} } = {}) {
  try {
    const res = await axios({
      method, url: `${BASE_URL}${url}`, data, httpsAgent: agent, httpAgent: agent,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
      validateStatus: () => true, timeout: 15000,
    });
    return { status: res.status, data: res.data, headers: res.headers };
  } catch (e) {
    return { status: 0, data: { error: e.message } };
  }
}

async function login(email) {
  const res = await req('POST', '/auth/login', {
    data: { email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  const raw = res.headers?.['set-cookie'];
  const cookie = Array.isArray(raw) ? raw.map((c) => c.split(';')[0]).join('; ') : null;
  return { status: res.status, cookie, data: res.data };
}

async function provisionTenant(label, igUserId) {
  const user = await prisma.user.create({
    data: {
      // Lowercased: /auth/login normalizes the submitted email before lookup,
      // so a stored address with uppercase would never match.
      email: `${TAG}-${label}@isolation.test`.toLowerCase(),
      name: `Isolation ${label}`,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      onboardingCompleted: true,
      businessProfile: { create: { businessName: `${label} Co`, autoReplyMode: 'human_only' } },
      preferences: { create: {} },
    },
  });
  createdUserIds.push(user.id);

  const account = await prisma.instagramAccount.create({
    data: {
      userId: user.id, igUserId, igUsername: `${label.toLowerCase()}_ig`,
      accessToken: encrypt(`token-for-${label}`),
    },
  });
  const contact = await prisma.contact.create({
    data: { instagramAccountId: account.id, igsid: `igsid-${label}-${Date.now()}`, username: `cust_${label}` },
  });
  const conversation = await prisma.conversation.create({
    data: {
      instagramAccountId: account.id, contactId: contact.id,
      lastMessage: `${label} private message`, lastMessageAt: new Date(),
      category: 'pricing_inquiry', priority: 'high',
    },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id, direction: 'inbound',
      content: `SECRET-${label}-DO-NOT-LEAK`, messageType: 'text', igTimestamp: new Date(),
    },
  });
  const brandDeal = await prisma.brandDeal.create({
    data: {
      conversationId: conversation.id, instagramAccountId: account.id, userId: user.id,
      brandName: `${label} Secret Brand`, status: 'new',
    },
  });
  await prisma.notification.create({
    data: { userId: user.id, type: 'new_brand_deal', title: `${label} private notification`, conversationId: conversation.id },
  });

  return { user, account, contact, conversation, message, brandDeal };
}

(async () => {
  console.log('\n' + '='.repeat(64));
  console.log('  MULTI-TENANT ISOLATION — END-TO-END VERIFICATION');
  console.log('='.repeat(64));
  console.log(`  Target: ${BASE_URL}`);

  const health = await req('GET', '/api/conversations');
  if (health.status === 0) {
    console.error('\n  Backend not reachable on :5000. Start it, then re-run.\n');
    process.exit(1);
  }

  console.log('\n--- Provisioning two throwaway tenants ---');
  const A = await provisionTenant('A', `9900${Date.now()}`.slice(0, 15));
  const B = await provisionTenant('B', `9911${Date.now()}`.slice(0, 15));
  console.log(`  User A: ${A.user.email}  conv=${A.conversation.id.slice(0, 8)} acct=${A.account.id.slice(0, 8)}`);
  console.log(`  User B: ${B.user.email}  conv=${B.conversation.id.slice(0, 8)} acct=${B.account.id.slice(0, 8)}`);

  console.log('\n--- Authenticating both tenants (separate sessions) ---');
  const sessA = await login(A.user.email);
  const sessB = await login(B.user.email);
  check('User A login succeeds', sessA.status === 200 && Boolean(sessA.cookie), sessA.status);
  check('User B login succeeds', sessB.status === 200 && Boolean(sessB.cookie), sessB.status);
  check('A and B receive DIFFERENT session cookies', sessA.cookie !== sessB.cookie);
  if (!sessA.cookie || !sessB.cookie) {
    console.error('\n  Could not authenticate; aborting before attack matrix.\n');
    await cleanup(); process.exit(1);
  }

  // ============================================================
  console.log('\n=== 1. UNAUTHENTICATED ACCESS ===');
  // ============================================================
  for (const [label, url] of [
    ['GET /api/conversations', '/api/conversations'],
    ['GET /api/accounts', '/api/accounts'],
    ['GET /auth/me', '/auth/me'],
    ['GET A\'s messages', `/api/conversations/${A.conversation.id}/messages`],
    ['GET /api/notifications', '/api/notifications'],
    ['GET /api/settings/auto-reply-chats', '/api/settings/auto-reply-chats'],
  ]) {
    const r = await req('GET', url);
    check(`${label} -> 401 without session`, r.status === 401, r.status);
  }

  // ============================================================
  console.log('\n=== 2. CROSS-TENANT READ (as User B, targeting User A) ===');
  // ============================================================
  const bConvs = await req('GET', '/api/conversations', { cookie: sessB.cookie });
  check('B GET /api/conversations -> 200', bConvs.status === 200, bConvs.status);
  const bConvIds = Array.isArray(bConvs.data) ? bConvs.data.map((c) => c.id) : [];
  check("B's conversation list EXCLUDES A's conversation", !bConvIds.includes(A.conversation.id), bConvIds);
  check("B's conversation list includes B's own", bConvIds.includes(B.conversation.id));

  const bodyOf = (r) => JSON.stringify(r.data || '');
  const leakCheck = (r) => !bodyOf(r).includes('SECRET-A-DO-NOT-LEAK') && !bodyOf(r).includes('A Secret Brand');

  for (const [label, url] of [
    ["A's messages", `/api/conversations/${A.conversation.id}/messages`],
    ["A's AI analysis", `/api/conversations/${A.conversation.id}/ai-analysis`],
  ]) {
    const r = await req('GET', url, { cookie: sessB.cookie });
    check(`B GET ${label} -> 404`, r.status === 404, r.status);
    check(`B GET ${label} leaks no plaintext`, leakCheck(r));
  }

  const bAccts = await req('GET', '/api/accounts', { cookie: sessB.cookie });
  const bAcctIds = Array.isArray(bAccts.data) ? bAccts.data.map((a) => a.id) : [];
  check("B's account list EXCLUDES A's IG account", !bAcctIds.includes(A.account.id), bAcctIds);

  for (const [label, url] of [
    ['brand deals', '/api/brand-deals'],
    ['notifications', '/api/notifications'],
    ['auto-reply chats', '/api/settings/auto-reply-chats'],
    ['dashboard summary', '/api/dashboard/summary'],
    ['analytics summary', '/api/analytics/summary'],
  ]) {
    const r = await req('GET', url, { cookie: sessB.cookie });
    check(`B GET ${label} contains none of A's data`, leakCheck(r) && !bodyOf(r).includes('A private notification'), r.status);
  }

  // ============================================================
  console.log('\n=== 3. CROSS-TENANT WRITE (as User B) ===');
  // ============================================================
  const writes = [
    ['PATCH auto-reply on A\'s conversation', 'PATCH', `/api/conversations/${A.conversation.id}/auto-reply`, { autoReplyEnabled: true }],
    ['POST read-receipt on A\'s conversation', 'POST', `/api/conversations/${A.conversation.id}/read`, {}],
    ['POST generate-reply on A\'s conversation', 'POST', `/api/conversations/${A.conversation.id}/generate-reply`, {}],
    ['POST reply (SEND DM) on A\'s conversation', 'POST', `/api/conversations/${A.conversation.id}/reply`, { text: 'hijacked' }],
  ];
  for (const [label, method, url, data] of writes) {
    const r = await req(method, url, { cookie: sessB.cookie, data, headers: { 'Content-Type': 'application/json' } });
    check(`B ${label} -> 404`, r.status === 404, r.status);
  }

  const aConvAfterWrites = await prisma.conversation.findUnique({ where: { id: A.conversation.id } });
  check("A's conversation autoReplyEnabled NOT flipped by B", aConvAfterWrites.autoReplyEnabled !== true, aConvAfterWrites.autoReplyEnabled);

  // ============================================================
  console.log('\n=== 4. CROSS-TENANT DELETE (as User B) ===');
  // ============================================================
  for (const [label, url] of [
    ["A's messages (clear chat)", `/api/conversations/${A.conversation.id}/messages`],
    ["A's conversation", `/api/conversations/${A.conversation.id}`],
    ["A's IG account", `/api/accounts/${A.account.id}`],
  ]) {
    const r = await req('DELETE', url, { cookie: sessB.cookie });
    check(`B DELETE ${label} -> 404`, r.status === 404, r.status);
  }
  check("A's conversation still exists after B's delete attempts", Boolean(await prisma.conversation.findUnique({ where: { id: A.conversation.id } })));
  check("A's message still exists", Boolean(await prisma.message.findUnique({ where: { id: A.message.id } })));
  check("A's IG account still exists", Boolean(await prisma.instagramAccount.findUnique({ where: { id: A.account.id } })));

  // ============================================================
  console.log('\n=== 5. WEBHOOK SPOOFING (signed payload for A, sent as B) ===');
  // ============================================================
  const spoofMid = `mid.spoof.${Date.now()}`;
  const payload = JSON.stringify({
    object: 'instagram',
    entry: [{
      id: A.account.igUserId, time: Date.now(),
      messaging: [{
        sender: { id: A.contact.igsid }, recipient: { id: A.account.igUserId },
        timestamp: Date.now(), message: { mid: spoofMid, text: 'Injected via spoofed webhook' },
      }],
    }],
  });
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  const sig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(payload).digest('hex');

  // 5a. Unsigned webhook must be rejected outright.
  const unsigned = await req('POST', '/webhook', { data: payload, headers: { 'Content-Type': 'application/json' } });
  check('Unsigned webhook -> 401', unsigned.status === 401, unsigned.status);

  // 5b. Wrong signature must be rejected.
  const badSig = await req('POST', '/webhook', {
    data: payload,
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
  });
  check('Wrongly-signed webhook -> 401', badSig.status === 401, badSig.status);

  // 5c. Correctly-signed webhook naming A's account, delivered with B's cookie.
  const spoofed = await req('POST', '/webhook', {
    cookie: sessB.cookie, data: payload,
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig },
  });
  check('Signed webhook accepted (200)', spoofed.status === 200, spoofed.status);

  await new Promise((r) => setTimeout(r, 2500)); // let async processing settle

  const landed = await prisma.message.findFirst({
    where: { igMessageId: spoofMid },
    include: { conversation: { include: { instagramAccount: true } } },
  });
  check('Spoofed message was persisted', Boolean(landed));
  if (landed) {
    const ownerId = landed.conversation.instagramAccount.userId;
    check("Message routed to A's tenant (entry.id decides, NOT the session cookie)", ownerId === A.user.id, { ownerId, expected: A.user.id });
    check("Message did NOT land in B's tenant", ownerId !== B.user.id);
  }

  // ============================================================
  console.log('\n=== 6. SOCKET.IO ROOM ISOLATION ===');
  // ============================================================
  if (!ioClient) {
    console.log('  ⚠️  socket.io-client not resolvable — section skipped (not counted).');
  } else {

    const connect = (cookie) => new Promise((resolve) => {
      const s = ioClient.io(BASE_URL, {
        transports: ['websocket', 'polling'], extraHeaders: { Cookie: cookie },
        rejectUnauthorized: false, reconnection: false, timeout: 8000,
      });
      const received = [];
      s.onAny((event, data) => received.push({ event, data }));
      s.on('connect', () => resolve({ socket: s, received, connected: true }));
      s.on('connect_error', () => resolve({ socket: s, received, connected: false }));
      setTimeout(() => resolve({ socket: s, received, connected: s.connected }), 8000);
    });

    const [cA, cB, cAnon] = await Promise.all([connect(sessA.cookie), connect(sessB.cookie), connect('')]);
    check("A's authenticated socket connects", cA.connected);
    check("B's authenticated socket connects", cB.connected);
    // The server disconnects unauthenticated sockets inside its 'connection'
    // handler, so the client may briefly report connected. Allow it to settle.
    await new Promise((r) => setTimeout(r, 1500));
    check('Unauthenticated socket is rejected/disconnected',
      !cAnon.connected || cAnon.socket.disconnected || !cAnon.socket.connected,
      { connected: cAnon.socket.connected, disconnected: cAnon.socket.disconnected });

    // IMPORTANT: emitToUser() must be triggered INSIDE the server process.
    // Calling it from this script would hit a separate lib/socket.js module
    // instance whose ioInstance is null — a silent no-op that would make the
    // "B received nothing" assertions vacuously pass. So we drive a real
    // signed webhook for A's IG account, which makes the server emit.
    cA.received.length = 0; cB.received.length = 0;

    const liveMid = `mid.socket.${Date.now()}`;
    const livePayload = JSON.stringify({
      object: 'instagram',
      entry: [{
        id: A.account.igUserId, time: Date.now(),
        messaging: [{
          sender: { id: A.contact.igsid }, recipient: { id: A.account.igUserId },
          timestamp: Date.now(), message: { mid: liveMid, text: 'SECRET-A-DO-NOT-LEAK socket probe' },
        }],
      }],
    });
    const liveSig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(livePayload).digest('hex');
    const liveRes = await req('POST', '/webhook', {
      data: livePayload,
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': liveSig },
    });
    check('Live webhook for A accepted', liveRes.status === 200, liveRes.status);
    await new Promise((r) => setTimeout(r, 3000));

    // Positive control — proves the emit actually happened. Without this, the
    // negative assertions below would be meaningless.
    check("A's socket RECEIVED new_message (positive control)",
      cA.received.some((m) => m.event === 'new_message'), cA.received.map((m) => m.event));
    check("B's socket received NOTHING while A got a DM", cB.received.length === 0, cB.received);
    check("B's socket never saw A's secret payload", !JSON.stringify(cB.received).includes('SECRET-A-DO-NOT-LEAK'));

    // B attempts to force-join A's room, then we emit to A again.
    cB.socket.emit('join', { userId: A.user.id });
    await new Promise((r) => setTimeout(r, 800));
    cA.received.length = 0; cB.received.length = 0;

    const mid2 = `mid.socket2.${Date.now()}`;
    const payload2 = JSON.stringify({
      object: 'instagram',
      entry: [{
        id: A.account.igUserId, time: Date.now(),
        messaging: [{
          sender: { id: A.contact.igsid }, recipient: { id: A.account.igUserId },
          timestamp: Date.now(), message: { mid: mid2, text: 'SECRET-A-DO-NOT-LEAK after join attempt' },
        }],
      }],
    });
    const sig2 = 'sha256=' + crypto.createHmac('sha256', appSecret).update(payload2).digest('hex');
    await req('POST', '/webhook', {
      data: payload2,
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig2 },
    });
    await new Promise((r) => setTimeout(r, 3000));

    check("A still receives after B's join attempt (positive control)",
      cA.received.some((m) => m.event === 'new_message'), cA.received.map((m) => m.event));
    check("B receives NOTHING after emitting join for A's room", cB.received.length === 0, cB.received);

    cA.socket.close(); cB.socket.close(); cAnon.socket.close();
  }

  await cleanup();

  console.log('\n' + '='.repeat(64));
  console.log(`  RESULTS: ${pass} passed, ${fail} failed out of ${pass + fail}`);
  if (fail) { console.log('\n  FAILED:'); failures.forEach((f) => console.log(`    - ${f}`)); }
  console.log('='.repeat(64) + '\n');
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('\nFATAL:', e.message, '\n', e.stack);
  await cleanup();
  process.exit(1);
});

async function cleanup() {
  try {
    const accounts = await prisma.instagramAccount.findMany({ where: { userId: { in: createdUserIds } }, select: { id: true } });
    const acctIds = accounts.map((a) => a.id);
    const convs = await prisma.conversation.findMany({ where: { instagramAccountId: { in: acctIds } }, select: { id: true } });
    const convIds = convs.map((c) => c.id);
    await prisma.aIAnalysis.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversationSummary.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.replyGeneration.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.brandDeal.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
    await prisma.contact.deleteMany({ where: { instagramAccountId: { in: acctIds } } });
    await prisma.webhookLog.deleteMany({ where: { instagramAccountId: { in: acctIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.usageEvent.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.instagramAccount.deleteMany({ where: { id: { in: acctIds } } });
    await prisma.businessProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.creatorPreference.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    console.log('\n  [cleanup] throwaway tenants removed.');
  } catch (e) {
    console.error('  [cleanup] failed:', e.message);
  }
  await prisma.$disconnect();
}
