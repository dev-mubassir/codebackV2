/**
 * Gate 10 — the contact and Enterprise enquiry endpoints, and the links to them.
 *
 * What must hold:
 *   - reachable logged out, and with BILLING_ENABLED off
 *   - a session, when present, identifies the account; the typed email never does
 *   - Enterprise enquiries are identifiable, not mixed into support
 *   - rate-limited, validated, honeypot-guarded
 *   - lib/email is the only egress, and several enquiries in an hour all arrive
 *   - /contact is linked from the footer, the Enterprise card, and ACCOUNT_BLOCKED
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { buildTestApp } from './helpers/app.js';
import { prisma, resetDb, createUser } from './helpers/db.js';

const require = createRequire(import.meta.url);
const mailer = require('../src/lib/email/index.js');
const templates = require('../src/lib/email/templates.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..', '..', 'frontend', 'src');
const read = (p) => readFileSync(join(FRONTEND, p), 'utf8');

let app;
let ipSeq = 0;
const nextIp = () => `10.10.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

const valid = { name: 'Asha Rao', email: 'asha@test.codeback', message: 'My auto-replies stopped yesterday afternoon.' };

beforeAll(async () => {
  const contactRoutes = (await import('../src/routes/contact.js')).default;
  app = buildTestApp({ mount: { '/api/contact': contactRoutes } });
});

let savedSupport;
beforeEach(async () => {
  await resetDb();
  savedSupport = process.env.SUPPORT_EMAIL;
  process.env.SUPPORT_EMAIL = 'support@test.codeback';
  mailer._resetQuota();
  mailer._resetHealth();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedSupport === undefined) delete process.env.SUPPORT_EMAIL;
  else process.env.SUPPORT_EMAIL = savedSupport;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const post = (path, body, ip = nextIp()) => request(app).post(path).set('X-Forwarded-For', ip).send(body);

describe('Gate 10 — support enquiries', () => {
  it('a logged-out visitor can send one; it goes to SUPPORT_EMAIL as a support enquiry', async () => {
    const send = vi.spyOn(mailer, 'sendContactEnquiry').mockResolvedValue({ id: 'x' });

    const res = await post('/api/contact/support', valid);

    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const [to, details] = send.mock.calls[0];
    expect(to).toBe('support@test.codeback');
    expect(details).toMatchObject({ kind: 'support', name: 'Asha Rao', fromEmail: 'asha@test.codeback', account: null });
  });

  it('works with BILLING_ENABLED off — support does not depend on a billing flag', async () => {
    const previous = process.env.BILLING_ENABLED;
    delete process.env.BILLING_ENABLED;
    try {
      vi.spyOn(mailer, 'sendContactEnquiry').mockResolvedValue({ id: 'x' });
      const res = await post('/api/contact/support', valid);
      expect(res.status).toBe(200);
    } finally {
      process.env.BILLING_ENABLED = previous;
    }
  });

  it('a signed-in user is identified by the SESSION, not by the email they typed', async () => {
    const { user, password } = await createUser({});
    const agent = request.agent(app);
    const login = await agent.post('/auth/login').send({ email: user.email, password });
    expect(login.status).toBe(200);
    const send = vi.spyOn(mailer, 'sendContactEnquiry').mockResolvedValue({ id: 'x' });

    const res = await agent
      .post('/api/contact/support')
      .set('X-Forwarded-For', nextIp())
      .send({ ...valid, email: 'someone-else@test.codeback' });

    expect(res.status).toBe(200);
    const [, details] = send.mock.calls[0];
    expect(details.account).toEqual({ userId: user.id, email: user.email });
    expect(details.fromEmail, 'the typed address is still the reply-to').toBe('someone-else@test.codeback');
  });

  it.each([
    ['missing message', { name: 'A', email: 'a@test.codeback' }],
    ['message too short', { ...valid, message: 'help' }],
    ['bad email', { ...valid, email: 'not-an-email' }],
    ['unknown key', { ...valid, role: 'ADMIN' }],
    ['enterprise field on the support route', { ...valid, company: 'Acme' }],
  ])('rejects %s with a 400 and sends nothing', async (_label, body) => {
    const send = vi.spyOn(mailer, 'sendContactEnquiry');
    const res = await post('/api/contact/support', body);
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('the honeypot answers like a success and sends nothing', async () => {
    const send = vi.spyOn(mailer, 'sendContactEnquiry');
    const res = await post('/api/contact/support', { ...valid, website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it('is rate-limited per address: the sixth message in an hour is a 429; another address is unaffected', async () => {
    vi.spyOn(mailer, 'sendContactEnquiry').mockResolvedValue({ id: 'x' });
    const ip = nextIp();
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await post('/api/contact/support', valid, ip)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await post('/api/contact/support', valid)).status).toBe(200);
  });

  it('SUPPORT_EMAIL unset: a 503 that says to email directly, never a false success', async () => {
    delete process.env.SUPPORT_EMAIL;
    const send = vi.spyOn(mailer, 'sendContactEnquiry');
    const res = await post('/api/contact/support', valid);
    expect(res.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });

  it('a failed send is a 503, never a false success', async () => {
    vi.spyOn(mailer, 'sendContactEnquiry').mockRejectedValue(new Error('provider down'));
    const res = await post('/api/contact/support', valid);
    expect(res.status).toBe(503);
  });
});

describe('Gate 10 — Enterprise enquiries are a separate route', () => {
  it('delivers as kind "enterprise", and requires a company', async () => {
    const send = vi.spyOn(mailer, 'sendContactEnquiry').mockResolvedValue({ id: 'x' });

    expect((await post('/api/contact/enterprise', valid)).status, 'company is required').toBe(400);

    const res = await post('/api/contact/enterprise', { ...valid, company: 'Acme Studios', igAccounts: '12' });
    expect(res.status).toBe(200);
    expect(send.mock.calls[0][1]).toMatchObject({ kind: 'enterprise', company: 'Acme Studios', igAccounts: '12' });
  });

  it('the two kinds carry different subject prefixes', () => {
    const s = templates.contactEnquiry({ kind: 'support', name: 'A', fromEmail: 'a@x.test', message: 'hello there friend' });
    const e = templates.contactEnquiry({ kind: 'enterprise', name: 'A', fromEmail: 'a@x.test', company: 'Acme', message: 'hello there friend' });
    expect(s.subject.startsWith('[Siffty support]')).toBe(true);
    expect(e.subject.startsWith('[Siffty enterprise]')).toBe(true);
  });
});

describe('Gate 10 — the email itself', () => {
  it('escapes visitor HTML and keeps the subject to one line', () => {
    const t = templates.contactEnquiry({
      kind: 'support',
      name: '<img src=x onerror=alert(1)>',
      fromEmail: 'a@x.test',
      message: 'line one\r\nBcc: victim@x.test <a href="http://evil">click</a>',
    });
    expect(t.html).not.toContain('<img src=x');
    expect(t.html).not.toContain('<a href="http://evil">');
    expect(t.html).toContain('&lt;a href=&quot;http://evil&quot;&gt;');
    expect(t.subject).not.toMatch(/[\r\n]/);
  });

  it('says outright when the sender is not signed in', () => {
    const t = templates.contactEnquiry({ kind: 'support', name: 'A', fromEmail: 'a@x.test', message: 'hello there friend' });
    expect(t.text).toContain('self-reported and unverified');
  });

  it('goes through lib/email, and ten enquiries in an hour all pass the quota (not 3)', async () => {
    for (let i = 0; i < 10; i++) {
      await expect(
        mailer.sendContactEnquiry('support@test.codeback', { kind: 'support', name: 'A', fromEmail: `a${i}@x.test`, message: 'hello there friend' })
      ).resolves.toBeTruthy();
    }
  });

  it('an unknown kind fails loudly rather than defaulting', () => {
    expect(() => mailer.sendContactEnquiry('s@x.test', { kind: 'sales', name: 'A', fromEmail: 'a@x.test', message: 'hi' })).toThrow(/unknown kind/);
  });

  it('the route never imports a mail provider — lib/email stays the only egress', () => {
    const src = readFileSync(join(HERE, '..', 'src', 'routes', 'contact.js'), 'utf8');
    expect(src).not.toMatch(/require\(['"]resend['"]\)|from ['"]resend['"]/);
    expect(src).toMatch(/require\('\.\.\/lib\/email'\)/);
  });
});

describe('Gate 10 — /contact is a real, linked, server-rendered page', () => {
  it('both pages exist and the page modules are server components', () => {
    for (const p of ['app/contact/page.js', 'app/contact/enterprise/page.js']) {
      expect(existsSync(join(FRONTEND, p)), p).toBe(true);
      expect(read(p), `${p} must not be a client component`).not.toMatch(/^['"]use client['"]/m);
      expect(read(p), `${p} must not import or call anything billing`).not.toMatch(
        /from ['"][^'"]*billing[^'"]*['"]|\/api\/billing|useBillingSummary|usePricing/i
      );
    }
  });

  it('is linked from the landing footer, the Enterprise card, and the ACCOUNT_BLOCKED state', () => {
    expect(read('app/page.js')).toContain('href="/contact"');
    expect(read('app/components/pricing/PricingSection.js')).toContain('href="/contact/enterprise"');
    const card = read('app/components/billing/TrialStateCard.js');
    const blocked = card.slice(card.indexOf('function Blocked'), card.indexOf('function EmailUnverified'));
    expect(blocked).toContain('href="/contact"');
  });
});
