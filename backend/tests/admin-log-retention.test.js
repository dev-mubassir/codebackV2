/**
 * AdminLog IP retention — Gate 1-B / E1.
 *
 * AdminLog.ipAddress is not only an admin's own IP: routes/auth.js also
 * writes it with the CONNECTING CUSTOMER's IP when Codeback refuses to link
 * a blocked or already-connected Instagram account. That column had no purge
 * job at all before this, flagged in PRIVACY_NOTES.md / FINDINGS.md. This
 * asserts redactExpiredAdminLogIps() clears ipAddress once a row is older
 * than ADMIN_LOG_IP_RETENTION_DAYS, and nothing else about the row.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';

import { prisma, resetDb, createUser } from './helpers/db.js';

const require = createRequire(import.meta.url);
const { redactExpiredAdminLogIps, ADMIN_LOG_IP_RETENTION_DAYS } = require('../src/jobs/purgeJob.js');

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('E1 — AdminLog IP retention', () => {
  it('redacts ipAddress on rows older than the retention window', async () => {
    const { user } = await createUser();
    const old = await prisma.adminLog.create({
      data: {
        adminUserId: user.id,
        action: 'ACCOUNT_RELINK_BLOCKED',
        targetType: 'INSTAGRAM_ACCOUNT',
        ipAddress: '203.0.113.9',
        createdAt: new Date(Date.now() - (ADMIN_LOG_IP_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000),
      },
    });

    const count = await redactExpiredAdminLogIps();
    expect(count).toBe(1);

    const row = await prisma.adminLog.findUnique({ where: { id: old.id } });
    expect(row.ipAddress).toBeNull();
    // Everything else about the audit row must survive — redaction, not deletion.
    expect(row.action).toBe('ACCOUNT_RELINK_BLOCKED');
    expect(row.targetType).toBe('INSTAGRAM_ACCOUNT');
  });

  it('leaves rows inside the retention window untouched', async () => {
    const { user } = await createUser();
    const recent = await prisma.adminLog.create({
      data: {
        adminUserId: user.id,
        action: 'ACCOUNT_LINK_BLOCKED',
        targetType: 'INSTAGRAM_ACCOUNT',
        ipAddress: '203.0.113.10',
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      },
    });

    const count = await redactExpiredAdminLogIps();
    expect(count).toBe(0);

    const row = await prisma.adminLog.findUnique({ where: { id: recent.id } });
    expect(row.ipAddress).toBe('203.0.113.10');
  });

  it('is idempotent — a second run redacts nothing further', async () => {
    const { user } = await createUser();
    await prisma.adminLog.create({
      data: {
        adminUserId: user.id,
        action: 'USER_SUSPEND',
        targetType: 'USER',
        ipAddress: '203.0.113.11',
        createdAt: new Date(Date.now() - (ADMIN_LOG_IP_RETENTION_DAYS + 5) * 24 * 60 * 60 * 1000),
      },
    });

    await redactExpiredAdminLogIps();
    const secondRunCount = await redactExpiredAdminLogIps();
    expect(secondRunCount).toBe(0);
  });
});
