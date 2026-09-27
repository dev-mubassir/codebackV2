/**
 * Auto DM end to end: signed comment webhook -> run -> opener -> tap ->
 * follow gate -> main message. Only Meta's HTTP layer is stubbed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb } from './helpers/db.js';
import {
  saveFlags,
  postWebhook,
  waitFor,
  installGraphStub,
  metaError,
  autodmTenant,
  createAutomation,
  commentWebhook,
  postbackWebhook,
  dmWebhook,
  prisma,
  uniq,
} from './helpers/autodm.js';

const require = createRequire(import.meta.url);
const worker = require('../src/features/autodm/worker.js');
const jobs = require('../src/jobs/index.js');
const instagram = require('../src/lib/instagram.js');

let app;
let restoreFlags;
let graphStub;
let enqueue;

beforeAll(async () => {
  const webhookRoutes = (await import('../src/routes/webhook.js')).default;
  app = buildTestApp({ mount: { '/webhooks/instagram': webhookRoutes } });
});

beforeEach(async () => {
  await resetDb();
  restoreFlags = saveFlags();
  process.env.AUTODM_ENABLED = 'true';
  process.env.AUTODM_POLL_MODE = 'off';
  graphStub = installGraphStub();
  vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
  enqueue = vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreFlags();
});

async function commentAndOpen(t, automation, opts = {}) {
  const hook = commentWebhook(t.igUserId, opts);
  expect((await postWebhook(app, hook)).status).toBe(200);
  const commentId = hook.entry[0].changes[0].value.id;
  const run = await waitFor(() => prisma.autoDmRun.findUnique({ where: { commentId } }), 'the run');
  await worker.tick();
  return prisma.autoDmRun.findUnique({ where: { id: run.id } });
}

describe('happy path', () => {
  it('keyword comment -> opener (button template) -> GET postback -> main message with link button', async () => {
    const t = await autodmTenant();
    const automation = await createAutomation(t);

    const run = await commentAndOpen(t, automation);
    expect(run.status).toBe('OPENER_SENT');
    expect(run.igsid).toBe(`igsid-${run.commentId}`);

    const opener = graphStub.sends().find((c) => c.body.recipient.comment_id === run.commentId);
    expect(opener.body.message.attachment.payload.template_type).toBe('button');
    expect(opener.body.message.attachment.payload.buttons[0]).toEqual({
      type: 'postback',
      title: 'Send me the link',
      payload: `AUTODM:${run.id}:GET`,
    });

    expect((await postWebhook(app, postbackWebhook(t.igUserId, run.igsid, `AUTODM:${run.id}:GET`))).status).toBe(200);
    await waitFor(async () => (await prisma.autoDmRun.findUnique({ where: { id: run.id } })).pendingAction === 'GET', 'the GET claim');
    await worker.tick();

    const done = await prisma.autoDmRun.findUnique({ where: { id: run.id } });
    expect(done.status).toBe('DELIVERED');
    const main = graphStub.sends().find((c) => c.body.recipient.id === run.igsid);
    expect(main.body.message.attachment.payload.buttons[0]).toEqual({ type: 'web_url', url: 'https://example.com/guide', title: 'Open guide' });
  });

  it('the LINK keyword reply is handed to Auto DM, marked autodm, and never classified', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    const run = await commentAndOpen(t, null);

    const mid = uniq('mid');
    await postWebhook(app, dmWebhook(t.igUserId, run.igsid, { text: ' link ', mid }));
    const msg = await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the stored LINK message');
    await waitFor(async () => (await prisma.message.findUnique({ where: { id: msg.id } })).aiStatus === 'autodm', 'aiStatus autodm');
    expect(enqueue).not.toHaveBeenCalledWith(msg.id);

    await worker.tick();
    expect((await prisma.autoDmRun.findUnique({ where: { id: run.id } })).status).toBe('DELIVERED');
  });

  it('a normal DM is still stored and enqueued for classification', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    const mid = uniq('mid');
    await postWebhook(app, dmWebhook(t.igUserId, uniq('someone'), { text: 'what is the price?', mid }));
    const msg = await waitFor(() => prisma.message.findFirst({ where: { igMessageId: mid } }), 'the DM');
    await waitFor(() => enqueue.mock.calls.some((c) => c[0] === msg.id), 'the classification enqueue');
    expect((await prisma.message.findUnique({ where: { id: msg.id } })).aiStatus).toBe('pending');
  });
});

describe('opener fallbacks', () => {
  it('a rejected button template is retried once as plain text', async () => {
    const t = await autodmTenant();
    await createAutomation(t);
    let first = true;
    graphStub = null;
    vi.restoreAllMocks();
    enqueue = vi.spyOn(jobs, 'enqueueMessageAnalysis').mockResolvedValue(undefined);
    vi.spyOn(instagram, 'fetchUserProfile').mockResolvedValue(null);
    graphStub = installGraphStub({
      '/me/messages': (url, body) => {
        if (body.message.attachment && first) {
          first = false;
          throw metaError(100);
        }
        return { recipient_id: 'igsid-plain', message_id: 'm1' };
      },
    });
    const run = await commentAndOpen(t, null);
    expect(run.status).toBe('OPENER_SENT');
    const sends = graphStub.sends();
    expect(sends).toHaveLength(2);
    expect(sends[1].body.message).toEqual({ text: 'Tap below for the guide, or reply LINK.' });
  });
});
