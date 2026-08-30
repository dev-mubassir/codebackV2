/**
 * H10 at the fourth privilege transition: admin login.
 *
 * Also pins the invariant scripts/test-isolation.js asserts by hand —
 * elevating to admin must not log a signed-in regular user out of the main
 * app, because both identities share one cookie. Regenerating the session
 * without carrying that identity across would do exactly that.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { sessionIdFrom } from './helpers/app.js';
import { resetDb, createUser } from './helpers/db.js';

const bcrypt = (await import('bcryptjs')).default;

// Configure the credential explicitly, via the hash path production uses.
// Relying on whatever ADMIN_* happens to be in the ambient environment made
// this suite depend on the developer's own .env.
const ADMIN_USERNAME = 'root-admin';
const ADMIN_PASSWORD = 'admin-pass-for-tests';
process.env.ADMIN_USERNAME = ADMIN_USERNAME;
process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(ADMIN_PASSWORD, 4);
delete process.env.ADMIN_PASSWORD;

const authRoutes = (await import('../src/routes/auth.js')).default;
const adminRoutes = (await import('../src/routes/admin.js')).default;

let app;
let ipCounter = 0;
const nextIp = () => `10.11.0.${(ipCounter++ % 250) + 1}`;

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
  app.use('/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
});

beforeEach(async () => {
  await resetDb();
});

describe('H10 — admin login is a privilege transition', () => {
  it('issues a fresh session id on admin login', async () => {
    const { user, password } = await createUser({});
    const ip = nextIp();
    const agent = request.agent(app);

    const login = await agent
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: user.email, password });
    const beforeSid = sessionIdFrom(login);
    expect(beforeSid).toBeTruthy();

    const adminLogin = await agent
      .post('/api/admin/login')
      .set('X-Forwarded-For', ip)
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    expect(adminLogin.status).toBe(200);

    // Must actually issue a cookie. Without this, a response that sets none
    // yields null from sessionIdFrom() and the inequality below passes
    // vacuously against the very bug it is meant to catch.
    const afterSid = sessionIdFrom(adminLogin);
    expect(afterSid, 'admin login must issue a session cookie').toBeTruthy();
    expect(afterSid, 'admin elevation must rotate the session id').not.toBe(beforeSid);
  });

  it('does not log the signed-in regular user out of the main app', async () => {
    const { user, password } = await createUser({});
    const ip = nextIp();
    const agent = request.agent(app);

    await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email: user.email, password });
    await agent
      .post('/api/admin/login')
      .set('X-Forwarded-For', ip)
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    const me = await agent.get('/auth/me');
    expect(me.status, 'the regular user session must survive admin elevation').toBe(200);
    expect(me.body.id).toBe(user.id);
  });

  it('does not grant a regular user id from admin credentials alone', async () => {
    const ip = nextIp();
    const agent = request.agent(app);

    const adminLogin = await agent
      .post('/api/admin/login')
      .set('X-Forwarded-For', ip)
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    expect(adminLogin.status).toBe(200);

    // Admin identity must not confer a tenant identity.
    const me = await agent.get('/auth/me');
    expect(me.status).toBe(401);
  });
});
