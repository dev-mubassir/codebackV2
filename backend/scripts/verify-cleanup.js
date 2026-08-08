const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
  const accounts = await prisma.instagramAccount.count();
  const contacts = await prisma.contact.count();
  const convos = await prisma.conversation.count();
  const msgs = await prisma.message.count();
  const logs = await prisma.adminLog.count();
  const hooks = await prisma.webhookLog.count();
  
  console.log('Users:', JSON.stringify(users, null, 2));
  console.log('Accounts:', accounts);
  console.log('Contacts:', contacts);
  console.log('Conversations:', convos);
  console.log('Messages:', msgs);
  console.log('AdminLogs:', logs);
  console.log('WebhookLogs:', hooks);
}

check().finally(() => prisma.$disconnect());