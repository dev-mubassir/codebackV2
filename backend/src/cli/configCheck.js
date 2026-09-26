/**
 * Production config check — NAMES AND STATUSES ONLY.
 *
 *   northflank exec service api --projectId siffty --cmd 'node src/cli/configCheck.js'
 *
 * For every variable the API reads, prints one of:
 *   set             present and well-formed
 *   missing         absent/empty (FAIL if required)
 *   invalid format  present but wrong shape; the reason names the RULE, never the value
 *   unset (ok)      optional and absent
 *
 * It never prints a value, a length, a prefix, or a hash of one. Exit code 0 =
 * PASS (no required variable missing or invalid), 1 = FAIL.
 *
 * Covers the API's environment (prod-secrets). The web image's NEXT_PUBLIC_*
 * build arguments are checked by the web build itself (it refuses to build
 * without NEXT_PUBLIC_BACKEND_URL / NEXT_PUBLIC_SUPPORT_EMAIL).
 */

require('../lib/dbUrl').applyDatabaseUrl();

const env = process.env;
const isProd = (env.NODE_ENV || '').trim() === 'production';

const has = (k) => typeof env[k] === 'string' && env[k].trim() !== '';
const val = (k) => (env[k] || '').trim();

const httpsUrl = (v) => {
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || (!isProd && u.protocol === 'http:')) && (u.pathname === '/' || u.pathname === '') ? null : 'must be an https origin with no path';
  } catch {
    return 'not a URL';
  }
};
const anyUrl = (protocols) => (v) => {
  try {
    return protocols.includes(new URL(v).protocol) ? null : `protocol must be one of ${protocols.join(' ')}`;
  } catch {
    return 'not a URL';
  }
};
const bool = (v) => (['true', 'false'].includes(v) ? null : "must be 'true' or 'false'");
const int = (min, max) => (v) => (/^\d+$/.test(v) && +v >= min && +v <= max ? null : `must be an integer ${min}–${max}`);
const email = (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'not an email address');
const minLen = (n) => (v) => (v.length >= n ? null : `must be at least ${n} characters`);
const oneOf = (...xs) => (v) => (xs.includes(v) ? null : `must be one of: ${xs.join(', ')}`);

const cashfreeKeyMode = () => {
  const k = val('CASHFREE_SECRET_KEY');
  if (/^cfsk_ma_prod_/.test(k)) return 'production';
  if (/^cfsk_ma_test_/.test(k)) return 'sandbox';
  return null;
};

