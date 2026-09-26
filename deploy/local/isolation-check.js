// Run INSIDE an API container against the load balancer (requests alternate
// between api1 and api2): tenant B must never reach tenant A's data.
//   docker compose exec -T api1 node - < deploy/local/isolation-check.js
const crypto = require('crypto');
const prisma = require('/app/src/lib/prisma');
const { encrypt } = require('/app/src/lib/crypto');
const bcrypt = require('/app/node_modules/bcryptjs');
const LB = 'http://lb:5000';
const pw = crypto.randomBytes(12).toString('hex'); // throwaway, never printed

async function user(tag) {
  const email = `iso-${tag}-${Date.now()}@test.codeback`;
  return prisma.user.create({ data: { email, name: `ISO-${tag}`, passwordHash: await bcrypt.hash(pw, 4), emailVerifiedAt: new Date(), onboardingCompleted: true,
    businessProfile: { create: { businessName: `ISO-${tag}`, autoReplyMode: 'human_only' } }, preferences: { create: {} },
    entitlement: { create: { planCode: 'TRIAL', status: 'TRIALING', validUntil: new Date(Date.now() + 3 * 864e5) } } } });
}
async function login(email) {
  const r = await fetch(`${LB}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ email, password: pw }) });
  if (r.status !== 200) throw new Error(`login ${r.status}`);
  return r.headers.get('set-cookie').split(';')[0];
}
(async () => {
  const a = await user('a'); const b = await user('b');
  const acc = await prisma.instagramAccount.create({ data: { userId: a.id, igUserId: `iso-ig-${Date.now()}`, igUsername: 'iso_a', accessToken: encrypt('x'), connectionStatus: 'CONNECTED' } });
  const contact = await prisma.contact.create({ data: { instagramAccountId: acc.id, igsid: `iso-c-${Date.now()}` } });
  const conv = await prisma.conversation.create({ data: { instagramAccountId: acc.id, contactId: contact.id, lastMessage: 'ISO-A-SECRET' } });
  await prisma.message.create({ data: { conversationId: conv.id, direction: 'inbound', content: 'ISO-A-SECRET-DM', igMessageId: `iso-m-${Date.now()}` } });
  const ca = await login(a.email); const cb = await login(b.email);
  const results = [];
  const get = async (cookie, path) => { const r = await fetch(`${LB}${path}`, { headers: { cookie } }); return { status: r.status, body: await r.text() }; };
  for (let i = 0; i < 10; i++) { // 10 rounds so both instances answer both users
    const own = await get(ca, `/api/conversations/${conv.id}/messages`);
    const foreign = await get(cb, `/api/conversations/${conv.id}/messages`);
    const list = await get(cb, '/api/conversations');
    results.push({ ownOk: own.status === 200 && own.body.includes('ISO-A-SECRET-DM'), foreignBlocked: [403, 404].includes(foreign.status) && !foreign.body.includes('ISO-A-SECRET'), listClean: list.status === 200 && !list.body.includes('ISO-A-SECRET') });
  }
  const pass = results.every((r) => r.ownOk && r.foreignBlocked && r.listClean);
  console.log(JSON.stringify({ rounds: results.length, ownOk: results.filter((r) => r.ownOk).length, foreignBlocked: results.filter((r) => r.foreignBlocked).length, listClean: results.filter((r) => r.listClean).length, pass }));
  await prisma.$disconnect();
})().catch((e) => { console.error('isolation-check error:', e.message); process.exit(1); });
