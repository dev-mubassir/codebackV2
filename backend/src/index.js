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
const contactRoutes = require('./routes/contact');
const announcementRoutes = require('./routes/announcements');

const { setIO } = require('./lib/socket');
const { assertMigrationsCurrent } = require('./lib/migrationGuard');
const { startWorkers, stopWorkers } = require('./jobs');
const { corsOptions, securityHeaders, originGuard, isAllowedOrigin } = require('./lib/security');
const { skipOnAdminPaths, buildAdminSessionMiddleware, buildAdminStore } = require('./lib/adminSession');
const { userSessionGuard, socketSessionIsLive, startIdleSocketSweep } = require('./lib/sessionIdle');
const { publicHealthHandler, livezHandler, markShuttingDown } = require('./lib/health');
const { getRedis, isRedisConfigured, closeRedis } = require('./lib/redis');
const { attachSocketAdapter } = require('./lib/socketAdapter');
const { queueDriver } = require('./lib/queue');
const prisma = require('./lib/prisma');
const { maintenanceGuard } = require('./lib/maintenance');
const { startSettingsRefresher } = require('./lib/settings');
const { captureRequestContext, installConsoleErrorCapture } = require('./lib/errorRing');

// The last 100 backend errors, sanitised, for the admin health page.
installConsoleErrorCapture();
const { notFoundHandler, errorHandler } = require('./middleware/errorHandlers');

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

// Remember METHOD + path for errors logged during this request (errorRing).
app.use(captureRequestContext);

// Baseline security headers on every response (no external dependency).
app.use(securityHeaders);

// CORS — strict allowlist (lib/security.js). Credentialed cross-origin
// requests are only honored for known origins; unknown origins get no
// Access-Control-Allow-Origin header at all, so the browser blocks them.
app.use(cors(corsOptions));

// Cookie parser
app.use(cookieParser());

// How many reverse-proxy hops sit in front of us. It decides req.ip (every
// rate limiter keys on it) and req.secure (the Secure cookie). Too few and the
// client IP is the proxy's — every user shares one rate-limit bucket; too many
// and a client can spoof X-Forwarded-For. Default 1 (one ingress hop);
// TRUST_PROXY takes a hop count, true/false, or Express's subnet list syntax.
function trustProxySetting(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return 1;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));

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

// Email: fatal in production if it would fall back to the console transport,
// which prints live reset and verification tokens into the log. Staging on a
// copy of real data sets EMAIL_DRY_RUN=true instead (nothing is sent, nothing
// sensitive is logged).
try {
  const transport = require('./lib/email').assertSafeEmailTransport();
  console.log(`[Email] Transport: ${transport}${transport === 'dry-run' ? ' (EMAIL_DRY_RUN=true — nothing is sent)' : ''}`);
} catch (err) {
  console.error(`[Server] FATAL: ${err.message}`);
  process.exit(1);
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

// Admin credentials no longer come from the environment at all: admins live in
// admin_users and are created by scripts/create-admin.js. The old variables
// are now dead, so their presence only means a stale deploy config — warn,
// never fail, and never read them.
const DEAD_ADMIN_VARS = ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'ADMIN_EMAILS'].filter(
  (name) => process.env[name]
);
if (DEAD_ADMIN_VARS.length > 0) {
  console.warn(`[Server] WARNING: ${DEAD_ADMIN_VARS.join(', ')} ${DEAD_ADMIN_VARS.length === 1 ? 'is' : 'are'} set but no longer used. Remove from the environment.`);
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
 * Session store: Postgres (connect-pg-simple, table user_sessions).
 *
 * Shared by every instance and survives restarts, with no extra
 * infrastructure — Postgres is already a hard dependency. Sessions are
 * deliberately NOT in Redis even when Redis is configured: Redis here holds
 * rebuildable state (rate-limit counters, the job queue, socket pub/sub), and
 * losing it must never log every user out.
 *
 * (An earlier Redis branch here was never exercised and could not have worked:
 * connect-redis@10 expects a node-redis v5 client and was handed ioredis.)
 *
 * The pool is capped — see the connection budget in lib/prisma.js.
 */
const SESSION_DB_POOL_MAX = 3;

function buildSessionStore() {
  try {
    const pgSession = require('connect-pg-simple')(session);
    const { Pool } = require('pg');

    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: SESSION_DB_POOL_MAX });
    pool.on('error', (err) => console.error('[Session] Postgres session pool error:', err.message));

    console.log('[Session] Store: postgres (table user_sessions).');
    return {
      pool,
      store: new pgSession({
        pool,
        tableName: 'user_sessions',
        // The table is owned by the session store, not by Prisma — it is
        // deliberately absent from schema.prisma so `prisma migrate diff` does
        // not fight the library over its shape.
        createTableIfMissing: true,
        // Sweep expired rows hourly; without this the table only ever grows.
        pruneSessionInterval: 60 * 60,
      }),
    };
  } catch (err) {
    console.error('[Session] FATAL: could not initialize the Postgres session store:', err.message);
    throw new Error(
      'Session storage is unavailable. Refusing to start with in-memory sessions.'
    );
  }
}

