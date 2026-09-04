/**
 * PRODUCTION READ-ONLY SURVEY — Gate 1 migration preconditions.
 *
 * =========================================================================
 *  SAFETY CONTRACT — read this before running.
 *
 *  - Every statement below is a SELECT. There are no INSERT / UPDATE /
 *    DELETE / ALTER / CREATE / DROP statements anywhere in this file.
 *  - No explicit transaction is opened. Each SELECT takes only an
 *    ACCESS SHARE lock, which does not block reads or writes.
 *  - Nothing is written to disk. Output goes to stdout only.
 *  - Emails are reduced to their DOMAIN before printing, so the output is
 *    safe to paste back into a chat transcript.
 *  - Access tokens are NEVER printed, in any form.
 *
 *  You can verify all of the above by reading the SQL strings below.
 * =========================================================================
 *
 * USAGE — one command, with DATABASE_URL pointed at production:
 *
 *   DATABASE_URL="<northflank-postgres-url>" node scripts/prod-readonly-survey.js
 *
 * This file deliberately does NOT load .env, so it cannot silently read the
 * local dev database and present dev numbers as production ones.
 */

const { PrismaClient } = require('@prisma/client');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run with it pointed at production:');
  console.error('  DATABASE_URL="<url>" node scripts/prod-readonly-survey.js');
  process.exit(1);
}

