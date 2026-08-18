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
  const existing = await prisma.brandDeal.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
  });

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

  const brandDeal = await prisma.brandDeal.create({
    data: { conversationId, instagramAccountId, userId, status: 'new', ...merged },
  });
  return { brandDeal, isNew: true };
}

module.exports = { upsertBrandDeal };
