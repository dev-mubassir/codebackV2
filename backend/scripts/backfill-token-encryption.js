/**
 * Stage 2 of the token migration (FINDINGS.md D3).
 *
 * The Gate 1 migration split already-encrypted `iv:ciphertext:tag` values into
 * token_iv / token_ciphertext / token_auth_tag using SQL. It could not touch
 * PLAIN-TEXT tokens, because encrypting requires AES and SQL has none. This
 * script does that half.
 *
 * It then does something the migration's SQL postcondition cannot:
 * DECRYPTS EVERY ROW FROM THE NEW COLUMNS and reports any failure. A non-null
 * check proves the columns are populated; it does not prove they are
 * *correct*. Only a decryption does.
 *
 * SAFE TO RE-RUN. Rows already in the split form are verified, not rewritten.
 *
 * Usage:
 *   node scripts/backfill-token-encryption.js            # report only, no writes
 *   node scripts/backfill-token-encryption.js --apply    # perform the backfill
 *
 * Never prints a token, encrypted or otherwise.
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const {
  looksEncrypted,
  encryptToParts,
  decryptFromParts,
  CURRENT_KEY_VERSION,
} = require('../src/lib/crypto');

const APPLY = process.argv.includes('--apply');

const line = (s = '') => console.log(s);
const hr = () => line('='.repeat(70));

(async () => {
  hr();
  line(`TOKEN ENCRYPTION BACKFILL — ${APPLY ? 'APPLY MODE (writes)' : 'REPORT ONLY (no writes)'}`);
  hr();

  const accounts = await prisma.instagramAccount.findMany({
    select: {
      id: true,
      igUsername: true,
      accessToken: true,
      tokenCiphertext: true,
      tokenIv: true,
      tokenAuthTag: true,
      tokenKeyVersion: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  line(`instagram_accounts rows: ${accounts.length}`);
  if (accounts.length === 0) {
    line('nothing to do.');
    hr();
    await prisma.$disconnect();
    return;
  }

  const needsEncryption = accounts.filter((a) => !a.tokenCiphertext && !looksEncrypted(a.accessToken));
  const alreadySplit = accounts.filter((a) => a.tokenCiphertext);
  const encryptedNotSplit = accounts.filter((a) => !a.tokenCiphertext && looksEncrypted(a.accessToken));

  line(`  already split (new columns populated): ${alreadySplit.length}`);
  line(`  encrypted but NOT split:               ${encryptedNotSplit.length}`);
  line(`  PLAIN TEXT, needs encryption:          ${needsEncryption.length}`);
  line();

  // ---- backfill --------------------------------------------------------
  let encrypted = 0;
  let split = 0;

  if (APPLY) {
    for (const account of needsEncryption) {
      const parts = encryptToParts(account.accessToken);
      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: {
          accessToken: `${parts.iv}:${parts.ciphertext}:${parts.authTag}`,
          tokenCiphertext: parts.ciphertext,
          tokenIv: parts.iv,
          tokenAuthTag: parts.authTag,
          tokenKeyVersion: parts.keyVersion,
        },
      });
      encrypted += 1;
      line(`  encrypted @${account.igUsername}`);
    }

    for (const account of encryptedNotSplit) {
      const [iv, ciphertext, authTag] = account.accessToken.split(':');
      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { tokenIv: iv, tokenCiphertext: ciphertext, tokenAuthTag: authTag, tokenKeyVersion: CURRENT_KEY_VERSION },
      });
      split += 1;
      line(`  split @${account.igUsername}`);
    }

    if (encrypted || split) line();
    line(`applied: ${encrypted} encrypted, ${split} split`);
  } else if (needsEncryption.length || encryptedNotSplit.length) {
    line(`would encrypt ${needsEncryption.length} and split ${encryptedNotSplit.length}. Re-run with --apply.`);
  }

  // ---- verification: decrypt EVERY row from the new columns -------------
  hr();
  line('VERIFICATION — decrypting every row from the new columns');
  hr();

  const after = await prisma.instagramAccount.findMany({
    select: {
      id: true,
      igUsername: true,
      accessToken: true,
      tokenCiphertext: true,
      tokenIv: true,
      tokenAuthTag: true,
      tokenKeyVersion: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  let ok = 0;
  let missing = 0;
  const failures = [];

  for (const a of after) {
    if (!a.tokenCiphertext || !a.tokenIv || !a.tokenAuthTag) {
      missing += 1;
      line(`  @${a.igUsername}: split columns NOT populated`);
      continue;
    }
    try {
      const plaintext = decryptFromParts({
        ciphertext: a.tokenCiphertext,
        iv: a.tokenIv,
        authTag: a.tokenAuthTag,
        keyVersion: a.tokenKeyVersion,
      });
      if (!plaintext || plaintext.length < 10) {
        failures.push({ user: a.igUsername, reason: `decrypted to an implausible ${plaintext ? plaintext.length : 0}-char value` });
        line(`  @${a.igUsername}: FAIL — implausible plaintext length`);
        continue;
      }
      // Shape check only; the value itself is never printed.
      line(`  @${a.igUsername}: OK (len=${plaintext.length}, prefix="${plaintext.slice(0, 3)}...")`);
      ok += 1;
    } catch (e) {
      failures.push({ user: a.igUsername, reason: e.message });
      line(`  @${a.igUsername}: FAIL — ${e.message}`);
    }
  }

  hr();
  line(`decrypted OK: ${ok}   failed: ${failures.length}   split columns missing: ${missing}`);
  if (failures.length === 0 && missing === 0 && after.length > 0) {
    line('');
    line('VERDICT: every row decrypts from the new columns.');
    line('         This environment is ready for stage 3 (drop access_token and the');
    line('         crypto.js plain-text passthrough) — but ONLY once EVERY other');
    line('         environment, production included, reports the same. See D3.');
  } else if (failures.length > 0) {
    line('');
    line('VERDICT: *** FAILURES PRESENT — DO NOT PROCEED TO STAGE 3 ***');
  } else if (missing > 0) {
    line('');
    line(`VERDICT: ${missing} row(s) still lack split columns. Re-run with --apply.`);
  }
  hr();

  await prisma.$disconnect();
  if (failures.length > 0) process.exit(1);
})().catch(async (e) => {
  console.error('BACKFILL FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
