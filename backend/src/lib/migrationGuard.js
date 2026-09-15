/**
 * Refuses to serve traffic when the database is behind the code.
 *
 * WHY THIS EXISTS. Deploys and migrations are decoupled here, deliberately:
 * pushing to master auto-deploys the code on Northflank, while
 * `prisma migrate deploy` is run BY HAND in the service shell
 * (docs/DEPLOYMENT-RUNBOOK.md, PHASE 4 — "Manually, in the service shell.
 * Never on container start"). There is no release command and no entrypoint
 * migration. That gap is correct — an automatic migration on container start
 * is its own class of outage — but it means there is always a window where
 * new code is live against the old schema, and the window stays open
 * indefinitely if someone forgets.
 *
 * WHAT THAT FAILURE LOOKS LIKE, because it already happened once locally:
 * Prisma Client selects every column a model declares. A client generated
 * from a schema with `entitlements.region_source` will emit that column in
 * its SELECT, and against a database that does not have it yet EVERY
 * full-row entitlement query throws. `claimInstagramIdentity()` reads and
 * writes the full row inside a transaction, so the transaction aborts and
 * **Instagram connect fails for every user** — with billing switched off,
 * because the trial grant is not behind BILLING_ENABLED and never should be.
 * The service looks healthy. `/health` returns 200. Only connect is broken,
 * and nothing says why.
 *
 * A process that refuses to start is a loud, obvious, immediately-diagnosed
 * failure. A process that serves a broken connect flow is a silent one that
 * costs signups until someone reports it.
 *
 * THIS DOES NOT RUN MIGRATIONS. It only reports. Running them from here
 * would reintroduce exactly the container-start migration the runbook rules
 * out.
 */

const fs = require('fs');
const path = require('path');
const prisma = require('./prisma');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'prisma', 'migrations');

/** Migration folder names on disk, in apply order. */
function migrationsOnDisk() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Migration names the database considers applied.
 *
 * `rolled_back_at IS NULL` matters: a migration that failed and was marked
 * rolled back has a row, but its SQL did not take effect, so counting it as
 * applied would defeat the whole check.
 */
async function migrationsApplied() {
  const rows = await prisma.$queryRaw`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  return new Set(rows.map((r) => r.migration_name));
}

/**
 * @returns {Promise<{ok: boolean, missing: string[], unreachable?: boolean}>}
 */
async function checkMigrations() {
  const onDisk = migrationsOnDisk();
  if (onDisk.length === 0) return { ok: true, missing: [] };

  let applied;
  try {
    applied = await migrationsApplied();
  } catch (err) {
    // Cannot-connect is NOT the same as known-behind, and the two deserve
    // different answers. A database that is briefly unreachable at boot is a
    // transient condition the app already handles per-request; refusing to
    // start would turn a blip into an outage that needs a human. Only a
    // database we can actually read, and which is definitively behind, is
    // fatal.
    return { ok: true, missing: [], unreachable: true, error: err.message };
  }

  const missing = onDisk.filter((name) => !applied.has(name));
  return { ok: missing.length === 0, missing };
}

/**
 * Fail closed at boot. Call BEFORE server.listen().
 *
 * Exits the process rather than throwing, so the failure cannot be swallowed
 * by a caller's try/catch and turned back into a silently-serving process.
 */
async function assertMigrationsCurrent() {
  const result = await checkMigrations();

  if (result.unreachable) {
    console.warn('[Server] WARNING: could not verify migration state — the database was unreachable at boot.');
    console.warn(`[Server]          ${result.error}`);
    console.warn('[Server]          Starting anyway; a transient blip must not become an outage.');
    return;
  }

  if (result.ok) return;

  console.error('[Server] FATAL: the database is BEHIND the code. Refusing to serve traffic.');
  console.error('[Server]');
  console.error(`[Server] ${result.missing.length} migration(s) applied to the code but not to this database:`);
  for (const name of result.missing) console.error(`[Server]     - ${name}`);
  console.error('[Server]');
  console.error('[Server] Prisma Client selects every column its schema declares, so against an');
  console.error('[Server] older database those queries throw. In practice that breaks Instagram');
  console.error('[Server] connect for every user while /health still returns 200 — a silent');
  console.error('[Server] failure, which is why this refuses to start instead.');
  console.error('[Server]');
  console.error('[Server] Fix: run the migration in the service shell, then redeploy:');
  console.error('[Server]     ./node_modules/.bin/prisma migrate deploy');
  console.error('[Server] See docs/DEPLOYMENT-RUNBOOK.md PHASE 4 and docs/ENV-SETUP.md.');
  process.exit(1);
}

module.exports = { assertMigrationsCurrent, checkMigrations, migrationsOnDisk };
