/**
 * Auto DM — flags and GET /api/autodm/status. Access itself (modes, grants)
 * is covered in autodm-access.test.js.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/app.js';
import { resetDb, createUser } from './helpers/db.js';
import { saveFlags, setRolloutMode } from './helpers/autodm.js';
import autodm from '../src/features/autodm/index.js';
import config from '../src/features/autodm/config.js';

let restoreFlags;
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
  restoreFlags = saveFlags();
  await resetDb();
});

afterEach(() => restoreFlags());

describe('config flags', () => {
  it('everything is off by default', () => {
    expect(config.isEnabled()).toBe(false);
    expect(config.pollMode()).toBe('off');
    expect(config.isOnAllowlist('a@b.co')).toBe(false);
  });

  it('the env list is case- and space-insensitive', () => {
    process.env.AUTODM_SCOPE_ALLOWLIST = ' Owner@Example.com , other@x.io ';
    expect(config.isOnAllowlist('owner@example.com')).toBe(true);
    expect(config.isOnAllowlist('OTHER@x.io')).toBe(true);
    expect(config.isOnAllowlist('stranger@x.io')).toBe(false);
    expect(config.isOnAllowlist(null)).toBe(false);
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

  it('kill switch off: exactly {enabled:false}, even for a beta user in BETA mode', async () => {
    const { user, password } = await createUser();
    await setRolloutMode('BETA');
    process.env.AUTODM_SCOPE_ALLOWLIST = user.email;
    const agent = await login(user.email, password);
    const res = await agent.get('/api/autodm/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  it('BETA: available to a named beta user; everyone else sees only {enabled:false}', async () => {
    const a = await createUser();
    const b = await createUser();
    process.env.AUTODM_ENABLED = 'true';
    await setRolloutMode('BETA');
    process.env.AUTODM_SCOPE_ALLOWLIST = a.user.email;

    const agentA = await login(a.user.email, a.password);
    expect((await agentA.get('/api/autodm/status')).body).toEqual({ enabled: true, available: true });

    const agentB = await login(b.user.email, b.password);
    expect((await agentB.get('/api/autodm/status')).body).toEqual({ enabled: false });
  });

  it('every other route answers 404 AUTODM_DISABLED without access', async () => {
    const { user, password } = await createUser();
    const agent = await login(user.email, password);
    let res = await agent.get('/api/autodm/automations');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('AUTODM_DISABLED');

    process.env.AUTODM_ENABLED = 'true'; // on, mode OFF by default
    res = await agent.get('/api/autodm/automations');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('AUTODM_DISABLED');
  });
});
