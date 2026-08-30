/**
 * Brand deal upsert logic — a conversation can surface new details about the
 * same deal across multiple messages, so we merge into a single evolving
 * BrandDeal record per conversation instead of creating duplicates. Fields
 * are only ever filled in, never overwritten with unknown/null data (spec:
 * "Do not invent missing information").
 */

const prisma = require('../lib/prisma');

/**
 * Create or update the BrandDeal for a conversation.
 * Returns { brandDeal, isNew }.
 */
async function upsertBrandDeal({ conversationId, instagramAccountId, userId, extracted }) {
  const existing = await prisma.brandDeal.findUnique({ where: { conversationId } });

  const merged = {
    brandName: extracted.brandName ?? existing?.brandName ?? null,
    campaign: extracted.campaign ?? existing?.campaign ?? null,
    budgetAmount: extracted.budgetAmount ?? existing?.budgetAmount ?? null,
    budgetCurrency: extracted.budgetCurrency ?? existing?.budgetCurrency ?? null,
    deliverables: extracted.deliverables ?? existing?.deliverables ?? null,
    deadline: extracted.deadline ?? existing?.deadline ?? null,
    contactEmail: extracted.contactEmail ?? existing?.contactEmail ?? null,
    website: extracted.website ?? existing?.website ?? null,
    usageRights: extracted.usageRights ?? existing?.usageRights ?? null,
    confidence: Math.max(extracted.confidence ?? 0, existing?.confidence ?? 0),
  };

  if (existing) {
    const brandDeal = await prisma.brandDeal.update({ where: { id: existing.id }, data: merged });
    return { brandDeal, isNew: false };
  }

  // Concurrent analyses on the same conversation both miss the read above.
  // conversationId is unique, so the loser gets P2002 and re-reads the
  // winner's row instead of creating a second deal — which would otherwise
  // fire a duplicate "new brand deal" notification and double the usage
  // event. isNew stays false for the loser, so only one notification goes out.
  try {
    const brandDeal = await prisma.brandDeal.create({
      data: { conversationId, instagramAccountId, userId, status: 'new', ...merged },
    });
    return { brandDeal, isNew: true };
  } catch (err) {
    if (err.code === 'P2002') {
      const brandDeal = await prisma.brandDeal.update({ where: { conversationId }, data: merged });
      return { brandDeal, isNew: false };
    }
    throw err;
  }
}

module.exports = { upsertBrandDeal };
