const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true, email: true } });
  console.log('Users:', JSON.stringify(users, null, 2));
}

check().finally(() => prisma.$disconnect());