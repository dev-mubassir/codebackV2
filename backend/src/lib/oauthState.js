/**
 * Self-contained, HMAC-signed OAuth state tokens.
 *
 * WHY THIS EXISTS. State used to live in the session. That is structurally
 * broken on mobile: a user who starts in Brave, gets bounced into Instagram's
 * in-app browser, and lands back in Chrome arrives at the callback with a
 * different cookie jar — no session, therefore no state, therefore a rejected
 * callback and a lost authorization. The product copy already blamed exactly
 * that scenario.
 *
 * The fix is to stop needing the cookie. The state token carries everything
 * the callback needs and proves its own integrity:
 *
 *   payload = base64url(JSON({ n: nonce, u: userId, t: issuedAt, r: redirect, p: purpose }))
 *   state   = payload + "." + base64url(HMAC-SHA256(payload, OAUTH_STATE_SECRET))
 *
 * Integrity comes from the HMAC. REPLAY protection cannot — a signed token
 * stays valid forever by itself — so the nonce is recorded in the OAuthNonce
 * table and stamped used on first presentation. Signature in the token, replay
 * defence in the database.
 *
 * PURPOSE DISCRIMINATOR. Both the Google and Instagram flows sign with the
 * same secret, so without `p` a state token minted for one flow is
 * structurally valid at the other flow's callback. It is inside the signed
 * payload, so it cannot be swapped.
 */

const crypto = require('crypto');
const prisma = require('./prisma');

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PURPOSES = ['GOOGLE_LOGIN', 'INSTAGRAM_CONNECT'];

function getSecret() {
  const secret = (process.env.OAUTH_STATE_SECRET || '').trim();
  if (!secret) {
    throw new Error('OAUTH_STATE_SECRET is not set — OAuth state cannot be signed.');
  }
  return secret;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadB64) {
  return crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
}

/**
 * Mint a state token and record its nonce.
 *
 * INSTAGRAM_CONNECT requires a userId: connecting an account to nobody is
 * meaningless, and the OAuth callback must never create a user (Instagram is
 * connect-only — there is no email to send a receipt or an expiry warning to).
 * GOOGLE_LOGIN permits a null userId, because signing in with Google is
 * precisely the case where there is no session yet.
 */
async function createState({ purpose, userId = null, redirectPath = null }) {
  if (!PURPOSES.includes(purpose)) {
    throw new Error(`oauthState: unknown purpose ${purpose}`);
  }
  if (purpose === 'INSTAGRAM_CONNECT' && !userId) {
    throw new Error('oauthState: INSTAGRAM_CONNECT requires an authenticated userId');
  }

  const nonce = crypto.randomBytes(32).toString('base64url');
  const issuedAt = Date.now();
  const expiresAt = new Date(issuedAt + STATE_TTL_MS);

  await prisma.oAuthNonce.create({
    data: { nonce, purpose, userId, expiresAt },
  });

  const payload = { n: nonce, u: userId, t: issuedAt, p: purpose };
  if (redirectPath) payload.r = redirectPath;

  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Verify and consume a state token.
 *
 * Order matters: signature, then timestamp, then nonce. Verifying the cheap
 * cryptographic property first means a forged token never reaches the
 * database.
 *
 * Returns { ok: true, payload } or { ok: false, reason }.
 */
async function verifyAndConsumeState({ state, expectedPurpose }) {
  if (typeof state !== 'string' || !state.includes('.')) {
    return { ok: false, reason: 'malformed' };
  }

  const idx = state.lastIndexOf('.');
  const payloadB64 = state.slice(0, idx);
  const providedSig = state.slice(idx + 1);

  // Timing-safe, and length-guarded so a wrong-length signature cannot throw.
  const expectedSig = sign(payloadB64);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' };
  if (payload.p !== expectedPurpose) return { ok: false, reason: 'wrong_purpose' };
  if (typeof payload.t !== 'number' || Date.now() - payload.t > STATE_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }

  // Replay defence. Conditional update on usedAt: null, so two concurrent
  // presentations of the same token cannot both succeed.
  const claimed = await prisma.oAuthNonce.updateMany({
    where: { nonce: payload.n, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, reason: 'replayed_or_unknown_nonce' };

  return { ok: true, payload };
}

/** Housekeeping: nonces are useless once expired. */
async function purgeExpiredNonces({ olderThanHours = 24 } = {}) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const { count } = await prisma.oAuthNonce.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return count;
}

module.exports = {
  createState,
  verifyAndConsumeState,
  purgeExpiredNonces,
  STATE_TTL_MS,
};
