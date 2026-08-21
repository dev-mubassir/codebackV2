const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.count();
  const accounts = await prisma.instagramAccount.count();
  const contacts = await prisma.contact.count();
  const convos = await prisma.conversation.count();
  const msgs = await prisma.message.count();
  const analyses = await prisma.aIAnalysis.count();
  const summaries = await prisma.conversationSummary.count();
  const deals = await prisma.brandDeal.count();
  const replies = await prisma.replyGeneration.count();
  const prefs = await prisma.creatorPreference.count();
  const notifs = await prisma.notification.count();
  const subs = await prisma.subscription.count();
  const usage = await prisma.usageEvent.count();
  const logs = await prisma.adminLog.count();
  const hooks = await prisma.webhookLog.count();
  
  console.log('--- Database Verification Summary ---');
  console.log('Users:', users);
  console.log('Instagram Accounts:', accounts);
  console.log('Contacts:', contacts);
  console.log('Conversations:', convos);
  console.log('Messages:', msgs);
  console.log('AI Analyses:', analyses);
  console.log('Conversation Summaries:', summaries);
  console.log('Brand Deals:', deals);
  console.log('Reply Generations:', replies);
  console.log('Creator Preferences:', prefs);
  console.log('Notifications:', notifs);
  console.log('Subscriptions:', subs);
  console.log('Usage Events:', usage);
  console.log('Admin Logs:', logs);
  console.log('Webhook Logs:', hooks);
  console.log('------------------------------------');
}

check().finally(() => prisma.$disconnect());