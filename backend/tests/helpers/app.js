/**
 * Builds an Express app that mounts the REAL routers with the REAL middleware,
 * without starting a server, Socket.io, or the job workers (src/index.js does
 * all three as an import side effect).
 *
 * PARITY WITH PRODUCTION IS THE POINT. Two things differ from src/index.js,
 * both deliberate, both narrow:
 *
 *   1. `secure` is forced false on the cookie. In production it follows
 *      NODE_ENV, and a Secure cookie is never stored or resent by supertest's
 *      plain-HTTP agent, so every authenticated test would silently 401.
 *
 *   2. The session store is the default MemoryStore rather than Postgres.
 *      Tests run single-process and are torn down between files, so the
 *      properties Postgres buys (cross-instance sharing, restart survival)
 *      are not under test here.
 *
 * Everything else — middleware ORDER, the body parser, the origin guard, the
 * security headers — matches. In particular the body parser now uses the same
 * express.json({ verify }) that captures req.rawBody as an exact Buffer, so a
 * webhook signature test exercises the real thing. A harness that parsed
 * bodies differently from production would test nothing.
 */

import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';

import security from '../../src/lib/security.js';
import authRoutes from '../../src/routes/auth.js';

const { securityHeaders, originGuard } = security;

/**
 * @param {object} [options]
 * @param {Record<string, import('express').Router>} [options.mount]
 *   Extra routers to mount, keyed by path — e.g. { '/api': apiRoutes }.
 *   `/auth` is always mounted.
 */
export function buildTestApp({ mount = {} } = {}) {
  const app = express();

  app.use(securityHeaders);
  app.use(cookieParser());
  app.set('trust proxy', 1);

  app.use(
    session({
      name: 'codeback.sid',
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: false, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' },
    })
  );

  app.use(originGuard);

  // Identical to src/index.js. `verify` hands us the exact bytes body-parser
  // is about to parse, which is what the webhook HMAC must be computed over.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // Mirrors the bare-root OAuth shim in src/index.js.
  app.get('/', (req, res) => {
    if (req.query.code) {
      const qs = new URLSearchParams();
      qs.set('code', req.query.code);
      if (req.query.state) qs.set('state', req.query.state);
      return res.redirect(`/auth/instagram/callback?${qs.toString()}`);
    }
    res.send('Codeback Backend is running');
  });

  app.use('/auth', authRoutes);
  for (const [path, router] of Object.entries(mount)) {
    app.use(path, router);
  }

  return app;
}

/**
 * The decoded value of the codeback.sid cookie, so tests can assert that a
 * session id ROTATED (session fixation) rather than merely that a cookie was
 * set.
 */
export function sessionIdFrom(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  const cookie = raw.find((c) => c.startsWith('codeback.sid='));
  if (!cookie) return null;
  return decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
}
