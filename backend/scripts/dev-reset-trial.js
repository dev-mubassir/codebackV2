#!/usr/bin/env node
/**
 * DEV ONLY — NEVER RUN AGAINST PRODUCTION.
 *
 * Clears trialConsumedAt on ONE Instagram identity so the trial path can be
 * re-tested locally.
 *
 * WHY THIS IS DANGEROUS ANYWHERE ELSE. trialConsumedAt is the only thing that
 * stops "delete your account and sign up again" from being an unlimited free
 * trial. It survives account deletion by design. Clearing it in production
 * hands that Instagram account a second free trial, and there is no record
 * afterwards that it ever had a first one.
 *
 * So the script refuses to run unless BOTH hold:
 *   - NODE_ENV is not "production"
 *   - DATABASE_URL points at localhost
 * and it is a dry run unless --apply is passed.
 *
 * Usage (from backend/):
 *   node scripts/dev-reset-trial.js @instagram_username                 dry run: show what would change
 *   node scripts/dev-reset-trial.js @instagram_username --apply         clear the stamp
 *   node scripts/dev-reset-trial.js --ig-user-id 1784... --apply
 *   ... --apply --delete-entitlement   also delete the entitlement of the user that
 *                                      account is connected to (a user already TRIALING
 *                                      would otherwise not be re-granted — the grant
 *                                      never resets an existing trial or plan)
 *
 * See docs/ENV-SETUP.md §5.5.
 */

// Load backend/.env from THIS file's location, not the working directory. Run
// from anywhere else, a cwd-relative load finds no DATABASE_URL and the guard
// below refuses — safe, but it made the documented command fail for no reason.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function refuse(message, code = 2) {
  console.error(`\n  REFUSED: ${message}\n`);
  process.exit(code);
}

if (process.env.NODE_ENV === 'production') {
  refuse('NODE_ENV is "production". This script is for local development only.');
}

let dbHost;
try {
  dbHost = new URL(process.env.DATABASE_URL).hostname;
} catch {
  refuse('DATABASE_URL is missing or unparseable.');
}
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
if (!LOCAL_HOSTS.has(dbHost)) {
  refuse(`DATABASE_URL points at "${dbHost}", not a local database. This script only runs against localhost.`);
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const deleteEntitlement = args.includes('--delete-entitlement');
const idFlagAt = args.indexOf('--ig-user-id');
const igUserIdArg = idFlagAt >= 0 ? args[idFlagAt + 1] : null;
const username = (args.find((a) => a.startsWith('@')) || '').slice(1) || null;

if (!igUserIdArg && !username) {
  refuse('pass an Instagram @username or --ig-user-id <id>. See the header of this file.', 1);
}
if (deleteEntitlement && !apply) {
  refuse('--delete-entitlement only makes sense with --apply.', 1);
}

const prisma = require('../src/lib/prisma');
const { hashIgUserId } = require('../src/lib/igIdentity');

(async () => {
  const where = username ? { igUsername: username } : { igUserId: String(igUserIdArg) };
  const accounts = await prisma.instagramAccount.findMany({
    where,
    select: { igUserId: true, igUsername: true, userId: true, connectionStatus: true },
  });

  let igUserId = igUserIdArg ? String(igUserIdArg) : null;
  if (username) {
    const ids = [...new Set(accounts.map((a) => a.igUserId))];
    if (ids.length === 0) refuse(`no Instagram account @${username} in this database.`);
    if (ids.length > 1) refuse(`@${username} maps to ${ids.length} different Instagram ids — pass --ig-user-id instead.`);
    igUserId = ids[0];
  }

  const igUserIdHash = hashIgUserId(igUserId);
  const identity = await prisma.instagramIdentity.findUnique({ where: { igUserIdHash } });
  if (!identity) {
    refuse('no identity ledger row for that account — it has never been connected here, so there is nothing to reset.');
  }

  const connected = accounts.filter((a) => a.connectionStatus === 'CONNECTED');
  console.log(`\n  Instagram identity ${username ? '@' + username : '…' + igUserId.slice(-4)}  (database host: ${dbHost})`);
  console.log(`    trialConsumedAt  ${identity.trialConsumedAt ? identity.trialConsumedAt.toISOString() : 'not set'}`);
  console.log(`    blockedAt        ${identity.blockedAt ? identity.blockedAt.toISOString() : 'not set'}   (never changed by this script)`);
  console.log(`    linkCount        ${identity.linkCount}`);
  for (const a of connected) {
    const e = await prisma.entitlement.findUnique({ where: { userId: a.userId }, select: { planCode: true, status: true } });
    console.log(`    connected to user ${a.userId.slice(0, 8)}  entitlement: ${e ? `${e.planCode} / ${e.status}` : 'none'}`);
  }

  if (!apply) {
    console.log('\n  Dry run — nothing changed. Re-run with --apply to clear trialConsumedAt.\n');
    await prisma.$disconnect();
    return;
  }

  await prisma.instagramIdentity.update({ where: { igUserIdHash }, data: { trialConsumedAt: null } });
  console.log('\n  Cleared trialConsumedAt.');

  if (deleteEntitlement) {
    for (const a of connected) {
      // Deleting a row that still holds credits would leave the ledger showing
      // a balance nothing holds — exactly the drift billing:doctor reports.
      // Write the discard first, then delete, in one transaction.
      await prisma.$transaction(async (tx) => {
        const e = await tx.entitlement.findUnique({ where: { userId: a.userId } });
        if (!e) return;
        const balance = e.replyCreditsCurrent + e.replyCreditsBanked;
        if (balance > 0) {
          await tx.creditLedger.create({
            data: { tenantId: a.userId, delta: -balance, type: 'EXPIRE', source: 'expire:dev_reset_trial', balanceAfter: 0 },
          });
        }
        await tx.entitlement.delete({ where: { userId: a.userId } });
        console.log(`  Deleted the entitlement for user ${a.userId.slice(0, 8)}${balance > 0 ? ` (EXPIRE row written for ${balance} credits)` : ''}.`);
      });
    }
  }

  console.log('\n  Next: in the app, disconnect that Instagram account and connect it again.\n');
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('\n  FAILED:', err.message, '\n');
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
