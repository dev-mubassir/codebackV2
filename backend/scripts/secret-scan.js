/**
 * TEMPORARY pre-push secret scan. Delete after use.
 *
 * Scans every TRACKED file for credential patterns and for stray real email
 * addresses. Reports findings by NAME and location — never prints a matched
 * secret value.
 *
 * Run from the repo root:  node backend/scripts/secret-scan.js
 */

const fs = require('fs');
const { execSync } = require('child_process');

const PATTERNS = [
  ['Resend API key', /\bre_[A-Za-z0-9_]{20,}/],
  ['Google client secret', /GOCSPX-[A-Za-z0-9_-]{10,}/],
  ['Google/Gemini API key', /\bAQ\.[A-Za-z0-9_-]{20,}|\bAIza[A-Za-z0-9_-]{30,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{20,}/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['PEM private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['DKIM PRIVATE key (p=MII…)', /\bp=MII[A-Za-z0-9+/=]{40,}/],
  ['bcrypt hash', /\$2[aby]\$\d{2}\$[A-Za-z0-9./]{50,}/],
  ['Cashfree credential', /CASHFREE_[A-Z_]*(?:SECRET|CLIENT_ID)\s*=\s*[A-Za-z0-9]{16,}/],
  [
    'DB URL with non-local credentials',
    /postgres(?:ql)?:\/\/(?!postgres:postgres@localhost)[^/\s:]+:[^@\s]+@(?!localhost|127\.0\.0\.1)/,
  ],
  ['Generic 32+ hex secret assignment', /(?:SECRET|KEY|PEPPER|TOKEN)\s*=\s*[0-9a-f]{32,}/],
];

// Addresses that are legitimately present and are not a leak.
const ALLOWED_EMAILS = new Set([
  'mubassirrr2005@gmail.com', // the owner's, used in docs/tests
  'mubassirs1999@gmail.com', // the owner's test account
  'support@siffty.com', // public, printed on legal pages by design
  'noreply@mail.siffty.com', // public sender
  'onboarding@resend.dev', // diagnostic sender, referenced in guards
  'admin@codeback.internal', // synthetic admin sentinel
  'dmarc@siffty.com',
  'dmarc@yourdomain.com',
]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const tracked = execSync('git ls-files', { maxBuffer: 1 << 26 })
  .toString()
  .split('\n')
  .filter(Boolean);

const patternHits = [];
const emailHits = new Map();

for (const file of tracked) {
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch {
    continue; // binary
  }

  for (const [label, re] of PATTERNS) {
    if (re.test(contents)) patternHits.push({ file, label });
  }

  for (const raw of contents.match(EMAIL_RE) || []) {
    const addr = raw.toLowerCase();
    if (ALLOWED_EMAILS.has(addr)) continue;
    // Reserved / fixture / documentation domains are not real people.
    if (/@(?:example|test|yourdomain|domain|placeholder|sentry)\./.test(addr)) continue;
    if (addr.endsWith('@test.codeback')) continue;
    if (/\.(?:png|jpg|jpeg|svg|gif|webp)$/.test(addr)) continue;
    if (!emailHits.has(addr)) emailHits.set(addr, new Set());
    emailHits.get(addr).add(file);
  }
}

const line = (s = '') => console.log(s);
line('='.repeat(70));
line(`SECRET SCAN — ${tracked.length} tracked files`);
line('='.repeat(70));

line('');
line('CREDENTIAL PATTERNS');
if (!patternHits.length) {
  line('  CLEAN — no credential pattern matched in any tracked file.');
} else {
  for (const h of patternHits) line(`  ${h.file}  <-  ${h.label}`);
}

line('');
line('REAL EMAIL ADDRESSES beyond the known/allowed set');
if (!emailHits.size) {
  line('  CLEAN — none.');
} else {
  for (const [addr, files] of emailHits) {
    line(`  ${addr}  in: ${[...files].slice(0, 4).join(', ')}`);
  }
}

line('');
line('='.repeat(70));
const clean = !patternHits.length && !emailHits.size;
line(clean ? 'VERDICT: CLEAN' : 'VERDICT: REVIEW THE ABOVE BEFORE PUSHING');
line('='.repeat(70));
