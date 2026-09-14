/**
 * Codeback Backend — Express Server Entry Point
 * 
 * This is the main server that handles:
 * - Instagram OAuth authentication
 * - Webhook reception for incoming DMs
 * - REST API for conversations, messages, and replies
 * - WebSocket (Socket.io) for real-time message push
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const http = require('http');
const https = require('https');
const { Server: SocketIO } = require('socket.io');

// Import routes
const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');
const accountRoutes = require('./routes/accounts');
const adminRoutes = require('./routes/admin');
const dashboardRoutes = require('./routes/dashboard');
const analyticsRoutes = require('./routes/analytics');
const brandDealRoutes = require('./routes/brandDeals');
const notificationRoutes = require('./routes/notifications');
const settingsRoutes = require('./routes/settings');
const dataDeletionRoutes = require('./routes/dataDeletion');
const billingRoutes = require('./routes/billing');
const cashfreeWebhookRoutes = require('./routes/cashfreeWebhooks');

const { setIO } = require('./lib/socket');
const { startWorkers } = require('./jobs');
const { corsOptions, securityHeaders, originGuard } = require('./lib/security');

// ============================================
// Express App Setup
// ============================================
const app = express();

const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// HTTPS certs for local development
const certPath = path.join(__dirname, '..', 'certs', 'local.codeback.test.pem');
const keyPath = path.join(__dirname, '..', 'certs', 'local.codeback.test-key.pem');
let server;

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
  server = https.createServer(httpsOptions, app);
  console.log('[Server] HTTPS enabled with local certificates');
} else {
  server = http.createServer(app);
  console.log('[Server] HTTPS certs not found, falling back to HTTP');
}

// ============================================
// Middleware
// ============================================

// Baseline security headers on every response (no external dependency).
app.use(securityHeaders);

// CORS — strict allowlist (lib/security.js). Credentialed cross-origin
// requests are only honored for known origins; unknown origins get no
// Access-Control-Allow-Origin header at all, so the browser blocks them.
app.use(cors(corsOptions));

// Cookie parser
app.use(cookieParser());

// Trust proxy for secure cookies over ngrok
app.set('trust proxy', 1);

const isProduction = process.env.NODE_ENV === 'production';

// ---- Critical production security assertions (fail closed) ----
if (isProduction && process.env.SKIP_SIGNATURE_VERIFICATION === 'true') {
  console.error('[Server] FATAL: SKIP_SIGNATURE_VERIFICATION=true is forbidden in production. Refusing to start.');
  process.exit(1);
}

// SESSION_SECRET is required in EVERY environment and has no fallback value.
// A hardcoded default is public knowledge the moment it reaches a repo, and
// anyone holding it can forge a signed session cookie for any user — so the
// server refuses to boot rather than silently signing with a known key.
const SESSION_SECRET = (process.env.SESSION_SECRET || '').trim();
if (!SESSION_SECRET) {
  console.error('[Server] FATAL: SESSION_SECRET is not set. Generate one with:');
  console.error("           node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  throw new Error('SESSION_SECRET is required — refusing to start without a session signing key.');
}
if (SESSION_SECRET.length < 32) {
  console.error(`[Server] FATAL: SESSION_SECRET is only ${SESSION_SECRET.length} characters. Use at least 32.`);
  throw new Error('SESSION_SECRET is too short — refusing to start with a weak session signing key.');
}

if (isProduction && !process.env.INSTAGRAM_APP_SECRET) {
  console.error('[Server] FATAL: INSTAGRAM_APP_SECRET must be set in production (webhook signatures cannot be verified without it). Refusing to start.');
  process.exit(1);
}

// ---- Auth hardening: fail loudly at BOOT, not at 3am on a user request ----
//
// Each of these is required in EVERY environment, because the failure mode of
// a missing one is silent and delayed rather than obvious:
//
//   TOKEN_ENCRYPTION_KEY  used to fall back to sha256(SESSION_SECRET). That
//     coupling meant rotating the session key silently made every stored
//     Instagram token undecryptable, with no warning. The fallback is gone, so
//     an unset key must now stop the boot rather than surfacing as a decrypt
//     failure on the first DM.
//
//   OAUTH_STATE_SECRET    signs the OAuth state token. Unset, every Instagram
//     and Google connect attempt fails at the point the user is mid-flow.
//
//   IG_IDENTITY_PEPPER    keys the trial-abuse ledger. Unset, the ledger
//     cannot be read or written — and a fallback would be far worse than a
//     crash, because it would silently hand every past trial user a new trial.
const REQUIRED_SECRETS = [
  ['TOKEN_ENCRYPTION_KEY', 'encrypts Instagram access tokens at rest', 'hex'],
  ['OAUTH_STATE_SECRET', 'signs the OAuth state token (Instagram + Google)', 'base64'],
  ['IG_IDENTITY_PEPPER', 'keys the trial-abuse ledger — CAN NEVER BE ROTATED', 'base64'],
];

for (const [name, purpose, encoding] of REQUIRED_SECRETS) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    console.error(`[Server] FATAL: ${name} is not set. It ${purpose}.`);
    console.error(
      `           Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('${encoding}'))"`
    );
    if (name === 'IG_IDENTITY_PEPPER') {
      console.error('           BACK IT UP PERMANENTLY BEFORE USE — rotating it resets every trial.');
    }
    process.exit(1);
  }
}

// TOKEN_ENCRYPTION_KEY has a shape requirement the others do not: it is used
// directly as an AES-256 key, so it must decode to exactly 32 bytes.
if (Buffer.from(process.env.TOKEN_ENCRYPTION_KEY.trim(), 'hex').length !== 32) {
  console.error('[Server] FATAL: TOKEN_ENCRYPTION_KEY must be 32 bytes of hex (64 characters).');
  console.error("           Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  process.exit(1);
}

// Email is not fatal, but a silent console transport in production means
// password resets never arrive and nobody finds out until a user complains.
if (isProduction && !(process.env.RESEND_API_KEY || '').trim()) {
  console.warn('[Server] WARNING: RESEND_API_KEY is not set — password reset and verification');
  console.warn('[Server]          emails will be LOGGED TO THE CONSOLE instead of sent.');
}

// Not fatal (unlike the secrets above) — the billing routes themselves
// already 404 while BILLING_ENABLED is false, and fail their own request
// with a clear 502 if it's true but misconfigured. Crashing the whole
// backend (blocking Instagram DMs) over a missing billing credential would
// be disproportionate; a boot-time warning is enough to catch a
// misconfigured deploy before a customer hits it.
if (require('./lib/billingFlags').isBillingEnabled()) {
  if (!(process.env.CASHFREE_APP_ID || '').trim() || !(process.env.CASHFREE_SECRET_KEY || '').trim()) {
    console.warn('[Server] WARNING: BILLING_ENABLED is true but CASHFREE_APP_ID/CASHFREE_SECRET_KEY are not fully set —');
    console.warn('[Server]          checkout and webhook signature verification will fail at request time.');
  }
}

// An admin session can impersonate any tenant, so the admin credential is
// effectively a master key to every customer's DMs. A plaintext password in
// an environment variable is readable from the hosting dashboard, a log dump,
// or any shell on the container — so production requires the bcrypt hash and
// refuses to start if the plaintext form is present at all.
if (isProduction && process.env.ADMIN_PASSWORD) {
  console.error('[Server] FATAL: ADMIN_PASSWORD (plaintext) must not be set in production. Use ADMIN_PASSWORD_HASH instead:');
  console.error('           node -e "console.log(require(\'bcryptjs\').hashSync(process.argv[1], 12))" \'your-password\'');
  console.error('           ...then unset ADMIN_PASSWORD.');
  process.exit(1);
}
if (isProduction && process.env.ADMIN_USERNAME && !process.env.ADMIN_PASSWORD_HASH) {
  console.error('[Server] FATAL: ADMIN_USERNAME is set but ADMIN_PASSWORD_HASH is not. Admin login would be unusable in production. Refusing to start.');
  process.exit(1);
}

// Loud warning for the dangerous "production deployment running in dev mode"
// case: public URLs but NODE_ENV !== production disables production safeguards.
const LOCAL_URL_PATTERN = /localhost|127\.0\.0\.1|local\.codeback\.test/;
const looksPublic = [process.env.FRONTEND_URL, process.env.BACKEND_URL]
  .some((u) => u && !LOCAL_URL_PATTERN.test(u));
if (!isProduction && looksPublic) {
  console.warn('[Server] WARNING: Public FRONTEND_URL/BACKEND_URL detected while NODE_ENV is not "production". Production safeguards (secure cookies, strict CORS/headers gating) are relaxed. Set NODE_ENV=production for public deployments.');
}

// The mirror case is worse than a warning deserves: NODE_ENV=production with
// FRONTEND_URL/BACKEND_URL left at (or defaulted to) localhost. The server
// boots fine and then quietly builds password-reset, verification, and OAuth
// links that only resolve on the machine running this process — exactly the
// class of bug a wrong env var NAME would also cause, and just as silent.
// Two separate checks rather than one combined one, so a deploy missing only
// one of the two names itself instead of a generic message.
if (isProduction) {
  const frontendUrlValue = (process.env.FRONTEND_URL || '').trim();
  if (!frontendUrlValue || LOCAL_URL_PATTERN.test(frontendUrlValue)) {
    console.error(
      `[Server] FATAL: FRONTEND_URL is ${frontendUrlValue ? `still "${frontendUrlValue}"` : 'not set'} in production. ` +
        'It builds every password-reset, verification, and OAuth-redirect link. Set it to the public frontend URL.'
    );
    process.exit(1);
  }
  const backendUrlValue = (process.env.BACKEND_URL || '').trim();
  if (!backendUrlValue || LOCAL_URL_PATTERN.test(backendUrlValue)) {
    console.error(
      `[Server] FATAL: BACKEND_URL is ${backendUrlValue ? `still "${backendUrlValue}"` : 'not set'} in production. ` +
        'It feeds the CORS allowlist and derives the Google OAuth redirect URI. Set it to the public backend URL.'
    );
    process.exit(1);
  }
}

/**
 * Session store selection.
 *
 * Redis whenever REDIS_URL is configured — sessions then survive a restart and
 * are shared across instances, which the default MemoryStore cannot do (it also
 * leaks memory, since it never evicts expired sessions).
 *
 * Without REDIS_URL we fall back to MemoryStore. That is fine for local dev and
 * single-instance use, but it means every deploy/restart logs everyone out, so
 * it warns loudly rather than failing — set REDIS_URL to remove the warning.
 * A configured-but-broken Redis is a different matter: in production that is a
 * hard failure, because silently degrading to MemoryStore is exactly the
 * outcome this is meant to prevent.
 *
 * TODO(post-review): a missing REDIS_URL currently only WARNS in production.
 * That is a deliberate accommodation for the current single-instance review
 * deployment, which has no Redis provisioned — making it fatal today would
 * simply prevent the app from booting.
 *
 * Once Redis is actually activated, tighten this: either make the missing-URL
 * case fatal in production outright, or gate it behind an explicit
 * ENFORCE_REDIS_SESSIONS=true so the strictness is opt-in per environment.
 * Until then a real multi-instance deploy can silently run on MemoryStore,
 * where sessions are per-process — users would be logged out at random as
 * requests land on different instances, and memory would grow unbounded.
 */
