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

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Get the encryption key. Prefer a dedicated 32-byte hex TOKEN_ENCRYPTION_KEY.
 * For backward compatibility with tokens already encrypted from SESSION_SECRET,
 * fall back to deriving the key from SESSION_SECRET — but NEVER from a hardcoded
 * public default in production. The server startup gate (index.js) refuses to
 * boot in production unless SESSION_SECRET is set to a strong, non-default value,
 * so this fallback is never a publicly-known key in production.
 */
function getKey() {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (envKey && Buffer.from(envKey, 'hex').length === 32) {
    return Buffer.from(envKey, 'hex');
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (isProduction) {
      throw new Error(
        'Token encryption is not configured: set TOKEN_ENCRYPTION_KEY (32-byte hex) or SESSION_SECRET.'
      );
    }
    // Development-only fallback (clearly non-secret). Not reachable in production.
    return crypto.createHash('sha256').update('codeback-dev-fallback-key').digest();
  }
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