// Session middleware. The store is kept in a variable because the idle-socket
// sweep (lib/sessionIdle.js) re-reads sessions from it.
const { store: sessionStore, pool: sessionPool } = buildSessionStore();
const sessionMiddleware = session({
  name: 'codeback.sid',
  store: sessionStore,
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

// The CUSTOMER session never loads on /api/admin — that path has its own
// session (lib/adminSession.js), mounted with the admin router below.
app.use(skipOnAdminPaths(sessionMiddleware));

// CSRF defense-in-depth: reject state-changing requests whose Origin/Referer
// is present but not on the CORS allowlist (lib/security.js). Runs after the
// session is loaded and before route handlers.
app.use(originGuard);

// Customer session lifetime: 30-minute idle (setting) and 7-day absolute
// limits, where only mutating requests and POST /auth/activity count as
// activity. After originGuard, so a blocked cross-site POST never counts.
// See lib/sessionIdle.js.
app.use(skipOnAdminPaths(userSessionGuard()));

// Maintenance mode (Gate 7 kill switch): customer /api and /auth answer 503;
// webhooks, data deletion, health, the admin panel and jobs keep running.
app.use(maintenanceGuard);

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
    // The same allowlist as HTTP CORS (lib/security.js), not FRONTEND_URL
    // alone — so a second allowed origin works for sockets too.
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
  },
  // The browser's Origin on the upgrade request is checked here as well: CORS
  // does not apply to a WebSocket handshake, so without this only the SameSite
  // cookie stood between a hostile page and a user's socket.
  allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers.origin)),
});

// Across instances, room emits travel through Redis pub/sub (lib/socketAdapter.js).
const socketAdapter = attachSocketAdapter(io);
console.log(
  socketAdapter === 'redis'
    ? '[Socket.io] Adapter: redis — emits reach sockets on every instance.'
    : '[Socket.io] Adapter: memory (REDIS_URL not set) — correct for a single instance only.'
);

// Mount session middleware directly onto Socket.io engine to verify sessions on handshake
io.engine.use(sessionMiddleware);

// Make Socket.io available to every module via lib/socket.js (webhook
// handler, background AI worker, notification service, etc.)
setIO(io);

// Redis status, once, at boot. The URL itself is never logged.
if (isRedisConfigured()) {
  const redis = getRedis();
  redis.once('ready', () => console.log('[Redis] Connected.'));
  console.log('[Redis] Configured — rate limits, email quota, queue and socket adapter use it.');
} else {
  console.log('[Redis] Not configured — rate limits, email quota, queue and socket adapter run in memory.');
}
console.log(`[Queue] Driver: ${queueDriver()}.`);
console.log(`[Cashfree] Mode: ${require('./lib/cashfree').cashfreeEnvironment()}.`);

// Start the background AI processing worker (message classification,
// priority scoring, brand-deal extraction, summaries). Uses Redis/BullMQ
// when REDIS_URL is configured, otherwise an in-process queue — see
// lib/queue.js. Either way this runs off the webhook's request/response path.
startWorkers();

// Every 60s: disconnect sockets whose session went idle with no further HTTP
// request (a tab left open). Not recorded as a job run — at once a minute it
// would drown the job history; its failures are logged.
startIdleSocketSweep({ store: sessionStore });

// Keep the settings cache (kill switches, thresholds) current for the
// synchronous readers, e.g. isBillingEnabled (Gate 7).
startSettingsRefresher();

