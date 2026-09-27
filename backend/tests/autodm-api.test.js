/**
 * /api/autodm — CRUD, validation limits, tenant isolation, uploads, public
 * image serving — and the retention cleanup.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb } from './helpers/db.js';
import { saveFlags, installGraphStub, metaError, autodmTenant, createAutomation, prisma, uniq } from './helpers/autodm.js';

const require = createRequire(import.meta.url);
const autodm = require('../src/features/autodm/index.js');
const { runCleanup } = require('../src/features/autodm/cleanup.js');

let app;
let restoreFlags;
let ipSeq = 0;

beforeAll(() => {
  app = buildTestApp({ mount: { '/public/autodm': autodm.publicRouter, '/api/autodm': autodm.apiRouter } });
});

beforeEach(async () => {
  await resetDb();
  restoreFlags = saveFlags();
  process.env.AUTODM_ENABLED = 'true';
  process.env.AUTODM_POLL_MODE = 'off';
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreFlags();
});

async function login(t) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set('X-Forwarded-For', `10.88.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`).send({ email: t.user.email, password: t.password });
  expect(res.status).toBe(200);
  return agent;
}

const body = (t, over = {}) => ({
  instagramAccountId: t.account.id,
  name: 'Guide',
  postScope: 'ANY',
  triggerType: 'KEYWORDS',
  keywords: ['guide'],
  openerText: 'Tap below or reply LINK.',
  mainText: 'Here you go',
  linkUrl: 'https://example.com/guide',
  linkLabel: 'Open',
  ...over,
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

describe('CRUD', () => {
  it('create -> list with counts -> get -> update -> pause -> runs -> delete', async () => {
    const t = await autodmTenant();
    const agent = await login(t);

    const created = await agent.post('/api/autodm/automations').send(body(t));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Guide', status: 'active', counts: { matched: 0 } });
    const id = created.body.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await agent.get('/api/autodm/automations');
    expect(list.body.map((a) => a.id)).toEqual([id]);

    const updated = await agent.put(`/api/autodm/automations/${id}`).send(body(t, { name: 'Guide v2', triggerType: 'ANY_COMMENT', keywords: [] }));
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Guide v2', triggerType: 'ANY_COMMENT', keywords: [] });

    expect((await agent.patch(`/api/autodm/automations/${id}/status`).send({ status: 'paused' })).body.status).toBe('paused');
    expect((await agent.get(`/api/autodm/automations/${id}/runs`)).body).toEqual([]);
    expect((await agent.delete(`/api/autodm/automations/${id}`)).status).toBe(200);
    expect((await agent.get(`/api/autodm/automations/${id}`)).status).toBe(404);
  });

  it('an account without the comments scope gets 409 RECONNECT_REQUIRED', async () => {
    const t = await autodmTenant({ commentsGranted: false });
    const agent = await login(t);
    const res = await agent.post('/api/autodm/automations').send(body(t));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RECONNECT_REQUIRED');
    const accounts = await agent.get('/api/autodm/accounts');
    expect(accounts.body[0]).toMatchObject({ id: t.account.id, commentsGranted: false, ready: false });
  });

  it('the media list never passes Meta errors through', async () => {
    const t = await autodmTenant();
    const agent = await login(t);
    installGraphStub({ '/me/media': () => { throw metaError(2); } });
    const res = await agent.get(`/api/autodm/accounts/${t.account.id}/media`);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('secret meta text');
  });
});

describe('validation limits', () => {
  const cases = [
    ['name over 60', { name: 'x'.repeat(61) }],
    ['31 keywords', { keywords: Array.from({ length: 31 }, (_, i) => `k${i}`) }],
    ['a 51-char keyword', { keywords: ['k'.repeat(51)] }],
    ['opener over 640 chars', { openerText: 'a'.repeat(641) }],
    ['opener over 1000 UTF-8 bytes (Hindi)', { openerText: 'कि'.repeat(170) }],
    ['main text over 640 with a link button', { mainText: 'a'.repeat(641) }],
    ['main text over 900 without a link', { mainText: 'a'.repeat(901), linkUrl: null, linkLabel: null }],
    ['button label over 20', { openerButtonLabel: 'x'.repeat(21) }],
    ['4 public replies', { publicReplyEnabled: true, publicReplies: ['a', 'b', 'c', 'd'] }],
    ['a 301-char public reply', { publicReplyEnabled: true, publicReplies: ['a'.repeat(301)] }],
    ['http link', { linkUrl: 'http://example.com' }],
    ['javascript link', { linkUrl: 'javascript:alert(1)' }],
    ['data link', { linkUrl: 'data:text/html,hi' }],
    ['localhost link', { linkUrl: 'https://localhost/x' }],
    ['IP-literal link', { linkUrl: 'https://1.2.3.4/x' }],
    ['credentials in link', { linkUrl: 'https://user:pass@example.com/x' }],
    ['link without a label', { linkLabel: null }],
    ['keywords trigger with no keywords', { keywords: [] }],
    ['specific posts with none picked', { postScope: 'SPECIFIC', mediaIds: [] }],
    ['unknown key (mass assignment)', { userId: 'someone-else' }],
    ['reserved fallback keyword', { fallbackKeyword: 'AUTODM:x' }],
  ];

  it.each(cases)('rejects %s with 400', async (_label, over) => {
    const t = await autodmTenant();
    const agent = await login(t);
    const res = await agent.post('/api/autodm/automations').send(body(t, over));
    expect(res.status).toBe(400);
  });

  it('accepts a 900-char main text without a link and Hindi text within limits', async () => {
    const t = await autodmTenant();
    const agent = await login(t);
    const res = await agent.post('/api/autodm/automations').send(body(t, { mainText: 'a'.repeat(900), linkUrl: null, linkLabel: null, openerText: 'लिंक के लिए LINK लिखें' }));
    expect(res.status).toBe(201);
  });
});

describe('tenant isolation', () => {
  it("cross-tenant read, update, toggle, delete, run log, media and image use are all 404/400 — never someone else's data", async () => {
    const a = await autodmTenant();
    const b = await autodmTenant();
    const agentA = await login(a);
    const agentB = await login(b);
    const created = await agentA.post('/api/autodm/automations').send(body(a));
    const id = created.body.id;
    const img = await agentA.post('/api/autodm/images').set('Content-Type', 'image/png').send(PNG);

    expect((await agentB.get(`/api/autodm/automations/${id}`)).status).toBe(404);
    expect((await agentB.put(`/api/autodm/automations/${id}`).send(body(b))).status).toBe(404);
    expect((await agentB.patch(`/api/autodm/automations/${id}/status`).send({ status: 'paused' })).status).toBe(404);
    expect((await agentB.delete(`/api/autodm/automations/${id}`)).status).toBe(404);
    expect((await agentB.get(`/api/autodm/automations/${id}/runs`)).status).toBe(404);
    expect((await agentB.get(`/api/autodm/accounts/${a.account.id}/media`)).status).toBe(404);
    expect((await agentB.get('/api/autodm/automations').query({ accountId: a.account.id })).body).toEqual([]);
    expect((await agentB.post('/api/autodm/automations').send(body(b, { instagramAccountId: a.account.id }))).status).toBe(404);
    expect((await agentB.post('/api/autodm/automations').send(body(b, { imageId: img.body.id }))).status).toBe(400);

    const still = await prisma.autoDmAutomation.findUnique({ where: { id } });
    expect(still).toMatchObject({ status: 'active', name: 'Guide' });
  });

  it('an automation cannot be moved to another account', async () => {
    const t = await autodmTenant();
    const agent = await login(t);
    const created = await agent.post('/api/autodm/automations').send(body(t));
    const other = await prisma.instagramAccount.create({ data: { userId: t.user.id, igUserId: uniq('ig'), accessToken: 'x' } });
    const res = await agent.put(`/api/autodm/automations/${created.body.id}`).send(body(t, { instagramAccountId: other.id }));
    expect(res.status).toBe(400);
  });
});

describe('uploads and public serving', () => {
  it('JPG and PNG are accepted by magic bytes; SVG, GIF, fake PNGs and oversize files are refused', async () => {
    const t = await autodmTenant();
    const agent = await login(t);
    expect((await agent.post('/api/autodm/images').set('Content-Type', 'image/png').send(PNG)).status).toBe(201);
    expect((await agent.post('/api/autodm/images').set('Content-Type', 'image/jpeg').send(JPEG)).body.contentType).toBe('image/jpeg');

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await agent.post('/api/autodm/images').set('Content-Type', 'image/svg+xml').send(svg)).status).toBe(415);
    expect((await agent.post('/api/autodm/images').set('Content-Type', 'image/gif').send(Buffer.from('GIF89a' + 'x'.repeat(40)))).status).toBe(415);
    expect((await agent.post('/api/autodm/images').set('Content-Type', 'image/png').send(Buffer.from('not really a png at all, just text'))).status).toBe(415);
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    expect((await agent.post('/api/autodm/images').set('Content-Type', 'image/png').send(big)).status).toBe(413);
  });

  it('an image is public only while attached; headers are strict; deleting the automation makes it 404', async () => {
    const t = await autodmTenant();
    const agent = await login(t);
    const img = await agent.post('/api/autodm/images').set('Content-Type', 'image/png').send(PNG);
    const url = `/public/autodm/images/${img.body.id}`;
    expect((await request(app).get(url)).status).toBe(404); // not attached yet

    const created = await agent.post('/api/autodm/automations').send(body(t, { imageId: img.body.id }));
    expect(created.body.imageId).toBe(img.body.id);

    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(Buffer.compare(res.body, PNG)).toBe(0);

    await agent.delete(`/api/autodm/automations/${created.body.id}`);
    expect((await request(app).get(url)).status).toBe(404);
    expect((await request(app).get('/public/autodm/images/not-a-uuid')).status).toBe(404);
  });

  it('replacing the image deletes the old one', async () => {
    const t = await autodmTenant();
    const agent = await login(t);
    const first = await agent.post('/api/autodm/images').set('Content-Type', 'image/png').send(PNG);
    const created = await agent.post('/api/autodm/automations').send(body(t, { imageId: first.body.id }));
    const second = await agent.post('/api/autodm/images').set('Content-Type', 'image/jpeg').send(JPEG);
    await agent.put(`/api/autodm/automations/${created.body.id}`).send(body(t, { imageId: second.body.id }));
    expect(await prisma.autoDmImage.findUnique({ where: { id: first.body.id } })).toBeNull();
    expect((await request(app).get(`/public/autodm/images/${second.body.id}`)).status).toBe(200);
  });
});

describe('retention cleanup', () => {
  it('deletes 90-day-old runs, day-old unattached uploads, disconnected and moved accounts\' data', async () => {
    const t = await autodmTenant();
    const a = await createAutomation(t);
    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    const mk = (i, extra = {}) => ({
      id: crypto.randomUUID(), userId: t.user.id, instagramAccountId: t.account.id, automationId: a.id,
      commentId: `ret-${i}`, commenterId: `ret-fan-${i}`, commentCreatedAt: new Date(), ...extra,
    });
    await prisma.autoDmRun.createMany({ data: [mk(1, { createdAt: old }), mk(2)] });
    await prisma.autoDmImage.create({ data: { userId: t.user.id, contentType: 'image/png', byteSize: 3, data: Buffer.from('abc'), createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    const d = await autodmTenant();
    await createAutomation(d);
    await prisma.instagramAccount.update({ where: { id: d.account.id }, data: { connectionStatus: 'DISCONNECTED' } });

    const m = await autodmTenant();
    await createAutomation(m);
    const newOwner = await autodmTenant();
    await prisma.instagramAccount.update({ where: { id: m.account.id }, data: { userId: newOwner.user.id } });

    const out = await runCleanup();
    expect(out.oldRuns).toBe(1);
    expect(out.orphanImages).toBe(1);
    expect(out.disconnectedAccounts).toBe(1);
    expect(out.movedRows).toBeGreaterThanOrEqual(2);

    expect(await prisma.autoDmRun.count({ where: { automationId: a.id } })).toBe(1);
    expect(await prisma.autoDmAutomation.count({ where: { instagramAccountId: d.account.id } })).toBe(0);
    expect(await prisma.autoDmAccountState.count({ where: { instagramAccountId: d.account.id } })).toBe(0);
    expect(await prisma.autoDmAutomation.count({ where: { instagramAccountId: m.account.id } })).toBe(0);
    expect(await prisma.autoDmAutomation.count({ where: { instagramAccountId: t.account.id } })).toBe(1);
  });

  it('purging an account or deleting the user cascades all Auto DM data', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    await prisma.instagramAccount.delete({ where: { id: t.account.id } });
    expect(await prisma.autoDmAutomation.count({ where: { userId: t.user.id } })).toBe(0);
    expect(await prisma.autoDmAccountState.count({ where: { userId: t.user.id } })).toBe(0);

    const u = await autodmTenant();
    await createAutomation(u);
    await prisma.user.delete({ where: { id: u.user.id } });
    expect(await prisma.autoDmAutomation.count({ where: { userId: u.user.id } })).toBe(0);
  });
});
