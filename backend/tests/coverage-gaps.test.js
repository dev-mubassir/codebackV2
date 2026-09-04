/**
 * Coverage the rest of the suite does not reach.
 *
 * Each block here exists because the property is easy to regress and nothing
 * else asserts it:
 *
 *   - forgot-password must match on TIMING as well as body. Identical bodies
 *     with a measurable timing difference is still an enumeration oracle.
 *   - session eviction must hold on ALL THREE routes that previously carried
 *     hand-rolled session checks. Those checks skipped the sessionVersion
 *     comparison; if any one of them regresses, a reset stops evicting there
 *     and nothing else would notice.
 *   - the webhook must be EXEMPT from rate limiting. Meta bursts on retry, and
 *     a 429 to Meta is a dropped customer message.
 *   - trial expiry must stop AI work while leaving the inbox readable and the
 *     account unlocked.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createRequire } from 'module';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser, createAccount, uniq, expireTrial } from './helpers/db.js';
import { installMetaStubs, restoreMetaStubs, setIgUser } from './helpers/fake-meta.js';

const require = createRequire(import.meta.url);
const authTokens = require('../src/lib/authTokens.js');
const igIdentity = require('../src/lib/igIdentity.js');
const aiService = require('../src/services/aiService.js');

let app;
let apiApp;
let ipCounter = 0;
const nextIp = () => `10.81.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

async function loginAgent(targetApp, email, password) {
  const agent = request.agent(targetApp);
  const res = await agent
    .post('/auth/login')
    .set('X-Forwarded-For', nextIp())
    .send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  app = buildTestApp();
  const apiRoutes = (await import('../src/routes/api.js')).default;
  const webhookRoutes = (await import('../src/routes/webhook.js')).default;
  apiApp = buildTestApp({
    mount: { '/api': apiRoutes, '/webhooks/instagram': webhookRoutes },
  });
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('forgot-password matches on TIMING, not just body', () => {
  it('an existing and a non-existent address take comparable time', async () => {
    const { user } = await createUser({});

    // Several samples each, interleaved, so ordering and warm-up affect both
    // equally. A single pair would be noise.
    const timeOne = async (address) => {
      const started = process.hrtime.bigint();
      await request(app)
        .post('/auth/forgot-password')
        .set('X-Forwarded-For', nextIp())
        .send({ email: address });
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const real = [];
    const fake = [];
    for (let i = 0; i < 5; i += 1) {
      real.push(await timeOne(user.email));
      fake.push(await timeOne(`ghost-${uniq('t')}@test.codeback`));
    }

    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const realMedian = median(real);
    const fakeMedian = median(fake);
    const ratio = Math.max(realMedian, fakeMedian) / Math.max(1, Math.min(realMedian, fakeMedian));

    // Deliberately loose. The point is to catch an ORDER-OF-MAGNITUDE
    // difference — e.g. someone adding a slow KDF or an extra round-trip to
    // only one branch — not to police millisecond jitter on a laptop.
    expect(
      ratio,
      `timing must not differ by an order of magnitude (real=${realMedian.toFixed(1)}ms fake=${fakeMedian.toFixed(1)}ms)`
    ).toBeLessThan(10);
  });

  it('login equalises work for a non-existent account too', async () => {
    // The no-such-user branch burns equivalent Argon2id work; without it a
    // missing address answers in DB-round-trip time.
    const { user, password } = await createUser({ hashWith: 'argon2' });

    const timeLogin = async (address) => {
      const started = process.hrtime.bigint();
      await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ email: address, password });
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const real = await timeLogin(user.email);
    const fake = await timeLogin(`ghost-${uniq('l')}@test.codeback`);
    const ratio = Math.max(real, fake) / Math.max(1, Math.min(real, fake));

    expect(ratio, `real=${real.toFixed(1)}ms fake=${fake.toFixed(1)}ms`).toBeLessThan(10);
  });
});

describe('password reset evicts sessions on ALL THREE previously hand-rolled routes', () => {
  // GET /auth/me, PUT /auth/profile and DELETE /auth/account each carried
  // their own session check that tested only for the PRESENCE of
  // session.userId, silently skipping the sessionVersion comparison. All three
  // now use requireAuth; this proves none has regressed.
  const routes = [
    ['GET /auth/me', (agent) => agent.get('/auth/me')],
    ['PUT /auth/profile', (agent) => agent.put('/auth/profile').send({ name: 'Renamed' })],
    ['DELETE /auth/account', (agent) => agent.delete('/auth/account')],
  ];

  for (const [label, call] of routes) {
    it(`${label} rejects a session invalidated by a reset`, async () => {
      const { user, password } = await createUser({});
      const agent = await loginAgent(app, user.email, password);

      // Prove the session works BEFORE the reset, or the assertion after it
      // passes vacuously against the very bug it targets.
      const before = await agent.get('/auth/me');
      expect(before.status, 'guard: session must be live first').toBe(200);

      const { rawToken } = await authTokens.issueToken({
        userId: user.id,
        type: 'PASSWORD_RESET',
      });
      const reset = await request(app)
        .post('/auth/reset-password')
        .set('X-Forwarded-For', nextIp())
        .send({ token: rawToken, password: 'a-brand-new-password-1' });
      expect(reset.status).toBe(200);

      const after = await call(agent);
      expect(after.status, `${label} must reject the evicted session`).toBe(401);

      // And specifically: DELETE must not have deleted anything.
      if (label.startsWith('DELETE')) {
        expect(
          await prisma.user.findUnique({ where: { id: user.id } }),
          'an evicted session must not be able to delete the account'
        ).not.toBeNull();
      }
    });
  }
});

describe('rate limiting — tiers fire, and the webhook is EXEMPT', () => {
  it('login fires at its per-account threshold', async () => {
    const { user } = await createUser({});
    let blockedAt = null;
    for (let i = 1; i <= 10; i += 1) {
      const res = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ email: user.email, password: 'wrong' });
      if (res.status === 429) {
        blockedAt = i;
        break;
      }
    }
    expect(blockedAt, 'the per-email limiter must fire').not.toBeNull();
    expect(blockedAt, 'documented threshold is 5 per 15 minutes').toBeLessThanOrEqual(7);
  });

  it('forgot-password suppresses the SEND but keeps the response identical', async () => {
    const { user } = await createUser({});
    const responses = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/auth/forgot-password')
        .set('X-Forwarded-For', nextIp())
        .send({ email: user.email });
      responses.push({ status: res.status, body: JSON.stringify(res.body) });
    }

    // The per-email cap is 3/hour. Requests beyond it must NOT surface a 429 —
    // a rate-limit response tied to a specific address is itself an oracle.
    const distinct = new Set(responses.map((r) => `${r.status}:${r.body}`));
    expect(
      distinct.size,
      'every response must be identical; a 429 here would leak that the address exists'
    ).toBe(1);

    // Only 3 tokens should have been issued despite 5 requests.
    const tokens = await prisma.authToken.count({
      where: { userId: user.id, type: 'PASSWORD_RESET' },
    });
    expect(tokens, 'the cap suppresses the send, not the response').toBeLessThanOrEqual(3);
  });

  it('THE WEBHOOK IS EXEMPT — Meta bursts on retry and a 429 is a dropped DM', async () => {
    const { user } = await createUser({});
    const igUserId = uniq('ig-burst');
    await createAccount({ userId: user.id, igUserId });

    const secret = process.env.INSTAGRAM_APP_SECRET;
    const sign = (raw) =>
      'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

    // 30 deliveries from ONE address, well past any per-IP tier.
    const statuses = [];
    for (let i = 0; i < 30; i += 1) {
      const raw = JSON.stringify({
        object: 'instagram',
        entry: [
          {
            id: igUserId,
            time: Date.now(),
            messaging: [
              {
                sender: { id: uniq('s') },
                recipient: { id: igUserId },
                timestamp: Date.now(),
                message: { mid: uniq('mid'), text: `burst ${i}` },
              },
            ],
          },
        ],
      });
      const res = await request(apiApp)
        .post('/webhooks/instagram')
        .set('Content-Type', 'application/json')
        .set('X-Forwarded-For', '10.99.0.1') // the SAME IP every time
        .set('x-hub-signature-256', sign(raw))
        .send(raw);
      statuses.push(res.status);
    }

    expect(
      statuses.filter((s) => s === 429).length,
      'a 429 to Meta means a customer message is dropped'
    ).toBe(0);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});

describe('trial expiry — AI stops, the inbox does not', () => {
  beforeEach(() => {
    installMetaStubs();
  });

  it('an expired trial is not entitled, and classification is SKIPPED not failed', async () => {
    const { processMessageAnalysis } = require('../src/jobs/messageAnalysisJob.js');
    const analyze = vi.spyOn(aiService, 'analyzeConversation');

    const { user } = await createUser({ withTrial: true });
    const igUserId = uniq('ig-expired');
    setIgUser(igUserId);
    const account = await createAccount({ userId: user.id, igUserId, withConversation: true });
    const conversation = await prisma.conversation.findFirst({
      where: { instagramAccountId: account.id },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'inbound',
        content: 'a customer message',
        igMessageId: uniq('mid'),
        aiStatus: 'pending',
      },
    });

    await expireTrial(user.id);
    expect(await igIdentity.hasActiveEntitlement(user.id)).toBe(false);

    await processMessageAnalysis({ data: { messageId: message.id } });

    const after = await prisma.message.findUnique({ where: { id: message.id } });
    expect(after.aiStatus, "'skipped', not 'failed' — the sweeper must not retry it forever").toBe(
      'skipped'
    );
    expect(analyze, 'an expired tenant must not cost an AI call').not.toHaveBeenCalled();

    restoreMetaStubs();
  });

  it('the inbox stays READABLE and the account is NOT locked after expiry', async () => {
    const { user, password } = await createUser({ withTrial: true });
    const igUserId = uniq('ig-readable');
    setIgUser(igUserId);
    const account = await createAccount({ userId: user.id, igUserId, withConversation: true });
    const conversation = await prisma.conversation.findFirst({
      where: { instagramAccountId: account.id },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'inbound',
        content: 'HISTORIC-CUSTOMER-MESSAGE',
        igMessageId: uniq('mid'),
      },
    });

    await expireTrial(user.id);

    // Locking someone out of their own customer conversations to sell them a
    // subscription is hostile, and a user who cannot log in cannot pay later.
    const agent = await loginAgent(apiApp, user.email, password);
    expect((await agent.get('/auth/me')).status, 'login must still work').toBe(200);

    const conversations = await agent.get('/api/conversations');
    expect(conversations.status, 'the inbox must remain readable').toBe(200);

    const messages = await agent.get(`/api/conversations/${conversation.id}/messages`);
    expect(messages.status).toBe(200);
    expect(
      JSON.stringify(messages.body),
      'existing history must still be visible'
    ).toContain('HISTORIC-CUSTOMER-MESSAGE');

    restoreMetaStubs();
  });
});
