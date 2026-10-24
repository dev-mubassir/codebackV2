/**
 * Gate 10 — the public pages and the availability endpoint.
 *
 * The landing page's Auto DM rows and the Terms fair-use numbers come from ONE
 * frontend constants file (frontend/src/content/autodmPlans.js); this pins it
 * to the backend seed (features/autodm/limits.js DEFAULT_LIMITS), pins the
 * pricing rows, the single footnote, the section's position, the Terms and
 * Privacy text, and GET /api/public/autodm-availability.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'node:module';
import { buildTestApp } from './helpers/app.js';
import { resetDb, prisma } from './helpers/db.js';
import { saveFlags, setRolloutMode } from './helpers/autodm.js';

const require = createRequire(import.meta.url);
const limits = require('../src/features/autodm/limits.js');
const availability = require('../src/features/autodm/availability.js');
const autodm = require('../src/features/autodm/index.js');

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'src');
const read = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
const text = (jsx) => jsx.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

let plans;
beforeAll(async () => {
  plans = await import(pathToFileURL(path.join(FRONTEND, 'content', 'autodmPlans.js')).href);
});

describe('one set of numbers', () => {
  it('the frontend constants equal the backend seed', () => {
    for (const code of ['TRIAL', 'STARTER', 'PRO']) {
      expect({ ...plans.AUTODM_PLAN_LIMITS[code] }, code).toEqual({ ...limits.DEFAULT_LIMITS[code] });
    }
    expect(plans.AUTODM_FAIR_USE).toEqual({ monthlyDms: 100000, activeAutomations: 500, metaPrivateRepliesPerHour: 750 });
  });

  it('the pricing rows read exactly as specified', () => {
    expect(plans.autodmPlanRow('TRIAL')).toBe('30 automations · 1,000 Auto DMs');
    expect(plans.autodmPlanRow('STARTER')).toBe('100 automations · 10,000 Auto DMs/month');
    expect(plans.autodmPlanRow('PRO')).toBe('Unlimited* automations · Unlimited* Auto DMs');
  });
});

describe('landing page', () => {
  const page = read('app/page.js');

  it('the Auto DM section sits directly after the AI sorting walkthrough (#how-it-works)', () => {
    const how = page.indexOf('id="how-it-works"');
    const showcase = page.indexOf('<AutoDmShowcase />');
    const capabilities = page.indexOf('id="capabilities"');
    expect(how).toBeGreaterThan(-1);
    expect(showcase).toBeGreaterThan(how);
    expect(capabilities).toBeGreaterThan(showcase);
    // Nothing else between the end of #how-it-works and the showcase.
    const between = page.slice(page.lastIndexOf('</section>', showcase), showcase);
    expect(between.match(/<section/g)).toBeNull();
    // The old three-step Auto DM section is gone.
    expect(page).not.toContain('Turn comments into conversations.');
  });

  it('each plan card has its Auto DM row, the trial line exists, and there is ONE footnote', () => {
    const start = page.indexOf('SECTION 8 — PRICING');
    const pricing = page.slice(start, page.indexOf('SECTION 9 — FOOTER'));
    const card = (marker, next) => pricing.slice(pricing.indexOf(marker), pricing.indexOf(next));
    expect(card('{/* STARTER */}', '{/* PRO (Recommended) */}')).toContain("autodmPlanRow('STARTER')");
    expect(card('{/* PRO (Recommended) */}', '{/* ENTERPRISE */}')).toContain("autodmPlanRow('PRO')");
    expect(card('{/* ENTERPRISE */}', 'pricing-addons-box')).toContain('Auto DM: custom limits');
    expect(pricing).toContain("autodmPlanRow('TRIAL')");
    expect(pricing.match(/Fair use applies/g)).toHaveLength(1);
    expect(text(pricing)).toContain('*Fair use applies. See Terms §8 .');
    expect(pricing).toContain('href="/terms#fair-use"');
    // No limit numbers typed into the page itself.
    expect(pricing).not.toMatch(/10,000 Auto DMs|1,000 Auto DMs|100,000/);
  });

  it('FAQ permissions answer', () => {
    expect(page).toContain(
      'Siffty requests instagram_business_basic and instagram_business_manage_messages. Auto DM additionally requests instagram_business_manage_comments.'
    );
  });

  it('the section has no gradients, emoji or invented numbers', () => {
    const showcase = read('app/components/landing/AutoDmShowcase.js');
    expect(showcase).toContain('@yourbrand');
    expect(showcase).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(showcase).not.toMatch(/\d{1,3},\d{3}|\d+%|\d+\+ (creators|brands|users)/);
    const css = fs.readFileSync(path.join(FRONTEND, 'app', 'landing.css'), 'utf8');
    const block = css.slice(css.indexOf('Auto DM (comment to DM)'), css.indexOf('.faq-section {'));
    expect(block).not.toMatch(/gradient\(/);
    expect(block).toContain('prefers-reduced-motion');
  });
});

