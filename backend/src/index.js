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
const brandDealRoutes = require('./routes/brandDeals');
const notificationRoutes = require('./routes/notifications');
const settingsRoutes = require('./routes/settings');
const subscriptionRoutes = require('./routes/subscription');

const { setIO } = require('./lib/socket');
const { startWorkers } = require('./jobs');

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

// CORS — allow the frontend to make requests with cookies
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('ngrok')) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true,
}));

// Cookie parser
app.use(cookieParser());

// Trust proxy for secure cookies over ngrok
app.set('trust proxy', 1);

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  console.error('[Server] WARNING: SESSION_SECRET is not set in production. Set it in your environment before going live.');
}

// Session middleware — simple cookie-based sessions for testing
app.use(session({
  name: 'codeback.sid',
  secret: process.env.SESSION_SECRET || 'codeback-dev-secret-change-in-production',
  resave: true,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: isProduction ? 'none' : 'lax',
  },
}));

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
  console.log('[Socket.io] Client connected:', socket.id);

  // Client joins a room based on their user ID
  // Frontend sends: socket.emit('join', { userId: '...' })
  socket.on('join', ({ userId }) => {
    if (!userId) return;

    // SECURITY: Verify the session cookie matches the requested userId.
    // Without this, any client could join another user's room and
    // eavesdrop on their real-time messages.
    try {
      const cookieHeader = socket.handshake?.headers?.cookie || '';
      const sidCookie = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('codeback.sid='));

      if (sidCookie) {
        const rawSid = decodeURIComponent(sidCookie.split('=')[1]);
        // express-session signs the cookie as s:<id>.<signature>
        const unsignedSid = rawSid.startsWith('s:') ? rawSid.slice(2).split('.')[0] : rawSid;

        // Look up the session from the session store
        const store = socket.request?.sessionStore || socket.handshake?.sessionStore;
        if (store) {
          store.get(unsignedSid, (err, sessionData) => {
            if (err || !sessionData) {
              console.warn(`[Socket.io] Session lookup failed for socket ${socket.id}, allowing join as fallback`);
              socket.join(`user:${userId}`);
              return;
            }
            if (sessionData.userId === userId) {
              socket.join(`user:${userId}`);
              console.log(`[Socket.io] Socket ${socket.id} joined room user:${userId} (session verified)`);
            } else {
              console.warn(`[Socket.io] Socket ${socket.id} tried to join room user:${userId} but session belongs to user:${sessionData.userId}`);
            }
          });
          return;
        }
      }
    } catch (e) {
      console.warn(`[Socket.io] Session verification error for socket ${socket.id}:`, e.message);
    }

    // Fallback: if session store is unavailable (e.g. in-memory sessions
    // without store.get), allow the join but log it. This preserves
    // backwards compatibility while the SECURITY check above works when
    // a session store is accessible.
    socket.join(`user:${userId}`);
    console.log(`[Socket.io] Socket ${socket.id} joined room user:${userId} (no session store available)`);
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

// Brand deal pipeline
app.use('/api/brand-deals', brandDealRoutes);

// Notification center
app.use('/api/notifications', notificationRoutes);

// Creator AI preferences
app.use('/api/settings', settingsRoutes);

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
