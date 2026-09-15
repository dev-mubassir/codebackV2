#!/usr/bin/env node
/**
 * billing:doctor — why can I not see the billing features?
 *
 * Almost every "nothing changed" moment in this project has had one of five
 * causes, and all five are invisible from the UI: a flag is off, a Cashfree
 * credential is missing, the database is behind the code, the Prisma client
 * is stale, or the plan catalogue is empty. Each one produces the same
 * symptom — a page that shows nothing — and none of them says so.
 *
 * This prints all five in one table so the question is answered in seconds
 * instead of by bisecting the stack.
 *
 * NEVER PRINTS A SECRET. Credentials are reported as present or absent and
 * nothing else — not a prefix, not a length, not a masked form. A masked
 * value is still a value, and this output is meant to be safe to paste into
 * a chat window or an issue.
 *
 *   npm run billing:doctor
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OK = 'OK';
const WARN = 'WARN';
const FAIL = 'FAIL';

const rows = [];
function add(status, check, detail) {
  rows.push({ status, check, detail });
}

/** Presence only. The value never leaves this function. */
function present(name) {
  return Boolean((process.env[name] || '').trim());
}

function flagState(name) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return { on: false, detail: 'unset -> false (default)' };
  return { on: raw === 'true', detail: raw === 'true' ? 'true' : `"${raw}" -> false (only "true" enables)` };
}

