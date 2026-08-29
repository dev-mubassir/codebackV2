/**
 * Static audit: every Prisma call against a tenant-scoped model must be
 * constrained to the authenticated user.
 *
 * Extracts each `prisma.<model>.<op>(...)` call by brace-matching its argument
 * list, then classifies how (or whether) it is tenant-scoped:
 *
 *   DIRECT     - where contains userId / user: { id }
 *   VIA_ACCOUNT- where joins instagramAccount: { userId } or an owned-account id list
 *   VIA_CONV   - where joins conversation: { instagramAccount: { userId } }
 *   BY_OWN_ID  - keyed on a primary id that a preceding ownership check produced
 *   UNSCOPED   - needs manual review
 *
 * Run: node scripts/audit-prisma-tenant-scope.js
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// Models holding tenant data, and how ownership is reachable from each.
const TENANT_MODELS = {
  user: 'self',
  businessProfile: 'direct',
  instagramAccount: 'direct',
  contact: 'via_account',
  conversation: 'via_account',
  message: 'via_conversation',
  aIAnalysis: 'via_conversation',
  conversationSummary: 'via_conversation',
  brandDeal: 'direct',
  replyGeneration: 'direct',
  creatorPreference: 'direct',
  notification: 'direct',
  usageEvent: 'direct',
  subscription: 'direct',
  webhookLog: 'via_account',
};

const READ_WRITE_OPS = [
  'findMany', 'findUnique', 'findFirst', 'findUniqueOrThrow', 'findFirstOrThrow',
  'update', 'updateMany', 'delete', 'deleteMany', 'upsert', 'count', 'groupBy', 'aggregate',
];

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Extract the balanced (...) argument text starting at the open paren. */
function extractArgs(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return '';
}

function classify(model, op, args, fileCtx) {
  const a = args.replace(/\s+/g, ' ');

  // Explicit tenant column on the model itself.
  if (/\buserId\b/.test(a)) return 'DIRECT';
  if (/user:\s*\{[^}]*\bid\b/.test(a)) return 'DIRECT';
  // Joined through the owning Instagram account.
  if (/instagramAccount:\s*\{[^}]*userId/.test(a)) return 'VIA_ACCOUNT';
  // Constrained to an allowlist of account ids the caller owns.
  if (/instagramAccountId:\s*\{\s*in:/.test(a)) return 'VIA_ACCOUNT';
  // Joined through the owning conversation.
  if (/conversation:\s*\{[^}]*instagramAccount/.test(a)) return 'VIA_CONV';
  if (/conversationId:\s*\{\s*in:/.test(a)) return 'VIA_CONV';
  // Keyed on an id that an ownership check in the same handler produced.
  if (/\bconversationId:\s*conversation\.id/.test(a)) return 'BY_OWN_ID';
  if (/where:\s*\{\s*id:\s*(conversation|account|message|contact|updated|existing|deal|brandDeal)\b/.test(a)) return 'BY_OWN_ID';
  if (/where:\s*\{\s*userId:/.test(a)) return 'DIRECT';

  return 'UNSCOPED';
}

const files = walk(SRC);
const rows = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(path.join(__dirname, '..', '..'), file).replace(/\\/g, '/');
  const re = /prisma\.(\w+)\.(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const [, model, op] = m;
    if (!(model in TENANT_MODELS)) continue;
    if (!READ_WRITE_OPS.includes(op)) continue;
    const args = extractArgs(src, m.index + m[0].length - 1);
    const line = src.slice(0, m.index).split('\n').length;
    rows.push({ file: rel, line, model, op, verdict: classify(model, op, args), args: args.replace(/\s+/g, ' ').slice(0, 150) });
  }
}

const byVerdict = rows.reduce((acc, r) => { (acc[r.verdict] ||= []).push(r); return acc; }, {});

console.log('\n' + '='.repeat(74));
console.log('  PRISMA TENANT-SCOPE AUDIT');
console.log('='.repeat(74));
console.log(`  ${rows.length} calls against tenant-scoped models across ${files.length} files\n`);

for (const v of ['DIRECT', 'VIA_ACCOUNT', 'VIA_CONV', 'BY_OWN_ID', 'UNSCOPED']) {
  const list = byVerdict[v] || [];
  console.log(`  ${v.padEnd(12)} ${String(list.length).padStart(3)}`);
}

console.log('\n' + '-'.repeat(74));
console.log('  UNSCOPED — every one of these needs a human verdict');
console.log('-'.repeat(74));
for (const r of byVerdict.UNSCOPED || []) {
  console.log(`\n  ${r.file}:${r.line}`);
  console.log(`    prisma.${r.model}.${r.op}(${r.args})`);
}
console.log('');
