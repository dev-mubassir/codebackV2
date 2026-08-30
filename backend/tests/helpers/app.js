/**
 * Builds an Express app that mounts the REAL auth router with the REAL
 * session middleware, without starting a server, Socket.io, or the job
 * workers (src/index.js does all three as an import side effect).
 *
 * Session config mirrors src/index.js:182-198, minus `secure`, which is
 * driven by NODE_ENV=production there and would stop supertest's plain-HTTP
 * requests from ever receiving the cookie.
 */

import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';

import security from '../../src/lib/security.js';
import authRoutes from '../../src/routes/auth.js';

const { securityHeaders, originGuard } = security;

export function buildTestApp() {
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
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mirrors the bare-root OAuth shim in src/index.js:295-300.
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

  return app;
}

/** Pull the codeback.sid cookie VALUE (not the whole Set-Cookie header). */
export function sessionIdFrom(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  const cookie = raw.find((c) => c.startsWith('codeback.sid='));
  if (!cookie) return null;
  return decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
}
