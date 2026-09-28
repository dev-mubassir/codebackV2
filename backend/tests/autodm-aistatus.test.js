/**
 * A message handed to Auto DM carries aiStatus 'autodm'. Nothing in the
 * existing pipeline may pick it up again: not the orphan re-queue sweep, not
 * the stalled-analysis sweep, not skipped-message recovery, not the billing
 * "unsorted" count, not the dashboard "reviewed" count.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb, createUser, createAccount, prisma, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const jobs = require('../src/jobs/index.js');
const aiService = require('../src/services/aiService.js');
const { sweepStalledAnalyses } = require('../src/jobs/messageAnalysisJob.js');
const { recoverSkippedMessages, countUnsortedMessages } = require('../src/services/skippedMessageRecovery.js');

let app;
let ipSeq = 0;

beforeAll(async () => {
  const dashboardRoutes = (await import('../src/routes/dashboard.js')).default;
  app = buildTestApp({ mount: { '/api/dashboard': dashboardRoutes } });
});

beforeEach(async () => {
  await resetDb();
  // The control case re-queues a real analysis job; it must never reach a provider.
  vi.spyOn(aiService, 'analyzeConversation').mockResolvedValue(null);
  vi.spyOn(aiService, 'summarizeConversation').mockResolvedValue({ summary: null, stage: null, failed: true });
});

afterEach(() => vi.restoreAllMocks());

async function seed(aiStatus, { minutesAgo = 20, extra = {} } = {}) {
  const { user, password } = await createUser({});
  const account = await createAccount({ userId: user.id });
  const contact = await prisma.contact.create({ data: { instagramAccountId: account.id, igsid: uniq('igsid'), username: 'fan' } });
  const conversation = await prisma.conversation.create({ data: { instagramAccountId: account.id, contactId: contact.id } });
  const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000);
  const message = await prisma.message.create({
    data: { conversationId: conversation.id, igMessageId: uniq('mid'), direction: 'inbound', content: 'LINK', aiStatus, createdAt, ...extra },
  });
  return { user, password, account, message };
}

describe("aiStatus 'autodm' is invisible to the existing pipeline", () => {
  it('the orphan re-queue sweep ignores it (and still re-queues a pending one)', async () => {
    const { message } = await seed('autodm');
    expect(await jobs.requeueOrphanedAnalyses()).toBe(0);
    expect((await prisma.message.findUnique({ where: { id: message.id } })).aiStatus).toBe('autodm');

    await seed('pending');
    expect(await jobs.requeueOrphanedAnalyses()).toBe(1); // control: the sweep itself works
  });

  it('the stalled-analysis sweep ignores it', async () => {
    const { message } = await seed('autodm', { minutesAgo: 60 });
    expect(await sweepStalledAnalyses()).toBe(0);
    expect((await prisma.message.findUnique({ where: { id: message.id } })).aiStatus).toBe('autodm');
  });

  it('skipped-message recovery and the billing unsorted count ignore it', async () => {
    const { user, message } = await seed('autodm');
    await recoverSkippedMessages(user.id, { trigger: 'test' });
    expect((await prisma.message.findUnique({ where: { id: message.id } })).aiStatus).toBe('autodm');
    expect((await countUnsortedMessages(user.id)).count).toBe(0);
  });

  it("the dashboard's reviewed count does not include it", async () => {
    const { user, password } = await seed('autodm');
    const agent = request.agent(app);
    const login = await agent.post('/auth/login').set('X-Forwarded-For', `10.77.0.${++ipSeq}`).send({ email: user.email, password });
    expect(login.status).toBe(200);
    const res = await agent.get('/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.totalDmsReviewed).toBe(0);
  });
});
