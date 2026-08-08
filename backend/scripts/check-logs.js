const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkLogs() {
  const adminLogs = await prisma.adminLog.findMany();
  console.log('Admin Logs:', JSON.stringify(adminLogs, null, 2));
}

checkLogs().finally(() => prisma.$disconnect());