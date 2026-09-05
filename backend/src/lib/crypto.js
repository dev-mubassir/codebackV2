/**
 * AES-256-GCM encryption for Instagram access tokens.
 *
 * KEY MANAGEMENT — read before changing anything here.
 *
 * The key comes from TOKEN_ENCRYPTION_KEY and nowhere else. It used to fall
 * back to sha256(SESSION_SECRET), which coupled two unrelated secrets: rotating
 * the session signing key silently made every stored Instagram token
 * undecryptable, with no warning and no way to tell it had happened. That
 * fallback is gone, and an unset key now fails loudly at boot instead of
 * quietly producing a different key.
 *
 * Verified before removal: the configured TOKEN_ENCRYPTION_KEY is a valid
 * 32-byte hex value, is NOT equal to sha256(SESSION_SECRET), and round-trips
 * real stored tokens — so nothing in this deployment was ever encrypted under
 * the derived key.
 *
 * STORAGE. Two representations exist during the transition:
 *
 *   legacy  — a single `iv:ciphertext:tag` hex string in access_token
 *   split   — token_iv / token_ciphertext / token_auth_tag / token_key_version
 *
 * The split form is the target: it lets a key rotation identify which key
 * encrypted a given row instead of failing to decrypt everything at once.
 *
 * THE PLAIN-TEXT PASSTHROUGH IN decrypt() STAYS FOR NOW. It is the only thing
 * keeping any pre-encryption row working, and removing it before the backfill
 * is verified complete in EVERY environment would ship ciphertext straight to
 * Meta. See FINDINGS.md D3 — that removal is a separate, later change.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV
const CURRENT_KEY_VERSION = 1;

/**
 * Resolve the key for a given version.
 *
 * Only version 1 exists today. When a rotation happens, add version 2 here
 * reading a second env var and leave version 1 in place so existing rows keep
 * decrypting — that is the entire reason token_key_version is stored.
 */
function getKey(version = CURRENT_KEY_VERSION) {
  if (version !== 1) {
    throw new Error(`Token encryption key version ${version} is not configured.`);
  }

  const envKey = (process.env.TOKEN_ENCRYPTION_KEY || '').trim();
  if (!envKey) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set. Instagram access tokens cannot be encrypted or ' +
        'decrypted without it. Generate one with: ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  const key = Buffer.from(envKey, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be 32 bytes of hex (64 characters); got ${key.length} bytes.`
    );
  }
  return key;
}

/**
 * Encrypt into separate parts — the storage form the schema now uses.
 * Returns { ciphertext, iv, authTag, keyVersion }, all hex.
 */
function encryptToParts(plaintext) {
  if (!plaintext) return null;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  let ciphertext = cipher.update(String(plaintext), 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * Decrypt from separate parts.
 *
 * Throws on a bad auth tag rather than returning anything — a token that fails
 * authentication is not a token, and returning a "best effort" value here is
 * how ciphertext ends up being sent to Meta.
 */
function decryptFromParts({ ciphertext, iv, authTag, keyVersion = CURRENT_KEY_VERSION }) {
  if (!ciphertext || !iv || !authTag) {
    throw new Error('decryptFromParts: ciphertext, iv and authTag are all required.');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(keyVersion), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/**
 * Legacy combined form: `iv:ciphertext:tag`.
 * Retained so the transition can be gradual; prefer encryptToParts.
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const parts = encryptToParts(plaintext);
  return `${parts.iv}:${parts.ciphertext}:${parts.authTag}`;
}

/**
 * Decrypt the legacy combined form.
 *
 * The two passthroughs below are DELIBERATE and MUST NOT be removed until the
 * token backfill is verified complete in every environment (FINDINGS.md D3).
 * They are what keeps a pre-encryption row working.
 */
function decrypt(encryptedString) {
  if (!encryptedString) return null;

  // Legacy plain-text token (no colon = never encrypted). See D3.
  if (!encryptedString.includes(':')) {
    return encryptedString;
  }

  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    console.warn('[Crypto] Invalid encrypted format, returning as-is');
    return encryptedString;
  }

  const [iv, ciphertext, authTag] = parts;
  return decryptFromParts({ iv, ciphertext, authTag, keyVersion: CURRENT_KEY_VERSION });
}

/**
 * Is this value stored in the encrypted (iv:ciphertext:tag) form?
 * Used by the backfill to tell encrypted rows from plain-text ones.
 */
function looksEncrypted(value) {
  return typeof value === 'string' && value.split(':').length === 3;
}

/**
 * Read an account's token regardless of which representation it is in.
 *
 * Prefers the split columns, falls back to the legacy combined column. Once
 * the backfill has run everywhere and access_token is dropped, the fallback
 * branch becomes dead and can go with it.
 */
function readAccountToken(account) {
  if (account.tokenCiphertext && account.tokenIv && account.tokenAuthTag) {
    return decryptFromParts({
      ciphertext: account.tokenCiphertext,
      iv: account.tokenIv,
      authTag: account.tokenAuthTag,
      keyVersion: account.tokenKeyVersion || CURRENT_KEY_VERSION,
    });
  }
  return decrypt(account.accessToken);
}

/**
 * Build the write payload for a token, populating BOTH representations.
 *
 * access_token is still written because it remains NOT NULL until the D3
 * cleanup migration drops it.
 */
function writeAccountToken(plaintext) {
  const parts = encryptToParts(plaintext);
  return {
    accessToken: `${parts.iv}:${parts.ciphertext}:${parts.authTag}`,
    tokenCiphertext: parts.ciphertext,
    tokenIv: parts.iv,
    tokenAuthTag: parts.authTag,
    tokenKeyVersion: parts.keyVersion,
  };
}

module.exports = {
  encrypt,
  decrypt,
  encryptToParts,
  decryptFromParts,
  looksEncrypted,
  readAccountToken,
  writeAccountToken,
  CURRENT_KEY_VERSION,
};
