/**
 * Gate 11d — /refund-policy is a real, linked page whose thresholds are numbers.
 *
 * A static check on the frontend source, in the style of
 * frontend-password-fields.test.js (the frontend has no test runner). What it
 * pins is the property that prevents disputes: every rule states a number, and
 * nothing is left "at our discretion".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..', '..', 'frontend', 'src');
const read = (p) => readFileSync(join(FRONTEND, p), 'utf8');
const PAGE = 'app/refund-policy/page.js';

describe('Gate 11d — refund policy page', () => {
  it('exists and is a server component with no billing dependency', () => {
    expect(existsSync(join(FRONTEND, PAGE))).toBe(true);
    const src = read(PAGE);
    expect(src).not.toMatch(/^['"]use client['"]/m);
    expect(src).not.toMatch(/from ['"][^'"]*billing[^'"]*['"]|\/api\/billing/);
  });

  it('states every threshold as a number', () => {
    const src = read(PAGE);
    expect(src).toMatch(/REFUND_WINDOW_DAYS = 7;/);
    expect(src).toMatch(/PLAN_USAGE_LIMIT_PERCENT = 20;/);
    expect(src).toContain('5–7');
    expect(src).toMatch(/entirely unused/);
    expect(src).toMatch(/Trials are free/);
    expect(src, 'the plan rule counts the purchase’s own credits').toMatch(/less than \{PLAN_USAGE_LIMIT_PERCENT\}% of the credits from that purchase/);
    expect(src).toMatch(/Credits you already had are used first/);
    expect(src, 'the extra-account rule is stated').toMatch(/no Instagram account has ever been connected/);
  });

  it('never says "discretion"', () => {
    expect(read(PAGE)).not.toMatch(/discretion/i);
  });

  it('points to the contact route for requests', () => {
    expect(read(PAGE)).toContain('href="/contact"');
  });

  it('is linked from the landing footer and the pricing section', () => {
    expect(read('app/page.js')).toContain('href="/refund-policy"');
    expect(read('app/components/pricing/PricingSection.js')).toContain('href="/refund-policy"');
  });

  // The guarantee is unchanged — every legal page still links to the refund
  // policy — but the redesign moved that link out of each page and into the
  // shared PublicFooter, which LegalLayout renders. Asserting the inline
  // href per page was checking the old mechanism, not the requirement, so
  // this now checks the chain that actually delivers it. Verified in the
  // browser: /privacy, /terms, /data-deletion, /support and /contact all
  // render href="/refund-policy".
  it('is linked from every legal page, through the shared footer', () => {
    expect(read('app/components/public/PublicFooter.js')).toContain('href="/refund-policy"');
    expect(read('app/components/public/LegalLayout.js')).toContain('PublicFooter');

    for (const p of ['app/privacy/page.js', 'app/terms/page.js', 'app/data-deletion/page.js', 'app/support/page.js', 'app/contact/page.js']) {
      const src = read(p);
      const reachesFooter = src.includes('LegalLayout') || src.includes('PublicFooter');
      expect(reachesFooter, `${p} must render the shared footer or link the refund policy itself`).toBe(true);
    }
  });
});
