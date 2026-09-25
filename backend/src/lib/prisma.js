/**
 * Shared Prisma Client singleton.
 *
 * Every route/service/worker in the backend must import the client from
 * here instead of doing `new PrismaClient()` locally. Instantiating many
 * clients (one per route file, as the codebase used to do) opens a new
 * connection pool per instance, which wastes connections and can exhaust
 * SQLite's file handles / a production Postgres connection pool under load.
 */

const { PrismaClient } = require('@prisma/client');

// Reuse a single instance across hot-reloads in dev (node --watch) too.
const globalForPrisma = globalThis;

/**
 * Connection-pool caps, applied in production when DATABASE_URL does not set
 * its own. Prisma's default is (CPU count x 2 + 1) — and a container reports
 * the HOST's CPU count, so an unset pool can open dozens of connections per
 * instance and exhaust Postgres the moment the API scales out.
 *
 * Budget per API instance (see MIGRATION_LOG.md for the full math):
 *   Prisma 5 + user-session pg pool 3 + admin-session pg pool 2 + scheduler
 *   lock pool 2 = 12 connections at most.
 *
 * DB_POOL_SIZE overrides the Prisma share. Outside production nothing is
 * added, so tests and local dev keep Prisma's default.
 */
const PRISMA_POOL_DEFAULT = 5;
const PRISMA_POOL_TIMEOUT_S = 20;

function withPoolDefaults(url) {
  if (!url || process.env.NODE_ENV !== 'production') return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url; // not a URL Prisma would accept either; let it report that
  }
  const size = parseInt(process.env.DB_POOL_SIZE || '', 10);
  if (!parsed.searchParams.has('connection_limit')) {
    parsed.searchParams.set('connection_limit', String(Number.isFinite(size) && size > 0 ? size : PRISMA_POOL_DEFAULT));
  }
  if (!parsed.searchParams.has('pool_timeout')) {
    parsed.searchParams.set('pool_timeout', String(PRISMA_POOL_TIMEOUT_S));
  }
  return parsed.toString();
}

function prismaPoolSize() {
  try {
    return Number(new URL(withPoolDefaults(process.env.DATABASE_URL)).searchParams.get('connection_limit')) || null;
  } catch {
    return null;
  }
}

const datasourceUrl = withPoolDefaults(process.env.DATABASE_URL);

const prisma =
  globalForPrisma.__codebackPrisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn'],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__codebackPrisma = prisma;
}

module.exports = prisma;
module.exports.withPoolDefaults = withPoolDefaults;
module.exports.prismaPoolSize = prismaPoolSize;
