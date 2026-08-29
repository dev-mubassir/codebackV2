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
const subscriptionRoutes = require('./routes/subscription');

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
const DEFAULT_SESSION_SECRET = 'codeback-dev-secret-change-in-production';

// ---- Critical production security assertions (fail closed) ----
if (isProduction && process.env.SKIP_SIGNATURE_VERIFICATION === 'true') {
  console.error('[Server] FATAL: SKIP_SIGNATURE_VERIFICATION=true is forbidden in production. Refusing to start.');
  process.exit(1);
}

if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === DEFAULT_SESSION_SECRET)) {
  console.error('[Server] FATAL: SESSION_SECRET must be set to a strong, unique value in production. Refusing to start.');
  process.exit(1);
}

if (isProduction && !process.env.INSTAGRAM_APP_SECRET) {
  console.error('[Server] FATAL: INSTAGRAM_APP_SECRET must be set in production (webhook signatures cannot be verified without it). Refusing to start.');
  process.exit(1);
}

// Loud warning for the dangerous "production deployment running in dev mode"
// case: public URLs but NODE_ENV !== production disables production safeguards.
const looksPublic = [process.env.FRONTEND_URL, process.env.BACKEND_URL]
  .some((u) => u && !/localhost|127\.0\.0\.1|local\.codeback\.test/.test(u));
if (!isProduction && looksPublic) {
  console.warn('[Server] WARNING: Public FRONTEND_URL/BACKEND_URL detected while NODE_ENV is not "production". Production safeguards (secure cookies, strict CORS/headers gating) are relaxed. Set NODE_ENV=production for public deployments.');
}

// Session middleware
const sessionMiddleware = session({
  name: 'codeback.sid',
  secret: process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET,
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

// JSON body parser — but we need raw body for webhook signature verification
// So we parse JSON manually for the webhook route, and use express.json() for everything else
app.use((req, res, next) => {
  if (req.originalUrl && req.originalUrl.includes('webhook') && req.method === 'POST') {
    // For webhook POST: collect raw body for signature verification
    let rawBody = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { rawBody += chunk; });
    req.on('end', () => {
      req.rawBody = rawBody;
      try {
        req.body = JSON.parse(rawBody);
      } catch (e) {
        req.body = {};
      }
      next();
    });
  } else {
    // For all other routes: use standard JSON parser
    express.json()(req, res, next);
  }
});

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

// Handle OAuth callback if REDIRECT_URI is exactly the ngrok root
app.get('/', (req, res) => {
  if (req.query.code) {
    return res.redirect(`/auth/instagram/callback?code=${req.query.code}`);
  }
  res.send('Codeback Backend is running');
});

// Auth routes (OAuth flow)
app.use('/auth', authRoutes);

// Webhook routes (Instagram webhook - mounted on both /webhook and /webhooks/instagram)
app.use('/webhook', webhookRoutes);
app.use('/webhooks/instagram', webhookRoutes);

// Admin panel routes (must be mounted before /api)
app.use('/api/admin', adminRoutes);

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

// Subscription + usage (GET /api/subscription, GET /api/usage)
app.use('/api', subscriptionRoutes);

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
