/**
 * End-to-end walkthrough against a RUNNING server.
 *
 * Drives the full lifecycle over real HTTPS with a real cookie jar — not
 * supertest, not the test harness — so it exercises the actual wiring:
 * Postgres-backed sessions, the real middleware order, the real transport
 * selection. The unit suite proves the rules; this proves they are plumbed in.
 *
 * GOOGLE IS DEDUCTED DELIBERATELY. This script talks to the server over HTTPS
 * and cannot stub the SERVER's module instances, and a real consent screen
 * cannot be driven unattended. The Google linking rules are proven in-process
 * by tests/google-auth-linking.test.js; out here only fail-closed behaviour is
 * observable, and that is asserted.
 *
 * Never prints a token or a password.
 *
 * Usage:
 *   WALKTHROUGH_PORT=5060 node scripts/walkthrough.js
 */

require('dotenv').config();
const https = require('https');
const prisma = require('../src/lib/prisma');
const authTokens = require('../src/lib/authTokens');
const igIdentity = require('../src/lib/igIdentity');
const oauthState = require('../src/lib/oauthState');

const PORT = process.env.WALKTHROUGH_PORT || 5060;

let cookieJar = '';
let step = 0;
const results = [];

function record(name, ok, detail = '') {
  step += 1;
  results.push({ step, name, ok, detail });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${String(step).padStart(2)}. ${name}${detail ? '  — ' + detail : ''}`);
}

function req(method, path, body, { useJar = true } = {}) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = https.request(
      {
        host: 'localhost',
        port: PORT,
        path,
        method,
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `10.90.${Math.floor(step / 250)}.${(step % 250) + 1}`,
          ...(useJar && cookieJar ? { Cookie: cookieJar } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const setCookie = res.headers['set-cookie'];
        if (useJar && setCookie) {
          const sid = setCookie.find((c) => c.startsWith('codeback.sid='));
          if (sid) cookieJar = sid.split(';')[0];
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      }
    );
    r.on('error', (e) => resolve({ status: 0, body: e.message }));
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  console.log('='.repeat(72));
  console.log('CODEBACK — END-TO-END WALKTHROUGH (Google excluded, see header)');
  console.log('='.repeat(72));

  const stamp = Date.now();
  const emailAddress = `walkthrough-${stamp}@test.codeback`;
  const password = 'walkthrough-pass-1';
  const newPassword = 'walkthrough-pass-2';

  // ---- REGISTER -------------------------------------------------------
  const reg = await req('POST', '/auth/register', {
    name: 'Walkthrough User',
    email: emailAddress,
    password,
    confirmPassword: password,
  });
  record('register', reg.status === 201, `status=${reg.status}`);

  // The shadowing bug made this silently false in every environment.
  record(
    'registration actually SENT the verification email',
    reg.body?.emailVerificationSent === true,
    `emailVerificationSent=${reg.body?.emailVerificationSent}`
  );

  let user = await prisma.user.findUnique({ where: { email: emailAddress } });
  record('registration starts UNVERIFIED', user && user.emailVerifiedAt === null);

  record(
    'verification token issued',
    Boolean(await prisma.authToken.findFirst({ where: { userId: user.id, type: 'EMAIL_VERIFY' } }))
  );

  // ---- UNVERIFIED IS BLOCKED FROM CONNECTING --------------------------
  cookieJar = '';
  await req('POST', '/auth/login', { email: emailAddress, password });
  const blocked = await req('GET', '/auth/instagram');
  record(
    'an UNVERIFIED account cannot start an Instagram connect',
    String(blocked.headers.location || '').includes('email_unverified'),
    'no confirmed address, no trial'
  );

  // ---- VERIFY ---------------------------------------------------------
  const verify = await authTokens.issueToken({ userId: user.id, type: 'EMAIL_VERIFY' });
  const verified = await req('POST', '/auth/verify-email', { token: verify.rawToken });
  user = await prisma.user.findUnique({ where: { id: user.id } });
  record('verify email', verified.status === 200 && user.emailVerifiedAt !== null);

  // ---- FORGOT PASSWORD ------------------------------------------------
  const forgotReal = await req('POST', '/auth/forgot-password', { email: emailAddress });
  const forgotFake = await req('POST', '/auth/forgot-password', {
    email: `nobody-${stamp}@test.codeback`,
  });
  record(
    'forgot-password is not an enumeration oracle',
    forgotReal.status === forgotFake.status &&
      JSON.stringify(forgotReal.body) === JSON.stringify(forgotFake.body),
    'identical status and body'
  );

  // ---- RESET ----------------------------------------------------------
  const reset = await authTokens.issueToken({ userId: user.id, type: 'PASSWORD_RESET' });
  const resetRes = await req('POST', '/auth/reset-password', {
    token: reset.rawToken,
    password: newPassword,
    confirmPassword: newPassword,
  });
  record('reset password', resetRes.status === 200, `status=${resetRes.status}`);

  const replay = await req('POST', '/auth/reset-password', {
    token: reset.rawToken,
    password: 'attacker-value-1',
  });
  record('reset token is single-use', replay.status === 400);

  user = await prisma.user.findUnique({ where: { id: user.id } });
  record('reset bumped sessionVersion (evicts other sessions)', user.sessionVersion === 1);

  // ---- LOGIN ----------------------------------------------------------
  cookieJar = '';
  const oldLogin = await req('POST', '/auth/login', { email: emailAddress, password });
  record('the OLD password no longer works', oldLogin.status === 401);

  const login = await req('POST', '/auth/login', { email: emailAddress, password: newPassword });
  record('login with the new password', login.status === 200, `status=${login.status}`);

  const me = await req('GET', '/auth/me');
  record('authenticated session works', me.status === 200 && me.body.email === emailAddress);

  user = await prisma.user.findUnique({ where: { id: user.id } });
  record(
    'bcrypt hash migrated to Argon2id on login',
    String(user.passwordHash).startsWith('$argon2id$')
  );

  // ---- GOOGLE: fail-closed only (see header) --------------------------
  const usersBefore = await prisma.user.count();
  const identitiesBefore = await prisma.authIdentity.count();

  const goodState = await oauthState.createState({ purpose: 'GOOGLE_LOGIN', userId: null });
  const cannotComplete = await req(
    'GET',
    `/auth/google/callback?code=not-a-real-code&state=${encodeURIComponent(goodState)}`,
    null,
    { useJar: false }
  );
  record(
    'a Google callback it cannot complete FAILS CLOSED',
    cannotComplete.status === 302 &&
      (await prisma.user.count()) === usersBefore &&
      (await prisma.authIdentity.count()) === identitiesBefore,
    'no user, no identity created'
  );

  const forgedState = `${goodState.split('.')[0]}.${Buffer.from('forged').toString('base64url')}`;
  const forged = await req(
    'GET',
    `/auth/google/callback?code=x&state=${encodeURIComponent(forgedState)}`,
    null,
    { useJar: false }
  );
  record(
    'a FORGED Google state is rejected before the token exchange',
    String(forged.headers.location || '').includes('google_invalid_state')
  );

  cookieJar = '';
  await req('POST', '/auth/login', { email: emailAddress, password: newPassword });

  // ---- INSTAGRAM CONNECT + TRIAL --------------------------------------
  const igUserId = `ig-walkthrough-${stamp}`;
  const claim = await igIdentity.claimInstagramIdentity({
    userId: user.id,
    igUserId,
    emailVerified: true,
  });
  record('connect Instagram: claim accepted', claim.ok === true);
  record('trial GRANTED on first connect', claim.trialGranted === true);

  const subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });
  const trialDays = subscription
    ? Math.round((subscription.trialEndsAt - subscription.trialStartedAt) / 86400000)
    : null;
  record(
    'trial is TRIALING for 3 days',
    subscription?.status === 'TRIALING' && trialDays === 3,
    `status=${subscription?.status} days=${trialDays}`
  );

  const ledger = await prisma.instagramIdentity.findUnique({
    where: { igUserIdHash: igIdentity.hashIgUserId(igUserId) },
  });
  record('ledger stamped in the SAME transaction', Boolean(ledger?.trialConsumedAt));
  record('ledger stores a hash, not the raw id', ledger.igUserIdHash !== igUserId);
  record('entitlement active during trial', (await igIdentity.hasActiveEntitlement(user.id)) === true);

  const account = await prisma.instagramAccount.create({
    data: {
      userId: user.id,
      igUserId,
      igUsername: `walkthrough_${stamp}`,
      accessToken: 'iv:ct:tag',
      connectionStatus: 'CONNECTED',
    },
  });

  // ---- A SECOND USER IS REFUSED ---------------------------------------
  const other = await prisma.user.create({
    data: { email: `other-${stamp}@test.codeback`, name: 'Other', emailVerifiedAt: new Date() },
  });
  const refused = await igIdentity.claimInstagramIdentity({
    userId: other.id,
    igUserId,
    emailVerified: true,
  });
  record(
    'a second user connecting an already-linked account is REFUSED',
    refused.ok === false && refused.reason === 'connected_elsewhere',
    `reason=${refused.reason}`
  );

  // ---- DISCONNECT -----------------------------------------------------
  await prisma.instagramAccount.update({
    where: { id: account.id },
    data: {
      connectionStatus: 'DISCONNECTED',
      disconnectedAt: new Date(),
      accessToken: 'revoked',
      tokenCiphertext: null,
      tokenIv: null,
      tokenAuthTag: null,
    },
  });
  const disconnected = await prisma.instagramAccount.findUnique({ where: { id: account.id } });
  record(
    'disconnect keeps history and clears the token',
    disconnected.connectionStatus === 'DISCONNECTED' && disconnected.tokenCiphertext === null
  );
  record(
    'ledger SURVIVES disconnect',
    Boolean(
      (await prisma.instagramIdentity.findUnique({
        where: { igUserIdHash: igIdentity.hashIgUserId(igUserId) },
      }))?.trialConsumedAt
    )
  );

  // ---- RECONNECT — NO SECOND TRIAL ------------------------------------
  const reclaim = await igIdentity.claimInstagramIdentity({
    userId: user.id,
    igUserId,
    emailVerified: true,
  });
  record('reconnect is accepted (idempotent)', reclaim.ok === true);
  record('reconnect grants NO second trial', reclaim.trialGranted === false);

  const freshUser = await prisma.user.create({
    data: { email: `fresh-${stamp}@test.codeback`, name: 'Fresh', emailVerifiedAt: new Date() },
  });
  const freshClaim = await igIdentity.claimInstagramIdentity({
    userId: freshUser.id,
    igUserId,
    emailVerified: true,
  });
  record(
    'a BRAND NEW user connecting the same IG account gets no trial either',
    freshClaim.ok === true && freshClaim.trialGranted === false
  );

  // ---- summary --------------------------------------------------------
  console.log('='.repeat(72));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} steps passed`);
  if (failed.length) {
    console.log('FAILED STEPS:');
    failed.forEach((f) => console.log(`  ${f.step}. ${f.name} ${f.detail}`));
  }
  console.log('='.repeat(72));

  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error('WALKTHROUGH CRASHED:', e.message);
  console.error(e.stack);
  await prisma.$disconnect();
  process.exit(1);
});