// Show which host we reached, with credentials stripped, so the output is
// self-identifying and dev numbers cannot be mistaken for prod numbers.
function describeTarget(url) {
  try {
    const u = new URL(url);
    const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
    return { host: u.hostname, port: u.port || '5432', db: u.pathname.replace(/^\//, ''), local };
  } catch {
    return { host: '(unparseable)', port: '?', db: '?', local: false };
  }
}

const prisma = new PrismaClient();
const line = (s = '') => console.log(s);
const hr = () => line('='.repeat(72));
const n = (v) => Number(v ?? 0);

(async () => {
  const t = describeTarget(process.env.DATABASE_URL);

  hr();
  line('CODEBACK — PRODUCTION READ-ONLY SURVEY (Gate 1 preconditions)');
  hr();
  line(`target host : ${t.host}:${t.port}`);
  line(`database    : ${t.db}`);
  line(`run at      : ${new Date().toISOString()}`);
  if (t.local) {
    line('');
    line('!! WARNING: this is a LOCALHOST database. These are DEV numbers,');
    line('!! not production. Re-run with the Northflank DATABASE_URL.');
  }
  line();

  // --- Q0: migration history and table inventory -----------------------
  // Dev turned out to be DRIFTED: it still carries three Cashfree billing
  // migrations whose files were deleted by the revert, plus orphan tables
  // (plans, processed_webhook_events), and it never received
  // 20260903120000_remove_subscription_and_usage. If production is in the
  // same state, "clean dev" stops representing prod and prod needs its own
  // cleanup path.
  hr();
  line('Q0 — MIGRATION HISTORY AND TABLE INVENTORY');
  hr();

  const [hasMigrationsTable] = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
    ) AS present
  `;

  if (!hasMigrationsTable.present) {
    line('_prisma_migrations does not exist — no migration has ever been applied here.');
  } else {
    const applied = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
      ORDER BY finished_at NULLS LAST
    `;
    line(`applied migrations: ${applied.length}`);
    applied.forEach((m) => {
      const when = m.finished_at ? new Date(m.finished_at).toISOString().slice(0, 19) : 'UNFINISHED';
      const rb = m.rolled_back_at ? '  [ROLLED BACK]' : '';
      line(`  ${when}  ${m.migration_name}${rb}`);
    });
    line();

    // The four migration names that SHOULD exist in a repo-consistent database.
    const expected = [
      '20260830062002_baseline_postgres',
      '20260830062547_webhook_log_cascade_on_account_delete',
      '20260903120000_remove_subscription_and_usage',
      '20260904160000_auth_hardening_baseline',
    ];
    const names = applied.map((m) => m.migration_name);
    const phantom = names.filter((x) => !expected.includes(x));
    const missing = expected.filter((x) => !names.includes(x));

    line(`PHANTOM (applied here, no file in repo): ${phantom.length}`);
    phantom.forEach((x) => line(`    ${x}`));
    line(`MISSING (in repo, not applied here):     ${missing.length}`);
    missing.forEach((x) => line(`    ${x}`));
    line();
    line(
      phantom.length === 0
        ? '  VERDICT: no phantom migrations — history matches the repo.'
        : '  VERDICT: DRIFTED, same as dev. Production needs its own cleanup path;'
    );
    if (phantom.length > 0) {
      line('           a clean dev database no longer represents production.');
    }
  }
  line();

  const allTables = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const tableNames = allTables.map((r) => r.table_name);
  line(`tables present (${tableNames.length}): ${tableNames.join(', ')}`);
  line();

  const orphans = ['plans', 'processed_webhook_events', 'usage_events'].filter((x) =>
    tableNames.includes(x)
  );
  line(`ORPHAN BILLING TABLES PRESENT: ${orphans.length ? orphans.join(', ') : 'none'}`);
  if (tableNames.includes('subscriptions')) {
    // Distinguish the OLD billing shape from the NEW trial-only shape.
    const subCols = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'subscriptions'
      ORDER BY column_name
    `;
    const cols = subCols.map((c) => c.column_name);
    const isOld = cols.includes('plan_id') || cols.includes('provider_subscription_id');
    line(`subscriptions table: PRESENT — ${isOld ? 'OLD billing shape' : 'new trial-only shape'}`);
    line(`  columns: ${cols.join(', ')}`);
  } else {
    line('subscriptions table: absent');
  }

  // --- does the schema even exist? ------------------------------------
  const tables = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'instagram_accounts', 'messages')
    ORDER BY table_name
  `;
  const found = tables.map((r) => r.table_name);
  if (found.length < 3) {
    hr();
    line('SCHEMA NOT PRESENT');
    hr();
    line(`expected: users, instagram_accounts, messages`);
    line(`found:    ${found.length ? found.join(', ') : '(none)'}`);
    line();
    line('VERDICT: migrations have not been applied to this database.');
    line('         If this is production, it is not deployed — the Gate 1');
    line('         production-safety question dissolves. Proceed on dev numbers.');
    hr();
    await prisma.$disconnect();
    return;
  }

  // --- Q5: email verification backfill scope ---------------------------
  hr();
  line('Q5 — USERS: email verification backfill scope');
  hr();

  const [userCounts] = await prisma.$queryRaw`
    SELECT
      COUNT(*)                                                            AS total,
      COUNT(*) FILTER (WHERE password_hash IS NOT NULL AND email IS NOT NULL) AS password_users,
      COUNT(*) FILTER (WHERE email IS NULL)                               AS null_email_users,
      COUNT(*) FILTER (WHERE password_hash IS NULL AND email IS NOT NULL) AS email_no_password
    FROM users
  `;

  line(`total users:                            ${n(userCounts.total)}`);
  line(`password users (email + passwordHash):  ${n(userCounts.password_users)}   <- grandfather candidates`);
  line(`null-email users (IG-created):          ${n(userCounts.null_email_users)}   <- forced "add your email"`);
  line(`email but no passwordHash:              ${n(userCounts.email_no_password)}`);
  line();

  // Domain-only, aggregated. Individual addresses are never printed.
  const domains = await prisma.$queryRaw`
    SELECT
      LOWER(SPLIT_PART(email, '@', 2)) AS domain,
      COUNT(*)                         AS count,
      MIN(created_at)                  AS first_created,
      MAX(created_at)                  AS last_created
    FROM users
    WHERE password_hash IS NOT NULL AND email IS NOT NULL
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
  `;

  line('GRANDFATHER CANDIDATES BY EMAIL DOMAIN (addresses redacted):');
  if (domains.length === 0) {
    line('  (none)');
  } else {
    domains.forEach((d) => {
      line(
        `  @${d.domain}  count=${n(d.count)}` +
          `  first=${new Date(d.first_created).toISOString().slice(0, 10)}` +
          `  last=${new Date(d.last_created).toISOString().slice(0, 10)}`
      );
    });
    line();
    line('  ^ Any domain here that is NOT your own test domain is a real');
    line('    customer who would be marked email-verified without verifying.');
  }
  line();

  const [internal] = await prisma.$queryRaw`
    SELECT COUNT(*) AS c FROM users WHERE email = 'admin@codeback.internal'
  `;
  line(`synthetic admin sentinel rows (admin@codeback.internal): ${n(internal.c)}`);

  // --- Q6: plaintext vs encrypted tokens -------------------------------
  hr();
  line('Q6 — INSTAGRAM TOKENS: plaintext vs encrypted');
  hr();

  // crypto.js stores `${iv}:${ciphertext}:${tag}`. Anything without exactly
  // two colons was never encrypted. Token VALUES are never selected.
  const [tokenCounts] = await prisma.$queryRaw`
    SELECT
      COUNT(*)                                                                     AS total,
      COUNT(*) FILTER (WHERE LENGTH(access_token) - LENGTH(REPLACE(access_token, ':', '')) = 2) AS encrypted,
      COUNT(*) FILTER (WHERE LENGTH(access_token) - LENGTH(REPLACE(access_token, ':', '')) <> 2) AS plaintext
    FROM instagram_accounts
  `;

  line(`total InstagramAccount rows:            ${n(tokenCounts.total)}`);
  line(`  encrypted (iv:ct:tag):                ${n(tokenCounts.encrypted)}`);
  line(`  PLAINTEXT / non-conforming:           ${n(tokenCounts.plaintext)}`);
  line();

  if (n(tokenCounts.plaintext) > 0) {
    // Shape only: length + prefix class. Never the value.
    const shapes = await prisma.$queryRaw`
      SELECT
        LENGTH(access_token)      AS len,
        LEFT(access_token, 3)     AS prefix,
        connection_status,
        token_status
      FROM instagram_accounts
      WHERE LENGTH(access_token) - LENGTH(REPLACE(access_token, ':', '')) <> 2
      ORDER BY created_at ASC
      LIMIT 20
    `;
    line('PLAINTEXT ROW SHAPES (values NOT selected; prefix is 3 chars only):');
    shapes.forEach((s, i) => {
      const plausible = n(s.len) > 50 && /^(IG|EAA)/.test(s.prefix);
      line(
        `  ${i + 1}. len=${n(s.len)} prefix="${s.prefix}..." ${s.connection_status}/${s.token_status}` +
          `  -> ${plausible ? 'PLAUSIBLE IG token' : 'does NOT look like an IG token'}`
      );
    });
    line();
    line('  VERDICT: backfill REQUIRED before the crypto.js passthrough can be removed.');
  } else {
    line('  VERDICT: no plaintext tokens. Nothing to backfill.');
  }

  // --- P5: null mids ---------------------------------------------------
  hr();
  line('P5 — MESSAGE DEDUPE: null ig_message_id');
  hr();

  const [midCounts] = await prisma.$queryRaw`
    SELECT
      COUNT(*)                                                          AS total,
      COUNT(*) FILTER (WHERE ig_message_id IS NULL)                     AS null_mid,
      COUNT(*) FILTER (WHERE ig_message_id IS NULL AND direction = 'inbound')  AS null_inbound,
      COUNT(*) FILTER (WHERE ig_message_id IS NULL AND direction = 'outbound') AS null_outbound
    FROM messages
  `;

  line(`total messages:                ${n(midCounts.total)}`);
  line(`  with a mid:                  ${n(midCounts.total) - n(midCounts.null_mid)}`);
  line(`  NULL mid (no dedupe today):  ${n(midCounts.null_mid)}   inbound=${n(midCounts.null_inbound)} outbound=${n(midCounts.null_outbound)}`);
  line();
  line(
    n(midCounts.null_mid) === 0
      ? '  VERDICT: safe to add NOT NULL. Zero rows need a synthetic key.'
      : `  VERDICT: ${n(midCounts.null_mid)} rows need a synthetic dedupe key BEFORE any NOT NULL constraint.`
  );

  // --- Q4 (new): the check that can actually fail the migration --------
  hr();
  line('Q4 — ig_one_active_link PRECONDITION (the migration-breaking one)');
  hr();

  const conflicts = await prisma.$queryRaw`
    SELECT ig_user_id, COUNT(*) AS connected_rows
    FROM instagram_accounts
    WHERE connection_status = 'CONNECTED'
    GROUP BY ig_user_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;

  const [spread] = await prisma.$queryRaw`
    SELECT
      COUNT(DISTINCT ig_user_id)                                        AS distinct_ig_users,
      COUNT(*)                                                          AS total_rows,
      COUNT(*) FILTER (WHERE connection_status = 'CONNECTED')           AS connected_rows,
      COUNT(*) FILTER (WHERE connection_status = 'DISCONNECTED')        AS disconnected_rows
    FROM instagram_accounts
  `;

  line(`distinct ig_user_id values:    ${n(spread.distinct_ig_users)}`);
  line(`total rows:                    ${n(spread.total_rows)}`);
  line(`  CONNECTED:                   ${n(spread.connected_rows)}`);
  line(`  DISCONNECTED:                ${n(spread.disconnected_rows)}`);
  line();
  line(`ig_user_id with >1 CONNECTED row: ${conflicts.length}`);
  if (conflicts.length > 0) {
    conflicts.forEach((c, i) => {
      line(`  ${i + 1}. ig_user_id=${c.ig_user_id} has ${n(c.connected_rows)} CONNECTED rows`);
    });
    line();
    line('  VERDICT: BLOCKED. CREATE UNIQUE INDEX ig_one_active_link WILL FAIL.');
    line('           These rows must be resolved before the migration runs.');
  } else {
    line('  VERDICT: ig_one_active_link will build cleanly.');
  }

  hr();
  line('END OF SURVEY — no rows were modified.');
  hr();

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('SURVEY FAILED:', e.message);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