function buildSessionStore() {
  const REDIS_URL = process.env.REDIS_URL;

  // Redis stays the preferred store when it is actually provisioned. This
  // branch is dormant by design — REDIS_URL is unset everywhere today.
  if (REDIS_URL) {
    try {
      const IORedis = require('ioredis');
      const { RedisStore } = require('connect-redis');

      const client = new IORedis(REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
      client.on('error', (err) => console.error('[Session] Redis client error:', err.message));

      console.log('[Session] Using Redis-backed session store.');
      return new RedisStore({ client, prefix: 'codeback:sess:' });
    } catch (err) {
      console.error('[Session] FATAL: REDIS_URL is set but the Redis session store failed to initialize:', err.message);
      if (isProduction) {
        throw new Error('Redis session store is configured but unavailable — refusing to fall back to MemoryStore in production.');
      }
      console.warn('[Session] Falling back to the Postgres session store (non-production only).');
    }
  }

  // Postgres-backed sessions. This replaces the MemoryStore fallback, which
  // was the single worst thing about the previous setup: sessions lived in one
  // process, so every restart logged everyone out, a second instance could not
  // see the first instance's sessions, and memory grew without bound. All of
  // that was permitted in PRODUCTION behind nothing but a console warning.
  //
  // Postgres is already a hard dependency, so this needs no new infrastructure
  // and removes the fallback path entirely — there is no longer any way to end
  // up on MemoryStore by accident.
  try {
    const pgSession = require('connect-pg-simple')(session);
    const { Pool } = require('pg');

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on('error', (err) => console.error('[Session] Postgres session pool error:', err.message));

    console.log('[Session] Using Postgres-backed session store (table: user_sessions).');
    return new pgSession({
      pool,
      tableName: 'user_sessions',
      // The table is owned by the session store, not by Prisma — it is
      // deliberately absent from schema.prisma so `prisma migrate diff` does
      // not fight the library over its shape.
      createTableIfMissing: true,
      // Sweep expired rows hourly; without this the table only ever grows.
      pruneSessionInterval: 60 * 60,
    });
  } catch (err) {
    console.error('[Session] FATAL: could not initialize the Postgres session store:', err.message);
    throw new Error(
      'Session storage is unavailable. Refusing to start with in-memory sessions.'
    );
  }
}

// Session middleware
const sessionMiddleware = session({
  name: 'codeback.sid',
  store: buildSessionStore(),
  // An ARRAY, not a string. express-session signs with the first entry and
  // accepts any of them when verifying, so a future rotation can prepend a new
  // secret and keep old cookies valid until they expire, instead of logging
  // every user out at once. SESSION_SECRET_PREVIOUS is optional.
  secret: [SESSION_SECRET, ...(process.env.SESSION_SECRET_PREVIOUS ? [process.env.SESSION_SECRET_PREVIOUS.trim()] : [])],
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    // 'lax' blocks the cookie on cross-site POST/PUT/PATCH/DELETE (CSRF), while
    // still allowing same-site subdomain flows (e.g. app.* -> api.*). Override
    // with COOKIE_SAMESITE=none only if you split to unrelated domains AND add
    // real CSRF tokens (a 'none' cookie also requires Secure).
    sameSite: process.env.COOKIE_SAMESITE || 'lax',
  },
});

