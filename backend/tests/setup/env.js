/**
 * Test environment. Loaded by vitest BEFORE any test file (and therefore
 * before src/lib/prisma.js is imported), because PrismaClient reads
 * DATABASE_URL at construction time.
 *
 * Points at a throwaway PostgreSQL database — the same engine production
 * runs, so engine-specific behaviour (case-sensitive LIKE, transaction
 * semantics, constraint errors) is exercised rather than papered over by
 * SQLite. Nothing here is read from backend/.env, and no test ever touches
 * the dev or production database.
 *
 * The default targets the local dev Postgres but a SEPARATE database
 * (`codeback_test`), so the suite — which drops and recreates its schema on
 * every run — can never destroy the dev database. Override with
 * TEST_DATABASE_URL; just keep it pointed at a database you are happy to lose.
 */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:55432/codeback_test';

process.env.NODE_ENV = 'test';

// Deterministic key material so encrypt()/decrypt() and session signing are
// stable across runs. These are test-only values and are never real secrets.
process.env.SESSION_SECRET = 'test-session-secret-not-a-real-secret-000000';
process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
// Deterministic, test-only. The pepper in particular must be STABLE across a
// run: every InstagramIdentity hash derives from it, so a per-run value would
// make the ledger unmatchable between test cases.
process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-not-a-real-secret-0000';
process.env.IG_IDENTITY_PEPPER = 'test-ig-identity-pepper-not-a-real-secret-0000';

process.env.INSTAGRAM_APP_ID = 'test-app-id';
process.env.INSTAGRAM_APP_SECRET = 'test-app-secret';
process.env.REDIRECT_URI = 'https://api.test.local/auth/instagram/callback';
process.env.FRONTEND_URL = 'https://app.test.local';
process.env.BACKEND_URL = 'https://api.test.local';
process.env.WEBHOOK_VERIFY_TOKEN = 'test-verify-token';

// Vitest loads backend/.env into process.env, so real local configuration
// would otherwise leak into tests and change their meaning. Admin credentials
// are cleared here and set explicitly by the tests that need them — otherwise
// a developer swapping ADMIN_PASSWORD for ADMIN_PASSWORD_HASH in their own
// .env silently flips which branch of the login handler is exercised.
delete process.env.ADMIN_USERNAME;
delete process.env.ADMIN_PASSWORD;
delete process.env.ADMIN_PASSWORD_HASH;
delete process.env.ADMIN_EMAILS;

// BILLING ON BY DEFAULT.
//
// Enforcement is the interesting half of this system — the quota gates, the
// credit spend, the expiry behaviour — and for most of this project the suite
// ran with the flag off, so none of it was exercised unless a file opted in.
// That is not a theoretical gap: three auto-reply tests passed for years and
// failed the moment billing was switched on locally, because they had been
// asserting sends that enforcement would have refused.
//
// The value was also being INHERITED from backend/.env (vitest loads it), so
// the suite's meaning depended on the developer's own machine. Pinning it here
// makes enforcement the default and the result reproducible.
//
// Tests that are ABOUT the off state clear it explicitly and restore it —
// see billing-plans-endpoint, billing-summary-endpoint, entitlement-enforcement
// ("everything stays inert") and instagram-connect-regression.
process.env.BILLING_ENABLED = 'true';

// The other two stay OFF, matching their production default, and are pinned
// for the same reason: both are read from process.env at call time, so a value
// in a developer's .env would otherwise change what these tests mean. The
// tests that exercise them set them per-case.
delete process.env.USD_PRICING_ENABLED;
delete process.env.META_APPROVED;

// Never let a test reach a real queue, a real Redis, a real AI provider — or
// a real MAILBOX. RESEND_API_KEY is present in backend/.env, and without this
// the suite would send live email through the production Resend account to
// @test.codeback addresses that do not exist: burning the 100/day cap and
// generating hard bounces that damage sending reputation for the domain the
// real password-reset emails go out on.
//
// With the key absent, lib/email falls back to the console transport, which is
// also what makes the reset link assertable in tests.
delete process.env.RESEND_API_KEY;
delete process.env.REDIS_URL;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GROK_API_KEY;
delete process.env.XAI_API_KEY;
delete process.env.SKIP_SIGNATURE_VERIFICATION;
delete process.env.EMAIL_DRY_RUN;
delete process.env.TRUST_PROXY;

// No scheduler timers in tests: a job firing mid-file (a purge, a sweep)
// would change rows a test is asserting on. The scheduler is tested directly
// (tests/scheduler-race.test.js), and workers still start for the queue.
process.env.RUN_IN_PROCESS_SCHEDULER = 'false';
