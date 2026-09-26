/**
 * Pre-switch self-check: are the secrets in THIS environment the same ones
 * that wrote the data in THIS database? Proven by using them, never by
 * reading or printing them.
 *
 *   tokens      every stored Instagram access token must decrypt with the
 *               current TOKEN_ENCRYPTION_KEY (AES-256-GCM: a wrong key fails
 *               authentication, it does not return garbage)
 *   identities  for every stored Instagram account id, HMAC(igUserId,
 *               IG_IDENTITY_PEPPER) must find its row in the trial-abuse
 *               ledger. A wrong pepper matches nothing.
 *
 * Counts only — no token, id or hash leaves this function. Used by
 * GET /api/admin/self-check and scripts/secret-self-check.js (cutover step 5).
 */

const prisma = require('./prisma');
const { decrypt } = require('./crypto');
const { hashIgUserId } = require('./igIdentity');

const BATCH = 500;
const pct = (ok, total) => (total === 0 ? 100 : Math.floor((ok / total) * 10000) / 100);

async function checkTokens() {
  let cursor;
  let total = 0;
  let ok = 0;
  for (;;) {
    const rows = await prisma.instagramAccount.findMany({
      select: { id: true, accessToken: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      total += 1;
      try {
        if (decrypt(r.accessToken)) ok += 1;
      } catch {
        /* counted as a failure */
      }
    }
    cursor = rows[rows.length - 1].id;
  }
  return { total, decryptable: ok, percent: pct(ok, total) };
}

async function checkIdentities() {
  const accounts = await prisma.instagramAccount.findMany({ distinct: ['igUserId'], select: { igUserId: true } });
  const ids = accounts.map((a) => a.igUserId).filter(Boolean);
  let matched = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const hashes = ids.slice(i, i + BATCH).map((id) => hashIgUserId(id));
    matched += await prisma.instagramIdentity.count({ where: { igUserIdHash: { in: hashes } } });
  }
  const ledgerRows = await prisma.instagramIdentity.count();
  return { accounts: ids.length, matched, percent: pct(matched, ids.length), ledgerRows };
}

async function runSecretSelfCheck() {
  const [tokens, identities] = await Promise.all([checkTokens(), checkIdentities()]);
  return { tokens, identities, pass: tokens.percent === 100 && identities.percent === 100 };
}

module.exports = { runSecretSelfCheck };
