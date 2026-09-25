/**
 * Production bug (after the Gate 1 rewrite): the admin login succeeded, but
 * the panel sent the admin straight back to the login page.
 *
 * Reproduces the production setup: a Secure cookie (NODE_ENV=production
 * behaviour), behind a TLS-terminating proxy (trust proxy + X-Forwarded-Proto
 * https), cookie sent back by hand the way a browser would over HTTPS.
 *
 * Root cause: GET /api/admin/me answered { authenticated, email } without
 * `isAdmin`, and the admin shell (frontend AdminShell) requires
 * `authenticated && isAdmin`. The cookie and session were fine.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';

import { resetDb, createAdmin } from './helpers/db.js';

const require = createRequire(import.meta.url);
const adminRoutes = require('../src/routes/admin.js');
const { buildAdminSessionMiddleware } = require('../src/lib/adminSession.js');
const { securityHeaders } = require('../src/lib/security.js');
const { notFoundHandler } = require('../src/middleware/errorHandlers.js');

const ORIGIN = 'https://app.test.local';
let app;

beforeAll(() => {
  app = express();
  app.set('trust proxy', 1); // as src/index.js
  app.use(securityHeaders);
  app.use(express.json());
  app.use('/api/admin', buildAdminSessionMiddleware({ secure: true }), adminRoutes, notFoundHandler);
});
beforeEach(async () => {
  await resetDb();
});

const viaProxy = (req) => req.set('X-Forwarded-Proto', 'https').set('X-Forwarded-For', '10.190.0.1');

describe('admin login in the production setup', () => {
  it('sets a Secure/HttpOnly/SameSite=Strict cookie behind the proxy, and /me then satisfies the admin shell', async () => {
    const { admin, password } = await createAdmin();

    const login = await viaProxy(request(app).post('/api/admin/login'))
      .set('Origin', ORIGIN)
      .send({ email: admin.email, password });
    expect(login.status).toBe(200);

    const setCookie = (login.headers['set-cookie'] || []).find((c) => c.startsWith('siffty.admin.sid='));
    expect(setCookie, 'cookie must be set behind a trusted HTTPS proxy').toBeTruthy();
    expect(setCookie).toMatch(/; Secure/i);
    expect(setCookie).toMatch(/; HttpOnly/i);
    expect(setCookie).toMatch(/; SameSite=Strict/i);
    expect(setCookie).toMatch(/; Path=\/api\/admin/i);
    expect(setCookie).not.toMatch(/; Domain=/i); // host-only on the API host

    const cookie = setCookie.split(';')[0];
    const me = await viaProxy(request(app).get('/api/admin/me')).set('Cookie', cookie);
    expect(me.status).toBe(200);
    // Exactly what the admin shell checks before showing the panel.
    expect(me.body.authenticated).toBe(true);
    expect(me.body.isAdmin).toBe(true);

    // Non-admins still get the generic 404.
    expect((await viaProxy(request(app).get('/api/admin/me'))).status).toBe(404);
  });

  it('without a trusted HTTPS proxy hop, no Secure cookie is issued (never over plain HTTP)', async () => {
    const { admin, password } = await createAdmin();
    const login = await request(app).post('/api/admin/login').set('Origin', ORIGIN).set('X-Forwarded-For', '10.190.0.2').send({ email: admin.email, password });
    expect((login.headers['set-cookie'] || []).some((c) => c.startsWith('siffty.admin.sid='))).toBe(false);
  });

  it('the admin shell checks only fields /me returns', () => {
    const shell = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/app/admin/_components/AdminShell.js'), 'utf8');
    const checked = [...shell.matchAll(/adminData\.(\w+)/g)].map((m) => m[1]);
    for (const field of checked) {
      expect(['authenticated', 'isAdmin', 'email'], `AdminShell reads adminData.${field}`).toContain(field);
    }
  });
});
