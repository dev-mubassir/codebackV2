/**
 * Cutover step 5: prove the copied TOKEN_ENCRYPTION_KEY and IG_IDENTITY_PEPPER
 * match the imported data, without reading them. Prints counts and PASS/FAIL.
 *   northflank exec service api --cmd 'node src/cli/secretSelfCheck.js'
 * Exit code 0 on PASS, 1 on FAIL.
 */
require('../lib/dbUrl').applyDatabaseUrl();
const prisma = require('../lib/prisma');
const { runSecretSelfCheck } = require('../lib/secretSelfCheck');

runSecretSelfCheck()
  .then((r) => {
    console.log(`tokens:     ${r.tokens.decryptable}/${r.tokens.total} decrypt (${r.tokens.percent}%)`);
    console.log(`identities: ${r.identities.matched}/${r.identities.accounts} recompute (${r.identities.percent}%), ledger rows ${r.identities.ledgerRows}`);
    console.log(r.pass ? 'PASS' : 'FAIL');
    process.exitCode = r.pass ? 0 : 1;
  })
  .catch((err) => {
    console.error('self-check error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