app.use(sessionMiddleware);

// CSRF defense-in-depth: reject state-changing requests whose Origin/Referer
// is present but not on the CORS allowlist (lib/security.js). Runs after the
// session is loaded and before route handlers.
app.use(originGuard);

// JSON body parser. Meta's webhook signature is an HMAC over the bytes on the
// wire, so the raw body is captured here via `verify` — body-parser hands us
// the exact Buffer it is about to parse, before any decoding.
//
// This replaces a hand-rolled parser that branched on
// `req.originalUrl.includes('webhook')`. That branch was wrong three ways:
//   - it matched the QUERY STRING, so `POST /anything?x=webhook` took the raw
//     path on every route,
//   - the raw path had NO size limit, buffering unbounded input into memory
//     before any signature check ran, and
//   - it called req.setEncoding('utf8') and accumulated a string, so the HMAC
//     was computed over re-encoded text (any non-UTF-8 byte becomes U+FFFD and
//     can never round-trip) and any downstream body parser hit raw-body's
//     "stream encoding should not be set" 500.
// A Buffer keeps the bytes exact and the limit applies to every route.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// URL-encoded body parser (for form submissions)
app.use(express.urlencoded({ extended: true }));

// ============================================
// Socket.io Setup
// ============================================
const io = new SocketIO(server, {
  cors: {
    origin: FRONTEND_URL,
    credentials: true,
  },
});

