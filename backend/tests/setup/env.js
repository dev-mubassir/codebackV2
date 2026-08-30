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

// Never let a test reach a real queue, a real Redis, or a real AI provider.
delete process.env.REDIS_URL;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GROK_API_KEY;
delete process.env.XAI_API_KEY;
delete process.env.SKIP_SIGNATURE_VERIFICATION;
