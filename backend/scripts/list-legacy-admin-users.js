#!/usr/bin/env node
/**
 * READ-ONLY. Lists the legacy admin identities still in `users` — rows with
 * role = 'ADMIN' and the fake admin@codeback.internal row — as ids and emails
 * only, plus how many old admin_logs rows each authored. Writes nothing.
 *
 *   cd backend && node scripts/list-legacy-admin-users.js
 *
 * Input for prisma/pending-approval/20260924130000_retire_legacy_admin_users.
 * The database URL is never printed.
 */

require('dotenv').config({ quiet: true });

const { scrub } = require('./lib/adminCli');

async function main() {
  const prisma = require('../src/lib/prisma');
  const rows = await prisma.user.findMany({
    where: { OR: [{ role: 'ADMIN' }, { email: 'admin@codeback.internal' }] },
    select: { id: true, email: true, role: true, _count: { select: { adminLogs: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length === 0) console.log('No legacy admin rows.');
  for (const r of rows) console.log(`${r.id}  ${r.email || '(no email)'}  role=${r.role}  admin_logs=${r._count.adminLogs}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(`ERROR: ${scrub(err && err.message)}`);
  process.exit(1);
});
