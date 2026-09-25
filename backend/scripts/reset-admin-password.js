#!/usr/bin/env node
/**
 * Reset a lost admin password. RUN BY THE OWNER ONLY, interactively.
 *
 *   cd backend && node scripts/reset-admin-password.js
 *
 * Sets a new password (hidden, twice, at least 16 characters), clears any
 * lockout, and signs out EVERY session of that admin — both by moving
 * passwordChangedAt (which requireAdmin checks) and by deleting their rows
 * from admin_sessions. The database URL is never printed. See ADMIN.md.
 */

require('dotenv').config({ quiet: true });

const { requireTty, promptVisible, normalizeEmail, promptNewPassword, fail, scrub } = require('./lib/adminCli');

async function main() {
  requireTty();
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set in this environment.');

  const prisma = require('../src/lib/prisma');
  const { hashPassword } = require('../src/lib/password');
  const { destroyAdminSessions } = require('../src/lib/adminSession');

  console.log(`Reset a Siffty admin password (NODE_ENV=${process.env.NODE_ENV || 'development'})\n`);
  const email = normalizeEmail(await promptVisible('Admin email: '));

  const admin = await prisma.adminUser.findUnique({ where: { email }, select: { id: true } });
  if (!admin) fail('No admin has that email. Use scripts/create-admin.js to create one.');

  const password = await promptNewPassword();
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
  });
  const ended = await destroyAdminSessions(admin.id);
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.id,
      action: 'ADMIN_PASSWORD_RESET_CLI',
      targetType: 'ADMIN_USER',
      targetId: admin.id,
      after: { sessionsEnded: Number(ended) || 0 },
      userAgent: 'scripts/reset-admin-password.js',
    },
  });

  console.log(`\nPassword reset for ${email}. Every existing admin session for it has been signed out.`);
  await prisma.$disconnect();
}

main().catch((err) => fail(scrub(err && err.message)));