describe('Terms and Privacy', () => {
  it('Terms: a Fair use section (8), numbered 1–15 without gaps, with the fair-use numbers from the constants', () => {
    const terms = read('app/terms/page.js');
    const toc = [...terms.matchAll(/title: ['"](\d+)\. /g)].map((m) => Number(m[1]));
    expect(toc).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const badges = [...terms.matchAll(/sectionNumber\}>(\d+)</g)].map((m) => Number(m[1]));
    expect(badges).toEqual(toc);
    expect(terms).toContain('<section id="fair-use"');
    expect(terms).toContain("{ id: 'fair-use', title: '8. Fair use' }");
    const fair = text(terms.slice(terms.indexOf('<section id="fair-use"'), terms.indexOf('</section>', terms.indexOf('<section id="fair-use"'))));
    expect(fair).toContain('no fixed monthly count for the normal use of one business');
    expect(fair).toContain('{n(AUTODM_FAIR_USE.monthlyDms)} Auto DMs per Siffty account per calendar month');
    expect(fair).toContain('{n(AUTODM_FAIR_USE.activeAutomations)} active automations');
    expect(fair).toContain('private replies per hour per Instagram account applies on every plan');
    expect(fair).toContain('queued or slowed');
    expect(fair).toContain('custom plan');
    expect(fair).toMatch(/Spam, reselling, or automated abuse/);
  });

  it('Privacy §6 names exactly the processors in use', () => {
    const privacy = read('app/privacy/page.js');
    const start = privacy.indexOf('<section id="sharing"');
    const six = privacy.slice(start, privacy.indexOf('</section>', start));
    const named = [...six.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m) => m[1]);
    expect(named).toEqual(['Meta (Instagram)', 'Google (Gemini)', 'Cloudflare (Workers AI)', 'Resend (email)', 'Cashfree Payments (payments)', 'Northflank (hosting)']);
  });
});

describe('GET /api/public/autodm-availability', () => {
  let app;
  let restoreFlags;

  beforeAll(() => {
    app = buildTestApp({ mount: { '/api/public': autodm.availabilityRouter } });
  });

  beforeEach(async () => {
    await resetDb();
    restoreFlags = saveFlags();
    availability.resetAvailabilityCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreFlags();
    availability.resetAvailabilityCache();
  });

  it('kill switch off: false, without touching the database; unauthenticated, cached 60 s, no user data', async () => {
    const q = vi.spyOn(prisma.appSetting, 'findUnique');
    const res = await request(app).get('/api/public/autodm-availability');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.headers['set-cookie']).toBeUndefined();
    // (the app's maintenance guard reads its own setting; the rollout mode is never read)
    expect(q.mock.calls.filter(([args]) => args && args.where && args.where.key === 'autodm_rollout_mode')).toHaveLength(0);
  });

  it('true only when the kill switch is on AND the mode is EVERYONE', async () => {
    process.env.AUTODM_ENABLED = 'true';
    for (const [mode, expected] of [['OFF', false], ['BETA', false], ['EVERYONE', true]]) {
      await setRolloutMode(mode);
      availability.resetAvailabilityCache();
      const res = await request(app).get('/api/public/autodm-availability');
      expect(res.body, mode).toEqual({ available: expected });
    }
  });

  it('switches by itself when the admin opens Auto DM to everyone (after the 60 s cache)', async () => {
    process.env.AUTODM_ENABLED = 'true';
    await setRolloutMode('BETA');
    const t0 = Date.now();
    expect(await availability.isAvailable(t0)).toBe(false);
    await setRolloutMode('EVERYONE');
    expect(await availability.isAvailable(t0 + 30 * 1000)).toBe(false); // still cached
    expect(await availability.isAvailable(t0 + 61 * 1000)).toBe(true);
  });
});
