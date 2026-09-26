// Run INSIDE an API container: creates the synthetic burst tenant (dev copy only).
//   docker compose exec -T api1 node - < deploy/local/seed-burst-tenant.js
const prisma = require('/app/src/lib/prisma');
const { encrypt } = require('/app/src/lib/crypto');
(async () => {
  const email = 'burst-tenant@test.codeback';
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { email, name: 'Burst Tenant', emailVerifiedAt: new Date(), onboardingCompleted: true,
      businessProfile: { create: { businessName: 'Burst', autoReplyMode: 'human_only' } }, preferences: { create: {} } } });
  }
  const igUserId = 'burst-ig-1';
  let account = await prisma.instagramAccount.findFirst({ where: { igUserId } });
  if (!account) {
    account = await prisma.instagramAccount.create({ data: { userId: user.id, igUserId, igUsername: 'burst_tenant', accessToken: encrypt('not-a-real-token'), connectionStatus: 'CONNECTED' } });
  }
  // 20 senders, profiles marked fresh so no Graph API call is ever made.
  for (let i = 0; i < 20; i++) {
    await prisma.contact.upsert({
      where: { instagramAccountId_igsid: { instagramAccountId: account.id, igsid: `burst-sender-${i}` } },
      update: { lastFetchedAt: new Date(Date.now() + 7 * 864e5) },
      create: { instagramAccountId: account.id, igsid: `burst-sender-${i}`, username: `sender${i}`, lastFetchedAt: new Date(Date.now() + 7 * 864e5) },
    });
  }
  console.log('tenant ready:', user.id, account.id);
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
