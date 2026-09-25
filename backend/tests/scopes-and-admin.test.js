/**
 * H12 — requested OAuth scopes must match what the product can demonstrate.
 * M10 — admin credentials, which are effectively a master key to every
 *       tenant's DMs via impersonation.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { prisma, resetDb, createUser } from './helpers/db.js';

const require = createRequire(import.meta.url);
const instagram = require('../src/lib/instagram.js');

const adminRoutes = (await import('../src/routes/admin.js')).default;

let app;
let ipCounter = 0;
const nextIp = () => `10.12.0.${(ipCounter++ % 250) + 1}`;

beforeAll(() => {
  app = express();
  app.use(cookieParser());
  app.set('trust proxy', 1);
  app.use(
    session({
      name: 'codeback.sid',
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: false, sameSite: 'lax' },
    })
  );
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
});

beforeEach(async () => {
  await resetDb();
});

describe('H12 — requested permission scopes', () => {
  const scopesOf = () => {
    const url = new URL(instagram.getAuthorizationUrl('app-id', 'https://cb/callback', 'st4te'));
    return String(url.searchParams.get('scope')).split(',');
  };

  it('requests only the permissions the product actually uses', () => {
    expect(scopesOf().sort()).toEqual(
      ['instagram_business_basic', 'instagram_business_manage_messages'].sort()
    );
  });

  it('does not request comment management', () => {
    expect(scopesOf()).not.toContain('instagram_business_manage_comments');
  });

  it('does not request content publishing', () => {
    expect(scopesOf()).not.toContain('instagram_business_content_publish');
  });

  it('still carries the CSRF state alongside the reduced scopes', () => {
    const url = new URL(instagram.getAuthorizationUrl('app-id', 'https://cb/callback', 'st4te'));
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});

// TEMP: skipped in admin-rebuild Gate 1. Asserts the RETIRED environment-
// credential admin login (ADMIN_USERNAME / ADMIN_PASSWORD_HASH), which no
// longer exists — admins are AdminUser rows now. Replaced by
// tests/admin-auth.test.js ("login", "lockout").
describe.skip('M10 — admin credentials', () => {
  it('accepts a bcrypt ADMIN_PASSWORD_HASH', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const prev = { ...process.env };
    process.env.ADMIN_USERNAME = 'hash-admin';
    delete process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('s3cret-admin-pass', 4);

    const res = await request(app)
      .post('/api/admin/login')
      .set('X-Forwarded-For', nextIp())
      .send({ username: 'hash-admin', password: 's3cret-admin-pass' });

    expect(res.status).toBe(200);
    process.env = prev;
  });

  it('rejects a wrong password against the hash', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const prev = { ...process.env };
    process.env.ADMIN_USERNAME = 'hash-admin';
    delete process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('s3cret-admin-pass', 4);

    const res = await request(app)
      .post('/api/admin/login')
      .set('X-Forwarded-For', nextIp())
      .send({ username: 'hash-admin', password: 'not-the-password' });

    expect(res.status).toBe(401);
    process.env = prev;
  });

  it('ignores plaintext ADMIN_PASSWORD when NODE_ENV is production', async () => {
    const prev = { ...process.env };
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_USERNAME = 'plain-admin';
    process.env.ADMIN_PASSWORD = 'plaintext-pass';
    delete process.env.ADMIN_PASSWORD_HASH;

    const res = await request(app)
      .post('/api/admin/login')
      .set('X-Forwarded-For', nextIp())
      .send({ username: 'plain-admin', password: 'plaintext-pass' });

    // With no hash configured, production has no usable credential at all.
    expect(res.status, 'plaintext admin password must not work in production').not.toBe(200);

    process.env = prev;
  });
});

// TEMP: skipped in admin-rebuild Gate 1. Impersonation was REMOVED (owner
// decision: it exposes DM content, violating the admin privacy rule).
// Replaced by tests/admin-auth.test.js, which asserts the impersonation
// routes no longer exist.
describe.skip('M10 — impersonation is auditable end to end', () => {
  it('records the target tenant id on BOTH start and exit', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const prev = { ...process.env };
    process.env.ADMIN_USERNAME = 'audit-admin';
    delete process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('audit-pass-123', 4);

    const { user: tenant } = await createUser({ name: 'Target Tenant' });

    const agent = request.agent(app);
    const login = await agent
      .post('/api/admin/login')
      .set('X-Forwarded-For', nextIp())
      .send({ username: 'audit-admin', password: 'audit-pass-123' });
    expect(login.status).toBe(200);

    const start = await agent.post(`/api/admin/users/${tenant.id}/impersonate`).send({});
    expect(start.status).toBe(200);

    const exit = await agent.post('/api/admin/impersonate/exit').send({});
    expect(exit.status).toBe(200);

    const startLog = await prisma.adminLog.findFirst({
      where: { action: 'USER_IMPERSONATE_START' },
      orderBy: { createdAt: 'desc' },
    });
    const exitLog = await prisma.adminLog.findFirst({
      where: { action: 'USER_IMPERSONATE_EXIT' },
      orderBy: { createdAt: 'desc' },
    });

    expect(startLog, 'impersonation start must be logged').not.toBeNull();
    expect(startLog.targetId, 'start must name the tenant accessed').toBe(tenant.id);

    expect(exitLog, 'impersonation end must be logged').not.toBeNull();
    expect(
      exitLog.targetId,
      'exit must name the tenant accessed, so a session can be bounded'
    ).toBe(tenant.id);

    process.env = prev;
  });
});
