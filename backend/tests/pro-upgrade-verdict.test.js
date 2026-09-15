/**
 * Ruling 3b — the upgrade banner may only claim a saving that is real.
 *
 * The banner used to fire on a tenant's first add-on purchase, which at the
 * prices then seeded was arithmetically false: three Starter packs bought
 * the same 2,000 replies as Pro for LESS than Pro cost. A saving was being
 * asserted on the page where someone decides whether to trust us with a
 * card.
 *
 * proUpgradeVerdict() replaces the threshold with a computed test, priced
 * from the catalogue at render time. These cases pin BOTH branches at the
 * post-3a prices, and — more importantly — pin the property that keeps it
 * honest through future price changes: a saving is only ever claimed when
 * Pro is strictly cheaper AND not a downgrade.
 *
 * Exercised against a catalogue built to mirror the seeded rows. This is the
 * arithmetic, which is where the lie was; the rendering is a thin wrapper
 * over the verdict.
 */

import { describe, it, expect } from 'vitest';
import { proUpgradeVerdict } from '../../frontend/src/lib/pricing.js';

/** Mirrors the seeded catalogue after ruling 3a (Starter pack ₹249 -> ₹299). */
function catalogue({ starterPack = 29900, proPack = 14900 } = {}) {
  const pack = (code, amount) => ({
    code: 'reply_credits_500',
    creditAmount: 500,
    prices: [{ billingRegion: 'IN', currency: 'INR', amount }],
  });
  return [
    {
      code: 'STARTER',
      name: 'Starter',
      igAccountLimit: 1,
      autoReplyCreditsPerCycle: 500,
      cycleLengthDays: 30,
      prices: [{ billingRegion: 'IN', currency: 'INR', amount: 49900 }],
      addons: {
        replyCredits: [pack('STARTER', starterPack)],
        extraIgAccount: { code: 'extra_ig_account', prices: [{ billingRegion: 'IN', currency: 'INR', amount: 29900 }] },
      },
    },
    {
      code: 'PRO',
      name: 'Pro',
      igAccountLimit: 2,
      autoReplyCreditsPerCycle: 2000,
      cycleLengthDays: 30,
      prices: [{ billingRegion: 'IN', currency: 'INR', amount: 129900 }],
      addons: {
        replyCredits: [pack('PRO', proPack)],
        extraIgAccount: { code: 'extra_ig_account', prices: [{ billingRegion: 'IN', currency: 'INR', amount: 19900 }] },
      },
    },
  ];
}

const verdict = (packs, extraIg = 0, plans = catalogue()) =>
  proUpgradeVerdict({ plans, region: 'IN', replyCreditPacksThisCycle: packs, extraIgAccounts: extraIg });

describe('proUpgradeVerdict — the comparison branch (no saving exists)', () => {
  it.each([
    ['no add-ons at all', 0],
    ['one pack: ₹798 vs Pro ₹1,299', 1],
    ['two packs: ₹1,097 vs Pro ₹1,299', 2],
  ])('returns a comparison, never a saving, with %s', (_label, packs) => {
    const v = verdict(packs);
    expect(v.kind).toBe('comparison');
    expect(v).not.toHaveProperty('formatted');
    expect(v.amount, 'a comparison must carry no savings figure at all').toBeUndefined();
  });

  it('still describes Pro factually so the pitch is not lost', () => {
    const v = verdict(1);
    expect(v.pro.replies).toBe(2000);
    expect(v.pro.accounts).toBe(2);
    expect(v.pro.formattedPrice).toBe('₹1,299');
  });
});

describe('proUpgradeVerdict — the saving branch (a real saving exists)', () => {
  it('claims a saving at three packs, where Pro genuinely becomes cheaper', () => {
    // Starter 499 + 3x299 = ₹1,396 for 2,000 replies. Pro is ₹1,299 for the
    // same 2,000 replies AND a second account.
    const v = verdict(3);
    expect(v.kind).toBe('saving');
    expect(v.amount).toBe(9700); // ₹97 in paise
    expect(v.formatted).toBe('₹97');
  });

  it('the saving is never bought by giving the tenant less', () => {
    const v = verdict(3);
    expect(v.kind).toBe('saving');
    // Pro's own 2,000 covers their 2,000, and its 2 accounts cover their 1.
    expect(v.pro.replies).toBeGreaterThanOrEqual(500 + 3 * 500);
    expect(v.pro.accounts).toBeGreaterThanOrEqual(1);
  });

  it('grows with the number of packs', () => {
    expect(verdict(4).amount).toBeGreaterThan(verdict(3).amount);
  });
});

describe('proUpgradeVerdict — the property that outlives any price change', () => {
  it('reverts to a comparison if the Starter pack price is lowered again', () => {
    // Exactly the pre-3a state that made the old banner lie.
    const cheap = catalogue({ starterPack: 24900 });
    const v = proUpgradeVerdict({ plans: cheap, region: 'IN', replyCreditPacksThisCycle: 3 });
    // 499 + 3x249 = ₹1,246 < ₹1,299, so there is no saving to claim.
    expect(v.kind).toBe('comparison');
  });

  it('never claims a saving that a downgrade would have produced', () => {
    // Pro made absurdly cheap but capped BELOW what the tenant already has:
    // cheaper on price alone, worse on entitlements. Topping Pro back up to
    // parity is what must be priced, not bare Pro.
    const plans = catalogue();
    const pro = plans.find((p) => p.code === 'PRO');
    pro.autoReplyCreditsPerCycle = 500;
    pro.igAccountLimit = 1;
    pro.prices = [{ billingRegion: 'IN', currency: 'INR', amount: 10000 }]; // ₹100

    const v = proUpgradeVerdict({ plans, region: 'IN', replyCreditPacksThisCycle: 3 });
    if (v.kind === 'saving') {
      // A saving is only acceptable here if the priced Pro configuration
      // actually matches what they already had.
      expect(v.pro.replies).toBeGreaterThanOrEqual(2000);
      expect(v.pro.accounts).toBeGreaterThanOrEqual(1);
    }
    // With Pro topped back up to 2,000 replies it is ₹100 + 3x₹149 = ₹547
    // against Starter's ₹1,396, so a saving here is legitimate.
    expect(v.kind).toBe('saving');
  });

  it('says nothing at all when the catalogue is missing a price', () => {
    const plans = catalogue();
    plans.find((p) => p.code === 'PRO').prices = [];
    expect(proUpgradeVerdict({ plans, region: 'IN', replyCreditPacksThisCycle: 3 })).toBeNull();
  });

  it('accounts for a tenant who also bought extra Instagram accounts', () => {
    // Starter 499 + 3x299 + 1x299 = ₹1,695 for 2,000 replies and 2 accounts.
    // Pro covers both outright at ₹1,299.
    const v = verdict(3, 1);
    expect(v.kind).toBe('saving');
    expect(v.amount).toBe(39600); // ₹396
  });
});
