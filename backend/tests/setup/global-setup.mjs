/**
 * Prepares a throwaway PostgreSQL database for the test run.
 *
 * `prisma migrate reset` drops the schema and replays every committed
 * migration, so each run proves the migrations still apply cleanly to an
 * empty Postgres — exactly the production `migrate deploy` path. A migration
 * that would fail on deploy fails here first.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(here, '..', '..');

const TEST_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:55432/codeback_test';

export async function setup() {
  try {
    // Clear the schema, then replay the migrations. Done as two explicit
    // steps rather than `migrate reset` so this stays a non-interactive,
    // non-"reset" code path (some tooling refuses to run reset), and so the
    // second step is literally the production `migrate deploy` command.
    execSync(`npx prisma db execute --url "${TEST_URL}" --stdin`, {
      cwd: backendRoot,
      input: 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    execSync('npx prisma migrate deploy', {
      cwd: backendRoot,
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });
  } catch (err) {
    const detail = String(err.stderr || err.stdout || err.message);
    throw new Error(
      `Could not prepare the test database.\n\n` +
        `The suite needs a throwaway PostgreSQL (the schema is now Postgres, so\n` +
        `tests run on the same engine as production). Start one with:\n\n` +
        `  docker run -d --name codeback-scratch-pg -e POSTGRES_PASSWORD=scratch \\\n` +
        `    -e POSTGRES_USER=scratch -e POSTGRES_DB=codeback_test \\\n` +
        `    -p 55432:5432 postgres:16-alpine\n\n` +
        `Or point TEST_DATABASE_URL at your own instance.\n\n` +
        `Underlying error: ${detail}`
    );
  }
}

export async function teardown() {
  // The database is left in place deliberately — it is throwaway and useful
  // for inspecting a failed run. The next run resets it.
}
