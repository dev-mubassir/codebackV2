/**
 * Password hashing.
 *
 * Argon2id for new hashes. The pre-existing hashes are bcrypt at cost 10 —
 * low enough to be worth moving off (the admin password was hashed at 12, so
 * the customer-facing factor was the weaker of the two), but NOT worth forcing
 * a password reset over.
 *
 * So: verify against whatever algorithm the stored hash actually is, and when
 * a bcrypt hash verifies successfully, transparently re-hash it with Argon2id
 * and store that. Users migrate as they log in, and nobody is locked out.
 *
 * Both hash formats are self-describing ($2a$/$2b$ vs $argon2id$), so no
 * separate algorithm column is needed.
 */

const argon2 = require('argon2');
const bcrypt = require('bcryptjs');

// OWASP Password Storage Cheat Sheet, second recommended Argon2id profile:
// 19 MiB memory, 2 iterations, 1 degree of parallelism.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function isArgon2Hash(hash) {
  return typeof hash === 'string' && hash.startsWith('$argon2');
}

function isBcryptHash(hash) {
  return typeof hash === 'string' && /^\$2[aby]?\$/.test(hash);
}

async function hashPassword(plaintext) {
  return argon2.hash(String(plaintext), ARGON2_OPTIONS);
}

/**
 * Verify a password against a stored hash of either algorithm.
 *
 * Returns { valid, needsRehash }. `needsRehash` is true when the password was
 * correct but the stored hash is not the current Argon2id profile — the caller
 * should then re-hash and persist.
 *
 * Never throws on a malformed stored hash; a corrupt hash is a failed login,
 * not a 500.
 */
async function verifyPassword(plaintext, storedHash) {
  const candidate = String(plaintext);

  if (isArgon2Hash(storedHash)) {
    try {
      const valid = await argon2.verify(storedHash, candidate);
      return { valid, needsRehash: valid && argon2.needsRehash(storedHash, ARGON2_OPTIONS) };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  if (isBcryptHash(storedHash)) {
    try {
      const valid = await bcrypt.compare(candidate, storedHash);
      // Any surviving bcrypt hash is by definition due for migration.
      return { valid, needsRehash: valid };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  return { valid: false, needsRehash: false };
}

/**
 * A dummy verification, for the no-such-user branch of login.
 *
 * Without this, a nonexistent email returns in database-round-trip time while
 * a real account pays a full password verification — a remotely measurable
 * enumeration oracle that also reveals which accounts are OAuth-only. Burning
 * equivalent work keeps the two paths indistinguishable.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Iy5v3Xk3xLzZ0eQnZ8Yw2vN1qKQ8xJ7Zx3mQ1p9Wc0M';

async function burnEquivalentWork(plaintext) {
  try {
    await argon2.verify(DUMMY_ARGON2_HASH, String(plaintext));
  } catch {
    // Expected: the dummy hash never matches, and may not even parse. The
    // point is the elapsed time, not the result.
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  burnEquivalentWork,
  isArgon2Hash,
  isBcryptHash,
  ARGON2_OPTIONS,
};
