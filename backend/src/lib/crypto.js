/**
 * Simple AES-256-GCM encryption for access tokens.
 * 
 * Not production-grade key management, but prevents plain-text tokens
 * in the database if it leaks. Uses a symmetric key from env vars.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;     // 128-bit IV
const TAG_LENGTH = 16;    // 128-bit auth tag

/**
 * Get the encryption key from environment variable.
 * Must be exactly 32 bytes (256 bits). If not set, we derive one from SESSION_SECRET.
 */
function getKey() {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (envKey && Buffer.from(envKey, 'hex').length === 32) {
    return Buffer.from(envKey, 'hex');
  }

  // Fallback: derive a key from SESSION_SECRET using SHA-256
  const secret = process.env.SESSION_SECRET || 'codeback-dev-fallback-key';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plaintext string.
 * Returns a hex string in the format: iv:encrypted:authTag
 */
function encrypt(plaintext) {
  if (!plaintext) return null;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  // Combine as iv:ciphertext:tag for easy storage
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

/**
 * Decrypt an encrypted string (iv:ciphertext:tag format).
 * Returns the original plaintext.
 */
function decrypt(encryptedString) {
  if (!encryptedString) return null;

  // Handle legacy plain-text tokens (no colons = not encrypted)
  if (!encryptedString.includes(':')) {
    return encryptedString;
  }

  const key = getKey();
  const parts = encryptedString.split(':');

  if (parts.length !== 3) {
    console.warn('[Crypto] Invalid encrypted format, returning as-is');
    return encryptedString;
  }

  const [ivHex, ciphertext, authTagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = { encrypt, decrypt };
