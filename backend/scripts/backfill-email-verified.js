/**
 * Grandfather existing password users to emailVerifiedAt = createdAt.
 *
 * WHY THIS IS A SCRIPT AND NOT PART OF THE MIGRATION.
 *
 * Marking an account email-verified without the owner ever proving the address
 * weakens the Google-linking guarantee for that account: the linking rule
 * refuses to auto-link a Google identity to a local account whose email is
 * unverified, precisely because an unverified address is an unproven claim.
 * Grandfathering asserts the claim on their behalf.
 *
 * That is a reasonable trade for accounts you know are your own test users. It
 * is NOT reasonable to do unattended, in every environment, to a list nobody
 * has looked at. A migration runs unattended. So this is a script with a human
 * review step in the middle of it.
 *
 * Usage:
 *   node scripts/backfill-email-verified.js            # report only, no writes
 *   node scripts/backfill-email-verified.js --apply    # perform the backfill
 *
 * Run the report FIRST and read the list. If any address belongs to a real
 * customer rather than a test account, stop and decide deliberately — the
 * alternative is to leave them unverified and let them confirm on next login,
 * which is friendlier to them and stricter for you.
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const APPLY = process.argv.includes('--apply');
const line = (s = '') => console.log(s);
const hr = () => line('='.repeat(72));

(async () => {
  hr();
  line(`EMAIL VERIFICATION BACKFILL — ${APPLY ? 'APPLY MODE (writes)' : 'REPORT ONLY (no writes)'}`);
  hr();

  const target = await prisma.user.findMany({
    where: {
      email: { not: null },
      passwordHash: { not: null },
      emailVerifiedAt: null,
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true, lastSeenAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const nullEmail = await prisma.user.count({ where: { email: null } });
  const alreadyVerified = await prisma.user.count({ where: { emailVerifiedAt: { not: null } } });

  line(`candidates (email + password, currently unverified): ${target.length}`);
  line(`already verified:                                    ${alreadyVerified}`);
  line(`null-email accounts (CANNOT be grandfathered):       ${nullEmail}`);
  line();

  if (nullEmail > 0) {
    line('NOTE: null-email accounts are excluded by definition — there is no address');
    line('      to grandfather. They hit the mandatory "add your email" step on next');
    line('      login and cannot be granted a trial until they confirm it.');
    line();
  }

  if (target.length === 0) {
    line('Nothing to do.');
    hr();
    await prisma.$disconnect();
    return;
  }

  line('REVIEW THIS LIST BEFORE APPLYING:');
  target.forEach((u, i) => {
    const seen = u.lastSeenAt ? u.lastSeenAt.toISOString().slice(0, 10) : 'never';
    line(
      `  ${String(i + 1).padStart(3)}. ${u.email}` +
        `\n       role=${u.role} created=${u.createdAt.toISOString().slice(0, 10)} lastSeen=${seen}`
    );
  });
  line();
  line('  ^ Any address here that is NOT one of your own test accounts is a real');
  line('    person being marked verified without ever confirming their address.');
  line();

  if (!APPLY) {
    line(`Report only. Re-run with --apply to grandfather these ${target.length} account(s).`);
    hr();
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const user of target) {
    // Conditional on still being null, so a concurrent genuine verification
    // is not overwritten with a backdated timestamp.
    const result = await prisma.user.updateMany({
      where: { id: user.id, emailVerifiedAt: null },
      data: { emailVerifiedAt: user.createdAt },
    });
    updated += result.count;
  }

  line(`Grandfathered ${updated} account(s) (emailVerifiedAt = createdAt).`);
  hr();

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('BACKFILL FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