// Mount session middleware directly onto Socket.io engine to verify sessions on handshake
io.engine.use(sessionMiddleware);

// Make Socket.io available to every module via lib/socket.js (webhook
// handler, background AI worker, notification service, etc.)
setIO(io);

// Start the background AI processing worker (message classification,
// priority scoring, brand-deal extraction, summaries). Uses Redis/BullMQ
// when REDIS_URL is configured, otherwise an in-process queue — see
// lib/queue.js. Either way this runs off the webhook's request/response path.
startWorkers();

// Handle Socket.io connections
io.on('connection', (socket) => {
  const session = socket.request?.session;
  const userId = session?.userId;

  // Reject unauthenticated socket connections
  if (!userId) {
    console.warn(`[Socket.io] Rejected unauthenticated connection attempt (socket ${socket.id}, no active session)`);
    socket.disconnect(true);
    return;
  }

  // Automatically join the user-scoped room verified from the server session
  socket.join(`user:${userId}`);
  console.log(`[Socket.io] Authenticated socket ${socket.id} joined room user:${userId}`);

  // Safe handler if client emits 'join' — verifies against the server session, never trusting client-supplied userId
  socket.on('join', ({ userId: requestedUserId } = {}) => {
    if (requestedUserId && requestedUserId !== userId) {
      console.warn(`[Socket.io] Blocked socket ${socket.id} (user:${userId}) from joining unauthorized room user:${requestedUserId}`);
      return;
    }
  });

  socket.on('disconnect', () => {
    console.log('[Socket.io] Client disconnected:', socket.id);
  });
});

