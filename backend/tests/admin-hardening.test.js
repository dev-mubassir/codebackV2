/**
 * Admin rebuild, Gate 8 — hardening checks across the whole admin surface.
 *
 *   - CSRF: EVERY admin mutation (read from the router itself, so a route
 *     added later is covered automatically) refuses a missing or foreign
 *     Origin, even with a valid admin session and a fresh step-up.
 *   - Headers: admin API answers are no-store + noindex, on top of the global
 *     security headers — including the 404 a non-admin gets.
 *   - Frontend: the admin segment is noindex (metadata + header), and nothing
 *     in the customer app links to it.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';

import { buildTestApp } from './helpers/app.js';
import { resetDb, createAdmin } from './helpers/db.js';

const require = createRequire(import.meta.url);
const adminRoutes = require('../src/routes/admin.js');

const ORIGIN = 'https://app.test.local';
const FRONTEND = path.resolve(__dirname, '../../frontend');
let app;
let ipSeq = 0;
const ip = () => `10.180.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(() => {
  app = buildTestApp({ admin: adminRoutes });
});
beforeEach(async () => {
  await resetDb();
});

function mutations() {
  const out = [];
  for (const layer of adminRoutes.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      if (method !== 'get') out.push({ method, path: layer.route.path });
    }
  }
  return out;
}
const concrete = (p) => `/api/admin${p.replace(/:[A-Za-z]+/g, '00000000-0000-0000-0000-000000000000')}`;

describe('CSRF — every admin mutation needs the allowlisted Origin', () => {
  it('refuses a missing or foreign Origin on every non-GET route, even fully authenticated', async () => {
    const { admin, password } = await createAdmin();
    const agent = request.agent(app).set('X-Forwarded-For', ip());
    expect((await agent.post('/api/admin/login').set('Origin', ORIGIN).send({ email: admin.email, password })).status).toBe(200);
    expect((await agent.post('/api/admin/step-up').set('Origin', ORIGIN).send({ password })).status).toBe(200);

    const routes = mutations();
    expect(routes.length).toBeGreaterThanOrEqual(30);
    for (const r of routes) {
      const url = concrete(r.path);
      const none = await agent[r.method](url).send({ reason: 'csrf probe' });
      expect(none.status, `${r.method.toUpperCase()} ${r.path} without Origin`).toBe(403);
      const evil = await agent[r.method](url).set('Origin', 'https://evil.example').send({ reason: 'csrf probe' });
      expect(evil.status, `${r.method.toUpperCase()} ${r.path} with a foreign Origin`).toBe(403);
    }
  });
});

describe('admin API response headers', () => {
  it('no-store + noindex + the global security headers, for admins and non-admins alike', async () => {
    const anon = await request(app).get('/api/admin/me');
    expect(anon.status).toBe(404);
    for (const res of [anon, await request(app).post('/api/admin/login').set('Origin', ORIGIN).set('X-Forwarded-For', ip()).send({})]) {
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    }
  });
});

describe('frontend admin segment', () => {
  it('is noindex in metadata and in the response headers', () => {
    const layout = fs.readFileSync(path.join(FRONTEND, 'src/app/admin/layout.js'), 'utf8');
    expect(layout).not.toMatch(/^'use client'/m);
    expect(layout).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
    const config = fs.readFileSync(path.join(FRONTEND, 'next.config.mjs'), 'utf8');
    expect(config).toMatch(/source:\s*'\/admin\/:path\*'/);
    expect(config).toContain("'X-Robots-Tag', value: 'noindex, nofollow'");
    expect(config).toContain("frame-ancestors 'none'");
  });

  it('nothing in the customer app links to /admin', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full === path.join(FRONTEND, 'src/app/admin')) continue;
          walk(full);
        } else if (/\.(js|jsx|mjs|md)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (/href=\{?\s*["'`]\/admin|push\(\s*["'`]\/admin|replace\(\s*["'`]\/admin|location\.href\s*=\s*["'`]\/admin/.test(text)) {
            offenders.push(path.relative(FRONTEND, full));
          }
        }
      }
    };
    walk(path.join(FRONTEND, 'src'));
    // lib/api.js may send an ADMIN page back to the admin login; it never
    // links a customer page there (the branch is guarded by pathname).
    expect(offenders.filter((f) => f !== path.join('src', 'lib', 'api.js'))).toEqual([]);
    for (const f of ['public/robots.txt', 'src/app/sitemap.js', 'src/app/robots.js']) {
      const full = path.join(FRONTEND, f);
      if (fs.existsSync(full)) expect(fs.readFileSync(full, 'utf8')).not.toContain('/admin');
    }
  });
});