// Handle Socket.io connections
io.on('connection', async (socket) => {
  const session = socket.request?.session;
  const userId = session?.userId;

  // Reject unauthenticated socket connections — and sessions that are already
  // past their idle or absolute limit, which the HTTP guard never sees here.
  if (!userId || !(await socketSessionIsLive(socket).catch(() => false))) {
    console.warn(`[Socket.io] Rejected connection (socket ${socket.id}): no live session`);
    socket.disconnect(true);
    return;
  }

  // Bind the socket to the session it authenticated with, so an expired
  // session disconnects exactly its own sockets (lib/sessionIdle.js).
  socket.data.sid = socket.request.sessionID;

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

// Public health check for an external uptime monitor: {status:"ok"} or a
// 503, nothing else (lib/health.js). Details live behind /api/admin/health.
app.get('/health', publicHealthHandler);
// Liveness: no dependencies (lib/health.js livezHandler).
app.get('/livez', livezHandler);

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

// Contact and Enterprise enquiries. Public and session-optional, and NOT behind
// BILLING_ENABLED — support cannot depend on a billing flag. Mounted before
// /api, whose blanket requireAuth would otherwise 401 a logged-out visitor.
app.use('/api/contact', contactRoutes);

// The announcement banner feed (Gate 7). Public, like contact: mounted before
// /api's blanket requireAuth.
app.use('/api/announcements', announcementRoutes);

// Admin panel routes (must be mounted before /api), on the ADMIN session:
// separate cookie, separate table, SameSite=Strict, Path=/api/admin.
// The trailing 404 is load-bearing: without it an admin request for a path
// the admin router does not define falls through to the customer /api router
// below, whose blanket requireAuth answers 401 "Log in to continue." — a
// different answer from the one every other unknown admin path gets.
const adminStore = buildAdminStore();
app.use('/api/admin', buildAdminSessionMiddleware({ store: adminStore }), adminRoutes, notFoundHandler);

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

/**
 * Schema check BEFORE the socket opens.
 *
 * Deploys are automatic on push to master; migrations are run by hand in the
 * service shell (DEPLOYMENT-RUNBOOK PHASE 4). So new code routinely goes live
 * before the schema catches up, and a Prisma Client that is ahead of its
 * database breaks Instagram connect for every user while /health still
 * answers 200. See lib/migrationGuard.js for the full mechanism.
 *
 * Nothing is listening until this passes, so a behind-schema deploy fails
 * loudly at boot instead of quietly at signup.
 */
/**
 * Graceful shutdown (SIGTERM on every deploy and scale-in; SIGINT locally).
 *
 * Budget: the platform kills us shortly after SIGTERM, so everything here is
 * bounded to SHUTDOWN_TIMEOUT_MS and a hard exit follows regardless.
 *   1. /health starts answering 503 — the load balancer stops routing to us.
 *   2. Stop accepting connections; tell sockets to reconnect (they land on a
 *      live instance, and the Redis adapter keeps their rooms working).
 *   3. Stop timers, let the queue worker finish or hand back its job
 *      (BullMQ re-delivers it elsewhere), close the lock pool.
 *   4. Close the session pools, Prisma and Redis.
 */
const SHUTDOWN_TIMEOUT_MS = 8000;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received — shutting down gracefully (max ${SHUTDOWN_TIMEOUT_MS / 1000}s).`);
  markShuttingDown();

  const hardExit = setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out; exiting.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  hardExit.unref();

  const step = (name, fn) =>
    Promise.resolve()
      .then(fn)
      .catch((err) => console.error(`[Server] Shutdown step "${name}" failed:`, err.message));

  const httpClosed = new Promise((resolve) => server.close(() => resolve()));
  await step('sockets', () => io.close());
  await step('workers', () => stopWorkers());
  // Keep-alive connections would hold server.close() open until they idle out.
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
  await Promise.race([httpClosed, new Promise((r) => setTimeout(r, 3000).unref())]);
  await step('session pool', async () => {
    await sessionStore.close();
    await sessionPool.end();
  });
  await step('admin session pool', async () => {
    await adminStore.close();
    await adminStore.dbPool.end();
  });
  await step('prisma', () => prisma.$disconnect());
  await step('redis', () => closeRedis());

  clearTimeout(hardExit);
  console.log('[Server] Shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

assertMigrationsCurrent().then(() => {
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
});

// ============================================
// 404 and error handling
//
// Extracted to middleware/errorHandlers.js so the TEST HARNESS mounts the
// identical code — a harness whose error shape differs from production tests
// nothing about the error shape.
// ============================================
app.use(notFoundHandler);
app.use(errorHandler);
