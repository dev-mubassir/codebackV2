/**
 * Password-reset and email-verification tokens.
 *
 * THE RAW TOKEN IS NEVER STORED. Only its SHA-256 goes to the database, so a
 * database leak yields no usable tokens. The raw value exists exactly twice:
 * in the response of issueToken() (which the caller puts straight into an
 * email and then drops) and in the email itself.
 *
 * SHA-256 rather than bcrypt/argon2 deliberately: these are 256 bits of
 * cryptographic randomness, not user-chosen passwords, so they are not
 * brute-forceable and a slow KDF would only add latency to every verification.
 * The lookup is also an indexed equality match, which a salted KDF cannot do.
 */

const crypto = require('crypto');
const prisma = require('./prisma');

const PASSWORD_RESET_TTL_MINUTES = 30;
const EMAIL_VERIFY_TTL_MINUTES = 60 * 24; // 24h — verification is less sensitive than reset

const TTL_BY_TYPE = {
  PASSWORD_RESET: PASSWORD_RESET_TTL_MINUTES,
  EMAIL_VERIFY: EMAIL_VERIFY_TTL_MINUTES,
};

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Mint a token of `type` for `userId`.
 *
 * Issuing a new token INVALIDATES every prior unused token of the same type
 * for that user. Without this, "email me another link" would leave the earlier
 * link live, so an attacker who intercepted the first one keeps a working
 * token even after the user requests a fresh one.
 *
 * Returns { rawToken, expiresAt, expiresInMinutes }. The raw token is not
 * recoverable after this call returns.
 */
async function issueToken({ userId, type, requestIp = null }) {
  const ttlMinutes = TTL_BY_TYPE[type];
  if (!ttlMinutes) throw new Error(`authTokens: unknown token type ${type}`);

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await prisma.$transaction([
    prisma.authToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.authToken.create({
      data: { userId, type, tokenHash, expiresAt, requestIp },
    }),
  ]);

  return { rawToken, expiresAt, expiresInMinutes: ttlMinutes };
}

/**
 * Look up a raw token without consuming it.
 * Returns { ok: true, token } or { ok: false, reason }.
 */
async function inspectToken({ rawToken, type }) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    return { ok: false, reason: 'malformed' };
  }

  const token = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });

  if (!token) return { ok: false, reason: 'not_found' };
  if (token.type !== type) return { ok: false, reason: 'wrong_type' };
  if (token.usedAt) return { ok: false, reason: 'already_used' };
  if (token.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  return { ok: true, token };
}

/**
 * Atomically consume a token.
 *
 * The stamp is a conditional updateMany on `usedAt: null`, not a read followed
 * by a write: two requests presenting the same token concurrently would both
 * pass a read-then-write check and both be honoured. Here exactly one gets
 * count === 1.
 */
async function consumeToken({ rawToken, type }) {
  const inspection = await inspectToken({ rawToken, type });
  if (!inspection.ok) return inspection;

  const result = await prisma.authToken.updateMany({
    where: { id: inspection.token.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  if (result.count === 0) return { ok: false, reason: 'already_used' };
  return { ok: true, token: inspection.token };
}

/** Housekeeping: drop tokens that are long past useful. */
async function purgeExpiredTokens({ olderThanDays = 7 } = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.authToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return count;
}

module.exports = {
  hashToken,
  issueToken,
  inspectToken,
  consumeToken,
  purgeExpiredTokens,
  PASSWORD_RESET_TTL_MINUTES,
  EMAIL_VERIFY_TTL_MINUTES,
};
