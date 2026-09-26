/**
 * Exact row count per public table — the cutover's "counts must match" check
 * (compare with deploy/cutover/row-counts.sql run on the old database).
 *   northflank exec service api --cmd 'node src/cli/rowCounts.js'
 * Counts only; no row content is read.
 */
require('../lib/dbUrl').applyDatabaseUrl();
const prisma = require('../lib/prisma');

(async () => {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  for (const { tablename } of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::bigint AS n FROM public."${tablename.replace(/"/g, '""')}"`);
    console.log(`${tablename.padEnd(40)} ${n}`);
  }
})()
  .catch((err) => {
    console.error('row count error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
