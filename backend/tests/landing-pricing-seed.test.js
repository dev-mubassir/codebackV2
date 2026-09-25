/**
 * The landing page's pricing section is hand-written JSX (frontend/src/app/page.js,
 * SECTION 8), not rendered from the catalogue. Payment-gateway compliance needs
 * the public website to state exactly what Cashfree is asked to charge, so this
 * pins every number on it against the database the migrations seed — the same
 * rows checkout reads. Change a price in a migration without the page (or the
 * page without a migration) and this fails.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { prisma } from './helpers/db.js';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'src', 'app', 'page.js');

/** "₹" amount as the page writes it: 49900 -> "499", 129900 -> "1,299", 7475 -> "74.75". */
function rupees(paise) {
  const major = paise / 100;
  return Number.isInteger(major) ? major.toLocaleString('en-IN') : major.toFixed(2);
}

function pricingSection() {
  const src = fs.readFileSync(PAGE, 'utf8');
  const start = src.indexOf('SECTION 8 — PRICING');
  const end = src.indexOf('SECTION 9 — FOOTER');
  expect(start, 'pricing section marker').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

function card(section, marker, nextMarker) {
  const from = section.indexOf(marker);
  expect(from, `card ${marker}`).toBeGreaterThan(-1);
  const to = nextMarker ? section.indexOf(nextMarker, from) : section.length;
  return section.slice(from, to);
}

const text = (jsx) => jsx.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

async function plan(code) {
  return prisma.plan.findUnique({ where: { code }, include: { prices: true } });
}

describe('landing pricing matches the seeded catalogue', () => {
  const section = pricingSection();
  const cards = {
    STARTER: card(section, '{/* STARTER */}', '{/* PRO (Recommended) */}'),
    PRO: card(section, '{/* PRO (Recommended) */}', '{/* ENTERPRISE */}'),
    ENTERPRISE: card(section, '{/* ENTERPRISE */}', 'pricing-addons-box'),
  };

  it('every plan card shows its seeded price, auto-replies and AI drafts', async () => {
    for (const code of ['STARTER', 'PRO']) {
      const p = await plan(code);
      const inr = p.prices.find((x) => x.billingRegion === 'IN');
      const body = text(cards[code]);
      expect(cards[code], `${code} price`).toContain(`<span className="cost-amount">${rupees(inr.amount)}</span>`);
      expect(body, `${code} auto-replies`).toContain(`${p.autoReplyCreditsPerCycle.toLocaleString('en-IN')} AI auto-replies`);
      expect(body, `${code} drafts`).toContain(`${p.draftCreditsPerCycle.toLocaleString('en-IN')} AI drafts`);
      expect(p.draftCreditsPerCycle, 'the 1/4 rule').toBe(Math.floor(p.autoReplyCreditsPerCycle / 4));
    }
    const ent = await plan('ENTERPRISE');
    const entInr = ent.prices.find((x) => x.billingRegion === 'IN');
    expect(cards.ENTERPRISE).toContain(`<span className="cost-amount">${rupees(entInr.amount)}</span>`);
    expect(ent.draftCreditsPerCycle).toBeNull();
    expect(text(cards.ENTERPRISE)).toContain('Unlimited AI drafts');
  });

  it('every listed add-on pack and the extra account are on the page at the seeded Starter / Pro prices', async () => {
    const packs = await prisma.addonPack.findMany({ where: { isListed: true }, include: { prices: true } });
    expect(packs.map((p) => p.code).sort(), 'positive control: the seed has both kinds').toEqual(
      ['draft_credits_125', 'draft_credits_500', 'reply_credits_500'].sort()
    );
    const rows = [
      ...packs.map((p) => ({ code: p.code, prices: p.prices })),
      { code: 'extra_ig_account', prices: await prisma.extraIgAccountPrice.findMany() },
    ];
    for (const row of rows) {
      const m = section.match(new RegExp(`<tr data-addon="${row.code}">([\\s\\S]*?)</tr>`));
      expect(m, `row for ${row.code}`).toBeTruthy();
      const cells = [...m[1].matchAll(/<td>₹([\d,.]+)<\/td>/g)].map((x) => x[1]);
      const inr = (tier) => row.prices.find((p) => p.planCode === tier && p.billingRegion === 'IN').amount;
      expect(cells, `${row.code}: Starter, Pro`).toEqual([rupees(inr('STARTER')), rupees(inr('PRO'))]);
    }
    // Pack sizes in the row labels match the catalogue.
    for (const p of packs) {
      const label = section.match(new RegExp(`<tr data-addon="${p.code}">\\s*<th scope="row">([^<]+)</th>`))[1];
      expect(label).toContain(`+${p.creditAmount.toLocaleString('en-IN')} AI ${p.pool === 'DRAFT' ? 'drafts' : 'auto-replies'}`);
    }
  });
});
