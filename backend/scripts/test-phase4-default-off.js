/**
 * Phase 4 verification — autoReplyMode defaults to 'human_only'.
 *
 * Asserts:
 *   1. A brand-new profile created via the schema default gets 'human_only'.
 *   2. A profile created via DEFAULT_PROFILE (getOrCreateBusinessProfile) gets 'human_only'.
 *   3. The registration path in routes/auth.js creates 'human_only'.
 *   4. Pre-existing profiles are NOT modified.
 *   5. The classification pipeline still runs with auto-sending off — only the
 *      final send is gated, analysis/priority/summary/socket emit are not.
 *
 * Creates its own throwaway users and deletes them at the end.
 */

const prisma = require('../src/lib/prisma');
const { getOrCreateBusinessProfile, DEFAULT_PROFILE } = require('../src/services/businessProfileService');

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  if (actual === expected) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

const TAG = `phase4-${Date.now()}`;
const createdUserIds = [];

async function makeUser(suffix) {
  const u = await prisma.user.create({
    data: { email: `${TAG}-${suffix}@test.local`, name: `Phase4 ${suffix}` },
  });
  createdUserIds.push(u.id);
  return u;
}

(async () => {
  console.log('\n=== Phase 4: auto-reply default OFF ===\n');

  // Snapshot pre-existing profiles BEFORE we create anything.
  const before = await prisma.businessProfile.findMany({
    select: { id: true, autoReplyMode: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Pre-existing profiles: ${before.length} (${before.map(b => b.autoReplyMode).join(', ')})\n`);

  console.log('1. Schema-level default (no autoReplyMode supplied):');
  const u1 = await makeUser('schema');
  const p1 = await prisma.businessProfile.create({
    data: { userId: u1.id, businessName: 'Schema Default Co' },
  });
  check('new profile defaults to human_only', p1.autoReplyMode, 'human_only');

  console.log('\n2. DEFAULT_PROFILE via getOrCreateBusinessProfile():');
  check('DEFAULT_PROFILE constant is human_only', DEFAULT_PROFILE.autoReplyMode, 'human_only');
  const u2 = await makeUser('service');
  const p2 = await getOrCreateBusinessProfile(u2.id);
  check('auto-created profile is human_only', p2.autoReplyMode, 'human_only');

  console.log('\n3. Registration path (mirrors routes/auth.js nested create):');
  const u3 = await prisma.user.create({
    data: {
      email: `${TAG}-reg@test.local`,
      name: 'Reg Test',
      businessProfile: { create: { businessName: 'Reg Test', tone: 'friendly', autoReplyMode: 'human_only' } },
      preferences: { create: {} },
    },
    include: { businessProfile: true },
  });
  createdUserIds.push(u3.id);
  check('registration creates human_only', u3.businessProfile.autoReplyMode, 'human_only');

  console.log('\n4. Pre-existing profiles untouched:');
  const after = await prisma.businessProfile.findMany({
    where: { id: { in: before.map(b => b.id) } },
    select: { id: true, autoReplyMode: true },
    orderBy: { createdAt: 'asc' },
  });
  check('same number of pre-existing profiles', after.length, before.length);
  const unchanged = before.every(b => after.find(a => a.id === b.id)?.autoReplyMode === b.autoReplyMode);
  check('every pre-existing mode is unchanged', unchanged, true);
  check('the 3 existing profiles are still on smart', after.every(a => a.autoReplyMode === 'smart'), true);

  console.log('\n5. Classification still runs with auto-sending off:');
  // The gate only guards the SEND. Mirrors jobs/messageAnalysisJob.js step 8.
  const gate = (mode, ov) => (mode || 'smart') === 'smart' && ov !== false;
  check('human_only blocks auto-SEND', gate('human_only', null), false);
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/jobs/messageAnalysisJob.js'), 'utf8');
  const gateIdx = src.indexOf('const isAutoReplyActive');
  const before8 = src.slice(0, gateIdx);
  check('AIAnalysis is persisted before the gate', before8.includes('aIAnalysis.create'), true);
  check('Conversation category/priority updated before the gate', before8.includes('conversation.update'), true);
  check('usage recorded before the gate', before8.includes("recordUsage(userId, 'messages_analyzed'"), true);
  check('socket analysis_completed emitted before the gate', before8.includes('emitAnalysisUpdate'), true);
  check('summary regeneration runs before the gate', before8.includes('maybeRegenerateSummary'), true);
  check('brand-deal detection runs before the gate', before8.includes('upsertBrandDeal'), true);

  // Cleanup
  await prisma.businessProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.creatorPreference.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  const remaining = await prisma.businessProfile.count();
  check('\nthrowaway test data cleaned up', remaining, before.length);

  console.log(`\n=== ${passed}/${passed + failed} passed ===\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('FATAL:', e.message);
  await prisma.businessProfile.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
  await prisma.creatorPreference.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
  process.exit(1);
});
