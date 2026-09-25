/**
 * Coupons (Gate 6).
 *
 * Redeemed at SIGNUP (POST /auth/register) and at TRIAL CLAIM
 * (POST /api/billing/trial/claim). A redemption records who brought the
 * customer (the influencer tag) and reserves the discount for the first paid
 * checkout. One coupon per customer, ever.
 *
 * NOT BUILT (out of scope — no Cashfree changes in this rebuild): applying
 * the reserved discount to a payment. The plug-in point is
 * routes/billing.js POST /checkout/plan, where `price.amount` is read from
 * plan_prices: look up the tenant's redemption there and reduce the order
 * amount before creating the Cashfree order.
 *
 * Redemption is atomic: the usage count only moves if the coupon still has a
 * use left (a conditional UPDATE), and the redemption row (unique per user)
 * is written in the same transaction, so two concurrent redemptions of the
 * last use cannot both succeed and a user cannot redeem twice.
 */

const prisma = require('../lib/prisma');

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

class CouponError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function normalizeCode(raw) {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return CODE_RE.test(code) ? code : null;
}

/** Is this code redeemable right now? Read-only; answers null or the coupon. */
async function findRedeemable(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const c = await prisma.coupon.findUnique({ where: { code } });
  if (!c || !c.isActive) return null;
  if (c.expiresAt && c.expiresAt <= new Date()) return null;
  if (c.maxUses != null && c.usedCount >= c.maxUses) return null;
  return c;
}

/**
 * Redeem `rawCode` for `userId`. Throws CouponError with code
 * INVALID (unknown / inactive / expired / used up) or ALREADY_REDEEMED.
 */
async function redeemCoupon(rawCode, userId, context) {
  const code = normalizeCode(rawCode);
  if (!code) throw new CouponError('INVALID', 'That code is not valid.');
  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      const coupon = await tx.coupon.findUnique({ where: { code } });
      if (!coupon || !coupon.isActive || (coupon.expiresAt && coupon.expiresAt <= now)) {
        throw new CouponError('INVALID', 'That code is not valid.');
      }
      const claimed = await tx.coupon.updateMany({
        where: {
          id: coupon.id,
          isActive: true,
          ...(coupon.maxUses != null ? { usedCount: { lt: coupon.maxUses } } : {}),
        },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new CouponError('INVALID', 'That code has been used up.');
      return tx.couponRedemption.create({ data: { couponId: coupon.id, userId, context } });
    });
  } catch (err) {
    if (err.code === 'P2002') throw new CouponError('ALREADY_REDEEMED', 'This account already used a code.');
    throw err;
  }
}

/** Per influencer tag: coupons, signups (redemptions), paid conversions. */
async function influencerReport() {
  const coupons = await prisma.coupon.findMany({
    select: { id: true, code: true, influencerTag: true, usedCount: true, isActive: true, redemptions: { select: { userId: true } } },
  });
  const allUsers = [...new Set(coupons.flatMap((c) => c.redemptions.map((r) => r.userId)))];
  const paid = allUsers.length
    ? new Set(
        (await prisma.order.findMany({ where: { tenantId: { in: allUsers }, status: 'PAID', planCode: { not: null } }, select: { tenantId: true }, distinct: ['tenantId'] }))
          .map((o) => o.tenantId)
      )
    : new Set();

  const byTag = new Map();
  for (const c of coupons) {
    const tag = c.influencerTag || '(none)';
    const row = byTag.get(tag) || { influencerTag: tag, coupons: [], signups: 0, paidConversions: 0 };
    row.coupons.push(c.code);
    row.signups += c.redemptions.length;
    row.paidConversions += c.redemptions.filter((r) => paid.has(r.userId)).length;
    byTag.set(tag, row);
  }
  return [...byTag.values()]
    .map((r) => ({ ...r, conversionRate: r.signups ? r.paidConversions / r.signups : 0 }))
    .sort((a, b) => b.signups - a.signups);
}

module.exports = { normalizeCode, findRedeemable, redeemCoupon, influencerReport, CouponError, CODE_RE };