async function main() {
  // ---- 1. Flags -----------------------------------------------------------
  const billing = flagState('BILLING_ENABLED');
  const meta = flagState('META_APPROVED');
  const usd = flagState('USD_PRICING_ENABLED');

  add(billing.on ? OK : WARN, 'BILLING_ENABLED', billing.detail);
  add(meta.on ? OK : WARN, 'META_APPROVED', meta.detail);
  add(usd.on ? OK : WARN, 'USD_PRICING_ENABLED', usd.detail);

  // ---- 2. Cashfree credentials -------------------------------------------
  // CASHFREE_SECRET_KEY is BOTH the API secret and the webhook signing
  // secret — Cashfree does not issue a separate one. Missing it fails
  // checkout AND silently rejects every incoming webhook.
  for (const name of ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY']) {
    const have = present(name);
    add(
      have ? OK : billing.on ? FAIL : WARN,
      name,
      have ? 'present' : 'ABSENT' + (billing.on ? ' — billing is ON, so checkout will fail' : ' (billing is off, so not yet needed)')
    );
  }

  // ---- 3. Prisma client freshness ----------------------------------------
  // A client AHEAD of the database is the failure that broke Instagram
  // connect: Prisma SELECTs every column its schema declares, so a column
  // the database lacks makes those queries throw.
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const generatedPath = path.join(__dirname, '..', 'node_modules', '.prisma', 'client', 'schema.prisma');
  // Compare MEANING, not bytes. The generated client keeps a verbatim copy of
  // schema.prisma, so a hash of the raw file reports "stale" for a comment
  // edit that changes nothing about the client. A doctor that raises problems
  // which are not problems is one people learn to ignore — so comments and
  // blank lines are stripped before hashing, leaving only what actually
  // determines the generated shape.
  const normalize = (text) =>
    text
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join('\n');
  // Internal runs of spaces are collapsed as well as trimmed: Prisma's
  // generator RE-ALIGNS the schema's columns when it copies it, so
  // `id String` in the source becomes `id        String` in the generated
  // copy. Comparing those byte-for-byte reports every client as stale,
  // forever, which is worse than not checking at all.
  const hash = (p) =>
    fs.existsSync(p)
      ? crypto.createHash('sha256').update(normalize(fs.readFileSync(p, 'utf8'))).digest('hex')
      : null;
  const schemaHash = hash(schemaPath);
  const clientHash = hash(generatedPath);

  if (!clientHash) {
    add(FAIL, 'Prisma client', 'not generated — run: npx prisma generate');
  } else if (schemaHash !== clientHash) {
    add(FAIL, 'Prisma client', 'STALE vs schema.prisma — run: npx prisma generate');
  } else {
    add(OK, 'Prisma client', 'matches schema.prisma');
  }

  // ---- 4. Database ---------------------------------------------------------
  let prisma;
  try {
    prisma = require('../src/lib/prisma');
    const { checkMigrations } = require('../src/lib/migrationGuard');
    const result = await checkMigrations();

    if (result.unreachable) {
      add(FAIL, 'Database', `unreachable — ${result.error}`);
    } else if (!result.ok) {
      add(FAIL, 'Migrations', `${result.missing.length} not applied: ${result.missing.join(', ')}`);
      add(WARN, '  -> fix', 'npx prisma migrate deploy  (see docs/ENV-SETUP.md)');
    } else {
      add(OK, 'Migrations', 'database matches the migration directory');
    }

    // ---- 5. Catalogue ------------------------------------------------------
    if (!result.unreachable && result.ok) {
      const [plans, planPrices, packs, packPrices, igPrices] = await Promise.all([
        prisma.plan.count(),
        prisma.planPrice.count(),
        prisma.addonPack.count(),
        prisma.addonPackPrice.count(),
        prisma.extraIgAccountPrice.count(),
      ]);
      add(
        plans > 0 && planPrices > 0 ? OK : FAIL,
        'Plan catalogue',
        `${plans} plans, ${planPrices} plan prices, ${packs} add-on pack(s) with ${packPrices} prices, ${igPrices} extra-account prices`
      );
      if (plans > 0 && planPrices === 0) {
        add(FAIL, '  -> note', 'plans exist but have no prices — the pricing page will render nothing');
      }

      // ---- 6. Ledger invariant ---------------------------------------------
      // No operation may change credits without writing a ledger row. When
      // one does, the ledger — the record a disputed balance is checked
      // against — silently stops adding up, and nothing else notices. So sum
      // every tenant's ledger and compare it with the balance the entitlement
      // actually holds. CLASSIFY rows carry delta 0 and change nothing.
      const drift = await prisma.$queryRawUnsafe(`
        SELECT e.user_id AS tenant,
               e.reply_credits_current + e.reply_credits_banked AS balance,
               COALESCE(SUM(l.delta), 0)::int AS ledger
          FROM entitlements e
          LEFT JOIN credit_ledger l ON l.tenant_id = e.user_id
         GROUP BY e.user_id, e.reply_credits_current, e.reply_credits_banked
        HAVING e.reply_credits_current + e.reply_credits_banked <> COALESCE(SUM(l.delta), 0)`);
      const entitlementCount = await prisma.entitlement.count();

      if (drift.length === 0) {
        add(OK, 'Ledger invariant', `${entitlementCount} entitlement(s): every balance equals its ledger sum`);
      } else {
        add(FAIL, 'Ledger invariant', `${drift.length} of ${entitlementCount} entitlement(s) disagree with their ledger`);
        for (const d of drift.slice(0, 5)) {
          const gap = Number(d.balance) - Number(d.ledger);
          add(
            FAIL,
            '  -> drift',
            `tenant ${String(d.tenant).slice(0, 8)}: balance ${d.balance}, ledger sum ${d.ledger} — ${Math.abs(gap)} credit(s) ${gap > 0 ? 'held with no ledger row' : 'recorded but not held'}`
          );
        }
        if (drift.length > 5) add(FAIL, '  -> drift', `…and ${drift.length - 5} more`);
      }
    }
  } catch (err) {
    add(FAIL, 'Database', err.message.split('\n').pop().trim());
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
  }

  // ---- Render -------------------------------------------------------------
  const w1 = Math.max(...rows.map((r) => r.check.length), 10);
  console.log('');
  console.log('  Siffty billing readiness');
  console.log('  ' + '-'.repeat(w1 + 60));
  for (const r of rows) {
    console.log(`  ${r.status.padEnd(5)} ${r.check.padEnd(w1)}  ${r.detail}`);
  }
  console.log('  ' + '-'.repeat(w1 + 60));

  const fails = rows.filter((r) => r.status === FAIL).length;
  if (!billing.on) {
    console.log('  BILLING_ENABLED is off, so /billing and /api/billing/* return 404 and the');
    console.log('  billing nav entry is hidden. That is the intended pre-launch state, not a bug.');
  }
  if (fails > 0) {
    console.log(`  ${fails} blocking problem(s) above.`);
  }
  console.log('');

  // Non-zero only for real problems, so this is usable in a deploy check.
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[billing:doctor] failed:', err.message);
  process.exit(1);
});