// [name, required, rule(value) -> null | reason, notes]
const RULES = [
  ['NODE_ENV', true, oneOf('production', 'development', 'test')],
  ['DATABASE_URL', true, anyUrl(['postgres:', 'postgresql:'])],
  ['REDIS_URL', false, anyUrl(['redis:', 'rediss:'])],
  ['SESSION_SECRET', true, minLen(32)],
  ['SESSION_SECRET_PREVIOUS', false, minLen(32)],
  ['TOKEN_ENCRYPTION_KEY', true, (v) => (/^[0-9a-fA-F]{64}$/.test(v) ? null : 'must be 64 hex characters')],
  ['OAUTH_STATE_SECRET', true, minLen(32)],
  ['IG_IDENTITY_PEPPER', true, minLen(16)],
  ['FRONTEND_URL', true, httpsUrl],
  ['BACKEND_URL', true, httpsUrl],
  ['ALLOWED_ORIGINS', false, (v) => (v.split(',').map((s) => s.trim()).filter(Boolean).every((o) => httpsUrl(o) === null) ? null : 'every entry must be an https origin')],
  ['REDIRECT_URI', true, (v) => anyUrl(['https:'])(v) || (has('BACKEND_URL') && !v.startsWith(val('BACKEND_URL')) ? 'must be on BACKEND_URL' : null)],
  ['INSTAGRAM_APP_ID', true, (v) => (/^\d+$/.test(v) ? null : 'must be numeric')],
  ['INSTAGRAM_APP_SECRET', true, (v) => (/^[0-9a-f]{32}$/.test(v) ? null : 'must be 32 lowercase hex characters')],
  ['WEBHOOK_VERIFY_TOKEN', true, minLen(8)],
  ['GOOGLE_CLIENT_ID', true, (v) => (v.endsWith('.apps.googleusercontent.com') ? null : 'must end with .apps.googleusercontent.com')],
  ['GOOGLE_CLIENT_SECRET', true, minLen(10)],
  ['RESEND_API_KEY', true, (v) => (v.startsWith('re_') ? null : "must be a Resend key (re_…)")],
  ['FROM_EMAIL', false, email],
  ['REPLY_TO_EMAIL', false, email],
  ['SUPPORT_EMAIL', true, email],
  ['EMAIL_DAILY_CAP', false, int(1, 100000)],
  ['EMAIL_CRITICAL_RESERVE', false, int(0, 100000)],
  ['EMAIL_DRY_RUN', false, (v) => bool(v) || (isProd && v === 'true' ? 'true in production: no email will be sent' : null)],
  ['GEMINI_API_KEY', true, minLen(20)],
  ['OPENAI_API_KEY', false, minLen(20)],
  ['ANTHROPIC_API_KEY', false, minLen(20)],
  ['AI_MOCK', false, () => (isProd ? 'must NOT be set in production' : null)],
  ['BILLING_ENABLED', true, bool],
  ['META_APPROVED', false, bool],
  ['USD_PRICING_ENABLED', false, bool],
  ['CASHFREE_ENV', true, (v) => oneOf('sandbox', 'production')(v) || (cashfreeKeyMode() && cashfreeKeyMode() !== v ? `the secret key is for the other Cashfree environment` : null)],
  ['CASHFREE_APP_ID', true, minLen(8)],
  ['CASHFREE_SECRET_KEY', true, (v) => (cashfreeKeyMode() ? null : 'not a Cashfree secret key (cfsk_ma_prod_/cfsk_ma_test_)')],
  ['WEBHOOK_TIMESTAMP_ENFORCE', false, bool],
  ['RUN_IN_PROCESS_SCHEDULER', false, bool],
  ['REDIS_TLS_INSECURE', false, (v) => bool(v) || (isProd && v === 'true' ? 'must not be true in production' : null)],
  ['TRUST_PROXY', false, (v) => (/^\d+$/.test(v) || ['true', 'false'].includes(v) ? null : 'must be a hop count or true/false')],
  ['DB_POOL_SIZE', false, int(1, 50)],
  ['COOKIE_SAMESITE', false, oneOf('lax', 'strict', 'none')],
  ['SKIP_SIGNATURE_VERIFICATION', false, (v) => (v === 'true' ? 'must never be true' : null)],
  ['PORT', false, int(1, 65535)],
];

let fail = false;
const rows = [];
for (const [name, required, rule] of RULES) {
  let status;
  if (!has(name)) {
    status = required ? 'missing' : 'unset (ok)';
    if (required) fail = true;
  } else {
    const reason = rule(val(name));
    if (reason) {
      status = `invalid format — ${reason}`;
      fail = true;
    } else status = 'set';
  }
  rows.push(`${name.padEnd(28)} ${status}`);
}

// Addon parts behind DATABASE_URL (HA): reported, never printed.
const parts = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].map((k) => `${k}=${has(k) ? 'set' : 'missing'}`).join(' ');
rows.push(`${'(database parts)'.padEnd(28)} ${parts}`);

// --expect KEY=VALUE (repeatable): confirm a NON-SECRET setting has the value
// the runbook requires. Secret names are refused outright; the output says
// only "matches" or "DIFFERS", never the actual value.
const EXPECTABLE = new Set(['NODE_ENV', 'CASHFREE_ENV', 'BILLING_ENABLED', 'USD_PRICING_ENABLED', 'META_APPROVED', 'EMAIL_DRY_RUN', 'RUN_IN_PROCESS_SCHEDULER', 'REDIS_TLS_INSECURE', 'WEBHOOK_TIMESTAMP_ENFORCE', 'DB_POOL_SIZE', 'COOKIE_SAMESITE', 'TRUST_PROXY', 'FRONTEND_URL', 'BACKEND_URL']);
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] !== '--expect' || !argv[i + 1]) continue;
  const [k, ...rest] = argv[i + 1].split('=');
  const want = rest.join('=');
  if (!EXPECTABLE.has(k)) {
    rows.push(`${('expect ' + k).padEnd(28)} refused — not an expectable non-secret key`);
    fail = true;
    continue;
  }
  const ok = val(k) === want;
  if (!ok) fail = true;
  rows.push(`${('expect ' + k).padEnd(28)} ${ok ? `matches ${want}` : `DIFFERS from ${want}`}`);
}

console.log(rows.join('\n'));
console.log(fail ? 'CONFIG CHECK: FAIL' : 'CONFIG CHECK: PASS');
process.exitCode = fail ? 1 : 0;
