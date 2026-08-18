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

const prisma =
  globalForPrisma.__codebackPrisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__codebackPrisma = prisma;
}

module.exports = prisma;