// ============================================
// Routes
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Handle OAuth callback if REDIRECT_URI is exactly the ngrok root.
// `state` must be forwarded too, or the callback's CSRF check can never pass.
app.get('/', (req, res) => {
  if (req.query.code) {
    const qs = new URLSearchParams();
    qs.set('code', req.query.code);
    if (req.query.state) qs.set('state', req.query.state);
    return res.redirect(`/auth/instagram/callback?${qs.toString()}`);
  }
  res.send('Siffty API is running');
});

// Auth routes (OAuth flow)
app.use('/auth', authRoutes);

// Webhook routes (Instagram webhook - mounted on both /webhook and /webhooks/instagram)
app.use('/webhook', webhookRoutes);
app.use('/webhooks/instagram', webhookRoutes);

// Cashfree webhook — always mounted (route itself 404s while BILLING_ENABLED
// is false, so its existence is not conditional on the flag being read
// correctly at boot; see routes/cashfreeWebhooks.js).
app.use('/webhooks/cashfree', cashfreeWebhookRoutes);

// Meta Data Deletion Request Callback (unauthenticated by design — the
// signed_request HMAC is the authentication). Review-critical surface.
app.use('/data-deletion', dataDeletionRoutes);

// Admin panel routes (must be mounted before /api)
app.use('/api/admin', adminRoutes);

// Billing checkout (must be mounted before /api, same reason as admin above
// — apiRoutes' own blanket requireAuth would otherwise intercept every
// /api/billing/* request with a 401 before it ever reached billingRoutes'
// BILLING_ENABLED gate, turning "disabled feature, 404" into "exists, log
// in". Confirmed by hand while building this route — every OTHER /api/*
// sub-router below this point has the exact same latent shadowing, it's
// just invisible there because both routers happen to demand the same
// auth and return the same 401.
app.use('/api/billing', billingRoutes);

// API routes (conversations, messages, AI analysis, reply generation, reply)
app.use('/api', apiRoutes);

// Account management routes
app.use('/api/accounts', accountRoutes);

// Creator Home Dashboard + "While You Were Away"
app.use('/api/dashboard', dashboardRoutes);

// Analytics API (Cloudflare-style metric summaries & time-series)
app.use('/api/analytics', analyticsRoutes);
app.use('/api/dashboard/analytics', analyticsRoutes);

// Brand deal pipeline
app.use('/api/brand-deals', brandDealRoutes);

// Notification center
app.use('/api/notifications', notificationRoutes);

// Creator AI preferences and business profile / onboarding
app.use('/api/settings', settingsRoutes);
app.use('/api', settingsRoutes);

// ============================================
// Start Server
// ============================================
const protocol = server instanceof https.Server ? 'https' : 'http';
server.listen(PORT, () => {
  console.log('');
  console.log('='.repeat(50));
  console.log(`  Codeback Backend running on port ${PORT} (${protocol.toUpperCase()})`);
  console.log('='.repeat(50));
  console.log(`  Frontend URL:  ${FRONTEND_URL}`);
  console.log(`  Health check:  ${protocol}://local.codeback.test:${PORT}/health`);
  console.log(`  Webhook URL:   ${protocol}://local.codeback.test:${PORT}/webhooks/instagram`);
  console.log(`  OAuth start:   ${protocol}://local.codeback.test:${PORT}/auth/instagram`);
  console.log('='.repeat(50));
  console.log('');
});

// ============================================
// 404 and error handling
//
// Extracted to middleware/errorHandlers.js so the TEST HARNESS mounts the
// identical code — a harness whose error shape differs from production tests
// nothing about the error shape.
// ============================================
const { notFoundHandler, errorHandler } = require('./middleware/errorHandlers');

app.use(notFoundHandler);
app.use(errorHandler);
