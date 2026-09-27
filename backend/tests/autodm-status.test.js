/**
 * Auto DM — kill switch, scope allowlist, and GET /api/autodm/status.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/app.js';
import { resetDb, createUser } from './helpers/db.js';
import autodm from '../src/features/autodm/index.js';
import config from '../src/features/autodm/config.js';

const FLAGS = ['AUTODM_ENABLED', 'AUTODM_SCOPE_ALLOWLIST', 'AUTODM_SCOPE_ALL', 'AUTODM_POLL_MODE'];
let saved;
let app;
let ipSeq = 0;
const nextIp = () => `10.61.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

async function login(email, password) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', nextIp()).send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(() => {
  app = buildTestApp({ mount: { '/api/autodm': autodm.apiRouter } });
});

beforeEach(async () => {
  saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
  for (const k of FLAGS) delete process.env[k];
  await resetDb();
});

afterEach(() => {
  for (const k of FLAGS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('config flags', () => {
  it('everything is off by default', () => {
    expect(config.isEnabled()).toBe(false);
    expect(config.pollMode()).toBe('off');
    expect(config.isScopeAllowed('a@b.co')).toBe(false);
  });

  it('the allowlist is case- and space-insensitive, and only counts while enabled', () => {
    process.env.AUTODM_SCOPE_ALLOWLIST = ' Owner@Example.com , other@x.io ';
    expect(config.isScopeAllowed('owner@example.com')).toBe(false); // kill switch still off
    process.env.AUTODM_ENABLED = 'true';
    expect(config.isScopeAllowed('owner@example.com')).toBe(true);
    expect(config.isScopeAllowed('OTHER@x.io')).toBe(true);
    expect(config.isScopeAllowed('stranger@x.io')).toBe(false);
    expect(config.isScopeAllowed(null)).toBe(false);
  });

  it('AUTODM_SCOPE_ALL opens it to everyone (still only while enabled)', () => {
    process.env.AUTODM_SCOPE_ALL = 'true';
    expect(config.isScopeAllowed('anyone@x.io')).toBe(false);
    process.env.AUTODM_ENABLED = 'true';
    expect(config.isScopeAllowed('anyone@x.io')).toBe(true);
  });

  it('poll mode: off while disabled, allowlist by default, all/off on request, unknown = off', () => {
    process.env.AUTODM_POLL_MODE = 'all';
    expect(config.pollMode()).toBe('off'); // kill switch still off
    process.env.AUTODM_ENABLED = 'true';
    expect(config.pollMode()).toBe('all');
    delete process.env.AUTODM_POLL_MODE;
    expect(config.pollMode()).toBe('allowlist');
    process.env.AUTODM_POLL_MODE = 'OFF';
    expect(config.pollMode()).toBe('off');
    process.env.AUTODM_POLL_MODE = 'sometimes';
    expect(config.pollMode()).toBe('off');
  });
});

describe('GET /api/autodm/status', () => {
  it('requires a session', async () => {
    const res = await request(app).get('/api/autodm/status');
    expect(res.status).toBe(401);
  });

  it('reports disabled when the kill switch is off, even for an allowlisted user', async () => {
    const { user, password } = await createUser();
    process.env.AUTODM_SCOPE_ALLOWLIST = user.email;
    const agent = await login(user.email, password);
    const res = await agent.get('/api/autodm/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, available: false });
  });

  it('is available only to allowlisted users when enabled', async () => {
    const a = await createUser();
    const b = await createUser();
    process.env.AUTODM_ENABLED = 'true';
    process.env.AUTODM_SCOPE_ALLOWLIST = a.user.email;

    const agentA = await login(a.user.email, a.password);
    expect((await agentA.get('/api/autodm/status')).body).toEqual({ enabled: true, available: true });

    const agentB = await login(b.user.email, b.password);
    expect((await agentB.get('/api/autodm/status')).body).toEqual({ enabled: true, available: false });
  });

  it('every other route answers 404 AUTODM_DISABLED while off or not allowed', async () => {
    const { user, password } = await createUser();
    const agent = await login(user.email, password);
    let res = await agent.get('/api/autodm/automations');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('AUTODM_DISABLED');

    process.env.AUTODM_ENABLED = 'true'; // on, but this user is not allowlisted
    res = await agent.get('/api/autodm/automations');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('AUTODM_DISABLED');
  });
});
