const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanRemaining() {
  console.log('Cleaning admin logs and webhook logs...');
  
  // Keep only admin logs for the admin user
  const adminUsers = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true },
  });
  const adminIds = adminUsers.map(u => u.id);
  
  if (adminIds.length > 0) {
    // Delete admin logs not by admin users
    const deletedAdminLogs = await prisma.adminLog.deleteMany({
      where: { adminUserId: { notIn: adminIds } },
    });
    console.log(`Deleted ${deletedAdminLogs.count} admin logs not by admin users`);
  }
  
  // Delete all webhook logs (they're system-wide and not user-specific)
  const deletedWebhookLogs = await prisma.webhookLog.deleteMany({});
  console.log(`Deleted ${deletedWebhookLogs.count} webhook logs`);
  
  console.log('Remaining data cleanup complete!');
}

cleanRemaining().finally(() => prisma.$disconnect());