const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Finding admin users...');
  const adminUsers = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, email: true, name: true },
  });

  console.log(`Found ${adminUsers.length} admin user(s):`, adminUsers.map(u => u.email));

  const adminIds = adminUsers.map(u => u.id);

  if (adminIds.length === 0) {
    console.log('No admin users found. Keeping all data.');
    return;
  }

  console.log('Deleting non-admin user data...');

  // Get all non-admin user IDs
  const nonAdminUsers = await prisma.user.findMany({
    where: { role: { not: 'ADMIN' } },
    select: { id: true },
  });
  const nonAdminIds = nonAdminUsers.map(u => u.id);

  if (nonAdminIds.length > 0) {
    // Delete related data for non-admin users
    const nonAdminAccountIds = (
      await prisma.instagramAccount.findMany({
        where: { userId: { in: nonAdminIds } },
        select: { id: true },
      })
    ).map(a => a.id);

    if (nonAdminAccountIds.length > 0) {
      // Delete messages -> conversations -> contacts -> instagram_accounts
      await prisma.message.deleteMany({
        where: {
          conversation: { instagramAccountId: { in: nonAdminAccountIds } },
        },
      });
      console.log('Deleted messages for non-admin accounts');

      await prisma.conversation.deleteMany({
        where: { instagramAccountId: { in: nonAdminAccountIds } },
      });
      console.log('Deleted conversations for non-admin accounts');

      await prisma.contact.deleteMany({
        where: { instagramAccountId: { in: nonAdminAccountIds } },
      });
      console.log('Deleted contacts for non-admin accounts');

      await prisma.webhookLog.deleteMany({
        where: { instagramAccountId: { in: nonAdminAccountIds } },
      });
      console.log('Deleted webhook logs for non-admin accounts');

      await prisma.instagramAccount.deleteMany({
        where: { id: { in: nonAdminAccountIds } },
      });
      console.log('Deleted Instagram accounts for non-admin users');
    }

    // Delete admin logs for non-admin users (as target)
    await prisma.adminLog.deleteMany({
      where: { targetId: { in: nonAdminIds }, targetType: 'USER' },
    });
    console.log('Deleted admin logs targeting non-admin users');

    // Delete non-admin users
    await prisma.user.deleteMany({
      where: { id: { in: nonAdminIds } },
    });
    console.log(`Deleted ${nonAdminIds.length} non-admin user(s)`);
  }

  // Also delete orphaned data (instagram accounts without users, etc.)
  console.log('Cleaning up orphaned data...');

  // Delete messages for conversations of deleted accounts
  const validAccountIds = (
    await prisma.instagramAccount.findMany({ select: { id: true } })
  ).map(a => a.id);

  await prisma.message.deleteMany({
    where: {
      conversation: { instagramAccountId: { notIn: validAccountIds } },
    },
  });

  await prisma.conversation.deleteMany({
    where: { instagramAccountId: { notIn: validAccountIds } },
  });

  await prisma.contact.deleteMany({
    where: { instagramAccountId: { notIn: validAccountIds } },
  });

  await prisma.webhookLog.deleteMany({
    where: { instagramAccountId: { notIn: validAccountIds }, instagramAccountId: { not: null } },
  });

  console.log('Database cleanup complete!');
  console.log('Admin users and their data preserved.');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });