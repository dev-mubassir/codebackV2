#!/usr/bin/env node
/**
 * Create a super-admin (admin_users). RUN BY THE OWNER ONLY, interactively.
 *
 *   cd backend && node scripts/create-admin.js
 *
 * Asks for the email (shown) and password (hidden, twice, at least 16
 * characters). Uses DATABASE_URL from the environment — in production that is
 * already set in the Northflank service; locally it comes from backend/.env.
 * The URL is never printed. See ADMIN.md.
 *
 * Refuses if the email already has an admin account: use
 * reset-admin-password.js for that. There is no HTTP route that creates an
 * admin, by design.
 */

require('dotenv').config({ quiet: true });

const { requireTty, promptVisible, normalizeEmail, promptNewPassword, fail, scrub } = require('./lib/adminCli');

async function main() {
  requireTty();
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set in this environment.');

  const prisma = require('../src/lib/prisma');
  const { hashPassword } = require('../src/lib/password');

  console.log(`Create a Siffty admin (NODE_ENV=${process.env.NODE_ENV || 'development'})\n`);
  const email = normalizeEmail(await promptVisible('Admin email: '));

  const existing = await prisma.adminUser.findUnique({ where: { email }, select: { id: true } });
  if (existing) fail('An admin with that email already exists. Use scripts/reset-admin-password.js instead.');

  const password = await promptNewPassword();
  const admin = await prisma.adminUser.create({
    data: { email, passwordHash: await hashPassword(password) },
    select: { id: true, email: true },
  });
  await prisma.adminAuditLog.create({
    data: { adminId: admin.id, action: 'ADMIN_CREATED_CLI', targetType: 'ADMIN_USER', targetId: admin.id, userAgent: 'scripts/create-admin.js' },
  });

  console.log(`\nCreated admin ${admin.email}. Sign in at /admin/login.`);
  await prisma.$disconnect();
}

main().catch((err) => fail(scrub(err && err.message)));
