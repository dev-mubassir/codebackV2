/**
 * API routes — conversations, messages, AI analysis, reply generation, and
 * sending replies.
 *
 * All routes require authentication (session cookie) and are strictly
 * tenant-scoped to the logged-in user's own Instagram accounts/conversations
 * — every query below filters by `instagramAccount: { userId: req.userId }`
 * (or an equivalent account-id whitelist), never by a client-supplied id.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { handleMetaError } = require('../lib/tokenHealth');
const { requireAuth } = require('../middleware/auth');
const { requireWorkspace } = require('../middleware/authorize');
const instagram = require('../lib/instagram');
const { decrypt } = require('../lib/crypto');
const aiService = require('../services/aiService');
const { getOrCreatePreferences } = require('../services/preferencesService');
const { getOrCreateBusinessProfile } = require('../services/businessProfileService');
const { normalizeCategory } = require('../lib/constants');
const { emitToUser } = require('../lib/socket');
const { createRateLimiter } = require('../lib/rateLimit');
const { isBillingEnabled } = require('../lib/billingFlags');
const entitlementService = require('../services/entitlementService');

// All API routes require authentication
// The canonical chain. requireWorkspace resolves the caller's owned
// Instagram account ids once and attaches them, so handlers scope on
// req.ownedAccountIds rather than each re-deriving ownership.
router.use(requireAuth);
router.use(requireWorkspace);

async function getOwnedAccountIds(userId) {
  const accounts = await prisma.instagramAccount.findMany({
    where: { userId },
    select: { id: true },
  });

  // NOTE: The old dev-mode fallback that returned ALL accounts when the
  // user had none has been removed — it leaked every other user's
  // conversations/messages/brand-deals into the current user's view.

  return accounts.map((a) => a.id);
}

// ============================================
// GET /api/conversations
// List all conversations for the logged-in user's Instagram accounts.
// Supports filtering by accountId, category, priority, and unread, and
// sorts important/unread conversations first.
// ============================================
router.get('/conversations', async (req, res) => {
  try {
    const { accountId, category, priority, unread, important, filter, needsHuman } = req.query;

    const userAccountIds = await getOwnedAccountIds(req.userId);
    const targetAccountIds = accountId ? [accountId].filter((id) => userAccountIds.includes(id)) : userAccountIds;

    const whereClause = { instagramAccountId: { in: targetAccountIds } };

    if (filter) {
      if (filter === 'unread') {
        whereClause.unread = true;
      } else if (filter === 'important') {
        whereClause.OR = [{ needsAttention: true }, { priority: { in: ['critical', 'high'] } }, { priorityScore: { gte: 70 } }];
      } else if (filter === 'hot_leads') {
        whereClause.OR = [{ category: 'hot_lead' }, { customerType: 'hot_lead' }, { purchaseIntent: { gte: 80 } }];
      } else if (filter === 'leads') {
        whereClause.OR = [
          { category: { in: ['lead', 'service_inquiry', 'product_inquiry', 'pricing_inquiry', 'availability_inquiry', 'delivery_inquiry', 'hot_lead'] } },
          { customerType: 'lead' },
          { customerType: 'hot_lead' },
        ];
      } else if (filter === 'customers') {
        whereClause.OR = [{ category: 'customer' }, { customerType: 'customer' }];
      } else if (filter === 'questions') {
        whereClause.category = 'general_question';
      } else if (filter === 'support') {
        whereClause.category = 'support_request';
      } else if (filter === 'brand_deal') {
        whereClause.category = { in: ['brand_deal', 'collaboration'] };
      } else if (filter === 'needs_human') {
        whereClause.OR = [{ needsHuman: true }, { needsAttention: true }];
      } else if (filter === 'spam') {
        whereClause.category = { in: ['spam', 'scam', 'abusive'] };
      }
    } else {
      if (category) {
        whereClause.category = normalizeCategory(category) === category ? category : category;
      }
      if (priority) {
        whereClause.priority = priority;
      }
      if (important === 'true') {
        whereClause.OR = [{ needsAttention: true }, { priority: 'critical' }];
      }
      if (unread === 'true') {
        whereClause.unread = true;
      }
      if (needsHuman === 'true') {
        whereClause.OR = [{ needsHuman: true }, { needsAttention: true }];
      }
    }

    // Fetch conversations with contact info
    const conversations = await prisma.conversation.findMany({
      where: whereClause,
      include: {
        contact: {
          select: {
            id: true,
            igsid: true,
            username: true,
            name: true,
            profilePicUrl: true,
          },
        },
        instagramAccount: {
          select: {
            id: true,
            igUsername: true,
          },
        },
        messages: {
          where: { direction: 'inbound' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        summaryRecord: { select: { summary: true, stage: true } },
        brandDeals: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, brandName: true, budgetAmount: true, budgetCurrency: true, status: true },
        },
      },
      orderBy: [{ priorityScore: 'desc' }, { lastMessageAt: 'desc' }],
    });

    // Add 24-hour messaging window status to each conversation
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const conversationsWithWindow = conversations.map(conv => {
      const lastInbound = conv.messages?.[0]?.createdAt;
      let messagingWindow = { status: 'unknown', canReply: true };

      if (lastInbound) {
        const elapsed = Date.now() - new Date(lastInbound).getTime();
        if (elapsed < TWENTY_FOUR_HOURS) {
          messagingWindow = {
            status: 'open',
            canReply: true,
            hoursRemaining: Math.round((TWENTY_FOUR_HOURS - elapsed) / (60 * 60 * 1000) * 10) / 10,
          };
        } else {
          messagingWindow = { status: 'closed', canReply: false };
        }
      }

      // Remove the raw messages field, replace with window info
      const { messages, brandDeals, summaryRecord, ...rest } = conv;
      return {
        ...rest,
        messagingWindow,
        summary: summaryRecord?.summary || null,
        stage: summaryRecord?.stage || null,
        latestBrandDeal: brandDeals?.[0] || null,
      };
    });

    res.json(conversationsWithWindow);
  } catch (error) {
    console.error('[API] Error fetching conversations:', error.message);
    res.status(500).json({ error: "Couldn't load your conversations. Refresh to try again." });
  }
});

// ============================================
// GET /api/conversations/:id/messages
// Get messages for a specific conversation. Marks the conversation as read.
// ============================================
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, before } = req.query;

    // Verify the conversation belongs to the logged-in user
    let conversation = await prisma.conversation.findFirst({
      where: {
        id: id,
        instagramAccount: { userId: req.userId },
      },
      include: {
        contact: {
          select: {
            id: true,
            igsid: true,
            username: true,
            name: true,
            profilePicUrl: true,
          },
        },
      },
    });

    // NOTE: The old dev-mode fallback that fetched any conversation by ID
    // regardless of ownership has been removed — it allowed any user to
    // read any other user's messages just by knowing the conversation ID.

    if (!conversation) {
      return res.status(404).json({ error: 'That conversation no longer exists.' });
    }

    // Build the query for messages
    const whereClause = { conversationId: id };
    if (before) {
      whereClause.createdAt = { lt: new Date(before) };
    }

    // Clamp page size to a sane ceiling to prevent resource-exhaustion via a
    // huge ?limit= value.
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const messages = await prisma.message.findMany({
      where: whereClause,
      orderBy: { createdAt: 'asc' },
      take: pageSize,
    });

    // Opening a conversation marks it read and clears pending attention & human review flags
    if (conversation.unread || conversation.needsAttention || conversation.needsHuman) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { unread: false, needsAttention: false, needsHuman: false },
        include: { contact: { select: { id: true, igsid: true, username: true, name: true, profilePicUrl: true } } },
      });

      emitToUser(req.userId, 'conversation_read', {
        conversationId: conversation.id,
        unread: false,
        needsAttention: false,
        needsHuman: false,
      });
    }

    // Compute real-time 24-hour messaging window from inbound messages
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const latestInbound = messages.filter(m => m.direction === 'inbound').slice(-1)[0];
    let messagingWindow = { status: 'unknown', canReply: true };

    if (latestInbound) {
      const elapsed = Date.now() - new Date(latestInbound.igTimestamp || latestInbound.createdAt).getTime();
      if (elapsed < TWENTY_FOUR_HOURS) {
        messagingWindow = {
          status: 'open',
          canReply: true,
          hoursRemaining: Math.round((TWENTY_FOUR_HOURS - elapsed) / (60 * 60 * 1000) * 10) / 10,
        };
      } else {
        messagingWindow = { status: 'closed', canReply: false };
      }
    }

    res.json({
      conversation: {
        ...conversation,
        messagingWindow,
      },
      messages,
    });
  } catch (error) {
    console.error('[API] Error fetching messages:', error.message);
    res.status(500).json({ error: "Couldn't open that conversation. Try again." });
  }
});

// ============================================
// POST /api/conversations/:id/read
// Explicitly mark a conversation read/unread (used by the inbox UI).
// ============================================
router.post('/conversations/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const { unread = false } = req.body || {};

    const conversation = await prisma.conversation.findFirst({
      where: { id, instagramAccount: { userId: req.userId } },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'That conversation no longer exists.' });
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: {
        unread: Boolean(unread),
        ...(unread ? {} : { needsAttention: false, needsHuman: false }),
      },
    });

    emitToUser(req.userId, 'conversation_read', {
      conversationId: updated.id,
      unread: updated.unread,
      needsAttention: updated.needsAttention,
      needsHuman: updated.needsHuman,
    });

    res.json({ id: updated.id, unread: updated.unread, needsAttention: updated.needsAttention, needsHuman: updated.needsHuman });
  } catch (error) {
    console.error('[API] Error updating read state:', error.message);
    res.status(500).json({ error: "Couldn't update that conversation. Try again." });
  }
});

// ============================================
// PATCH /api/conversations/:id/auto-reply
// Toggle or configure AI Auto-Reply for this specific conversation
// ============================================
router.patch('/conversations/:id/auto-reply', async (req, res) => {
  try {
    const { id } = req.params;
    const { autoReplyEnabled, autoReplyPrompt } = req.body || {};

    const conversation = await prisma.conversation.findFirst({
      where: { id, instagramAccount: { userId: req.userId } },
      include: { contact: true },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'That conversation no longer exists.' });
    }

    const dataToUpdate = {};
    // Three-state: true = opt in, false = opt out, null = inherit the tenant's
    // BusinessProfile.autoReplyMode. `undefined` leaves the field untouched.
    if (typeof autoReplyEnabled === 'boolean' || autoReplyEnabled === null) {
      dataToUpdate.autoReplyEnabled = autoReplyEnabled;
    }
    if (typeof autoReplyPrompt !== 'undefined') {
      dataToUpdate.autoReplyPrompt = typeof autoReplyPrompt === 'string' ? autoReplyPrompt.slice(0, 500) : null;
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: dataToUpdate,
      include: {
        contact: { select: { id: true, igsid: true, username: true, name: true, profilePicUrl: true } },
      },
    });

    console.log(`[API] AI Auto-Reply ${updated.autoReplyEnabled ? 'ENABLED' : 'DISABLED'} for conversation ${id} (contact ${updated.contact.igsid})`);

    res.json({
      id: updated.id,
      autoReplyEnabled: updated.autoReplyEnabled,
      autoReplyPrompt: updated.autoReplyPrompt,
      contact: updated.contact,
      message: `AI Auto-Reply ${updated.autoReplyEnabled ? 'enabled' : 'disabled'} for @${updated.contact.username || 'this chat'}`
    });
  } catch (error) {
    console.error('[API] Error updating auto-reply settings:', error.message);
    res.status(500).json({ error: "Couldn't change automatic replies for that conversation. Try again." });
  }
});

// ============================================
// DELETE /api/conversations/:id/messages
// Clear all messages in a conversation (keeps the conversation & contact)
// ============================================
router.delete('/conversations/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, instagramAccount: { userId: req.userId } },
      include: { contact: true },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'That conversation no longer exists.' });
    }

    // Delete all messages in the conversation
    const deleteResult = await prisma.message.deleteMany({
      where: { conversationId: id },
    });

    // Reset conversation preview fields
    const updated = await prisma.conversation.update({
      where: { id },
      data: {
        lastMessage: null,
        lastMessageAt: null,
        unread: false,
        needsAttention: false,
        needsHuman: false,
      },
    });

    emitToUser(req.userId, 'chat_cleared', {
      conversationId: id,
      deletedCount: deleteResult.count,
    });

    console.log(`[API] Cleared ${deleteResult.count} messages for conversation ${id} (contact ${conversation.contact?.igsid || 'unknown'})`);

    res.json({
      message: 'Messages cleared',
      conversationId: id,
      deletedCount: deleteResult.count,
      conversation: updated,
    });
  } catch (error) {
    console.error('[API] Error clearing chat messages:', error.message);
    res.status(500).json({ error: "Couldn't clear those messages. Try again." });
  }
});

// ============================================
// DELETE /api/conversations/:id
// Fully delete a conversation thread and all related records
// ============================================
router.delete('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, instagramAccount: { userId: req.userId } },
      include: { contact: true },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'That conversation no longer exists.' });
    }

    // Delete the conversation (Prisma schema cascades messages, AI analyses, summaries, etc.)
    await prisma.conversation.delete({
      where: { id },
    });

    emitToUser(req.userId, 'conversation_deleted', {
      conversationId: id,
    });

    console.log(`[API] Fully deleted conversation ${id} (contact ${conversation.contact?.igsid || 'unknown'})`);

    res.json({
      message: 'Conversation deleted',
      conversationId: id,
    });
  } catch (error) {
    console.error('[API] Error deleting conversation:', error.message);
    res.status(500).json({ error: "Couldn't delete that conversation. Try again." });
  }
});

// ============================================
// GET /api/conversations/:id/ai-analysis
// Latest AI understanding of a conversation: analysis, summary, brand deal.
// ============================================
router.get('/conversations/:id/ai-analysis', async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, instagramAccount: { userId: req.userId } },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'That conversation no longer exists.' });
    }

    const [latestAnalysis, summary, brandDeal, replyGenerations] = await Promise.all([
      prisma.aIAnalysis.findFirst({ where: { conversationId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.conversationSummary.findUnique({ where: { conversationId: id } }),
      prisma.brandDeal.findFirst({ where: { conversationId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.replyGeneration.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);

    res.json({
      category: conversation.category,
      priority: conversation.priority,
      priorityScore: conversation.priorityScore,
      needsAttention: conversation.needsAttention,
      latestAnalysis,
      summary,
      brandDeal,
      recentReplyGenerations: replyGenerations,
    });
  } catch (error) {
    console.error('[API] Error fetching AI analysis:', error.message);
    res.status(500).json({ error: "Couldn't load the insights for that conversation. Try again." });
  }
});

// ============================================
// POST /api/conversations/:id/generate-reply
// On-demand AI reply draft. NEVER sends anything — only returns text for
// the creator to review, edit, and (separately) send via POST .../reply.
//
// DRAFT CREDITS (billing on only). Each SUCCESSFUL draft costs exactly one
// draft credit — never a reply credit; auto-replies spend those. The credit
// is reserved before the AI call and given back (a compensating ledger row)
// if the call fails or anything after it throws, so a failed draft costs
// nothing. The client sends a per-click Idempotency-Key: the reservation and
// the saved draft both carry it (unique), so a double-click or a retried
// request returns the same draft and charges once.
//
// Billing off: exactly as before — no gate, no ledger, no counter.
// ============================================
const DRAFT_KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;

/** The client's per-click key, or null when absent/invalid (then there is nothing to deduplicate against). */
function readDraftKey(req) {
  const raw = req.get('Idempotency-Key') || (req.body && req.body.idempotencyKey);
  return typeof raw === 'string' && DRAFT_KEY_RE.test(raw) ? raw : null;
}

/** What the inbox counter shows after this request. */
async function draftCreditsPayload(tenantId) {
  if (!isBillingEnabled()) return null;
  const st = await entitlementService.draftCreditStatus(tenantId);
  return { remaining: st.remaining, unlimited: st.unlimited, allowed: st.allowed, reason: st.reason };
}

const DRAFT_BLOCKED = {
  not_entitled: { code: 'DRAFT_NOT_ENTITLED', error: 'AI drafts need an active plan or trial.' },
  exhausted: { code: 'DRAFT_CREDITS_EXHAUSTED', error: 'You have no draft credits left. Buy more on the billing page.' },
};

router.post('/conversations/:id/generate-reply', async (req, res) => {
  const billing = isBillingEnabled();
  // Without a client key there is nothing to deduplicate: a fresh server key
  // still ties the reservation to its refund.
  const clientKey = readDraftKey(req);
  const key = clientKey || `srv_${require('crypto').randomUUID().replace(/-/g, '')}`;
  let reserved = false;
  let delivered = false;

  try {
    const { id } = req.params;
    const { instructions } = req.body || {};

    const conversation = await prisma.conversation.findFirst({
      where: { id, instagramAccount: { userId: req.userId } },
      include: { contact: true },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'That conversation no longer exists.' });
    }

    if (billing) {
      // A retry of a draft that already succeeded: the same draft, no charge.
      if (clientKey) {
        const prior = await prisma.replyGeneration.findUnique({
          where: { userId_idempotencyKey: { userId: req.userId, idempotencyKey: clientKey } },
        });
        if (prior) {
          delivered = true;
          return res.json({
            id: prior.id, text: prior.generatedText, model: prior.model, createdAt: prior.createdAt,
            duplicate: true, draftCredits: await draftCreditsPayload(req.userId),
          });
        }
      }

      const reservation = await entitlementService.reserveDraftCredit(req.userId, key);
      if (reservation.outcome === 'duplicate') {
        // Same key, still generating (the first request has not saved yet).
        return res.status(409).json({ code: 'DRAFT_IN_PROGRESS', error: 'That draft is already being written.' });
      }
      if (DRAFT_BLOCKED[reservation.outcome]) {
        return res.status(402).json({ ...DRAFT_BLOCKED[reservation.outcome], draftCredits: await draftCreditsPayload(req.userId) });
      }
      reserved = reservation.outcome === 'reserved';
    }

    const [recentMessages, preferences, businessProfile, brandDeal] = await Promise.all([
      prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      getOrCreatePreferences(req.userId),
      getOrCreateBusinessProfile(req.userId),
      prisma.brandDeal.findFirst({ where: { conversationId: id }, orderBy: { createdAt: 'desc' } }),
    ]);

    const result = await aiService.generateReply({
      recentMessages: recentMessages.reverse(),
      contactUsername: conversation.contact.username,
      brandDeal,
      businessProfile,
      preferences,
      instructions: typeof instructions === 'string' ? instructions.slice(0, 500) : null,
      category: conversation.category || 'other',
      tenantId: req.userId,
    });

    if (result.failed || !result.text) {
      if (reserved) {
        await entitlementService.refundDraftCredit(req.userId, key, 'ai_failed');
        reserved = false;
      }
      return res.status(502).json({
        error: "Couldn't draft a reply just now — write your own in the box above.",
        details: result.errorMessage || 'The AI provider did not return a draft.',
        draftCredits: await draftCreditsPayload(req.userId),
      });
    }

    let saved;
    try {
      saved = await prisma.replyGeneration.create({
        data: {
          conversationId: id,
          userId: req.userId,
          contextRef: `messages:${recentMessages.length};category:${conversation.category || 'other'}`,
          instructions: typeof instructions === 'string' ? instructions.slice(0, 500) : null,
          generatedText: result.text,
          model: result.model,
          idempotencyKey: billing ? clientKey : null,
        },
      });
    } catch (err) {
      // Same key saved concurrently (only reachable on an unlimited plan, which
      // reserves nothing): answer with the draft that won.
      if (err.code !== 'P2002' || !clientKey) throw err;
      saved = await prisma.replyGeneration.findUnique({
        where: { userId_idempotencyKey: { userId: req.userId, idempotencyKey: clientKey } },
      });
    }
    delivered = true;

    res.json({
      id: saved.id,
      text: saved.generatedText,
      model: saved.model,
      createdAt: saved.createdAt,
      draftCredits: await draftCreditsPayload(req.userId),
    });
  } catch (error) {
    console.error('[API] Error generating reply:', error.message);
    // Give the credit back BEFORE answering, so the customer's counter is
    // already right when they read it.
    if (reserved && !delivered) {
      reserved = false;
      await entitlementService
        .refundDraftCredit(req.userId, key, 'not_delivered')
        .catch((err) => console.error('[API] Could not refund a draft credit:', err.message));
    }
    if (!res.headersSent) res.status(500).json({ error: "Couldn't draft a reply just now — write your own in the box above." });
  } finally {
    // Anything that stopped the draft reaching the customer after the credit
    // was reserved gives it back. Never throws out of the handler.
    if (reserved && !delivered) {
      await entitlementService
        .refundDraftCredit(req.userId, key, 'not_delivered')
        .catch((err) => console.error('[API] Could not refund a draft credit:', err.message));
    }
  }
});

// ============================================
// POST /api/conversations/:id/reply
// Send a reply message in a conversation. This is the ONLY code path that
// ever calls the Instagram send-message API — always an explicit creator
// action, never automatic.
// ============================================
router.post('/conversations/:id/reply', async (req, res) => {
  try {
    const { id } = req.params;
    const { text, replyGenerationId } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Write something before sending.' });
    }

    // Find the conversation and verify ownership
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: id,
        instagramAccount: { userId: req.userId },
      },
      include: {
        contact: true,
        instagramAccount: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'That conversation no longer exists.' });
    }

    // Send the message via Instagram API
    console.log('[API] Sending reply to IGSID:', conversation.contact.igsid);

    let igResponse;
    try {
      igResponse = await instagram.sendMessage(
        conversation.contact.igsid,
        text.trim(),
        decrypt(conversation.instagramAccount.accessToken)
      );
    } catch (apiError) {
      const errorData = apiError.response?.data?.error || {};
      console.error('[API] Instagram API error:', errorData);

      // A dead token is a different problem from a rejected message: flag the
      // account, email the owner once, and tell the user to reconnect rather
      // than presenting it as a transient upstream failure.
      if (await handleMetaError(apiError, conversation.instagramAccount.id).catch(() => false)) {
        return res.status(400).json({
          error: 'Instagram disconnected this account. Reconnect it to keep replying.',
          code: 'NEEDS_RECONNECT',
        });
      }

      // Check for 24-hour window violation
      if (errorData.code === 10 || errorData.error_subcode === 2534015) {
        return res.status(400).json({
          error: 'You can only reply within 24 hours of their last message. Ask them to message you again.',
        });
      }

      return res.status(502).json({
        error: "Couldn't send your message. Try again.",
        details: errorData.message || 'Unknown error',
      });
    }

    // Save the outbound message in our database
    const savedMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        igMessageId: igResponse.message_id || null,
        direction: 'outbound',
        content: text.trim(),
        messageType: 'text',
        aiStatus: 'skipped', // outbound/creator messages are never AI-classified
        igTimestamp: new Date(),
      },
    });

    // Update conversation's last message; replying implies it's been handled.
    const updatedConv = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: text.trim(),
        lastMessageAt: new Date(),
        unread: false,
        needsAttention: false,
        needsHuman: false,
      },
    });

    emitToUser(req.userId, 'conversation_read', {
      conversationId: updatedConv.id,
      unread: false,
      needsAttention: false,
      needsHuman: false,
    });

    // Best-effort audit trail: mark the draft as sent if it was used verbatim.
    if (replyGenerationId) {
      await prisma.replyGeneration.updateMany({
        where: { id: replyGenerationId, conversationId: conversation.id },
        data: { wasSent: true },
      }).catch(() => {});
    }

    console.log('[API] Reply sent and saved:', savedMessage.id);

    res.json({
      message: savedMessage,
      igResponse,
      conversation: updatedConv,
    });
  } catch (error) {
    console.error('[API] Error sending reply:', error.message);
    res.status(500).json({ error: "Couldn't send your message. Try again." });
  }
});

// ============================================
// POST /api/contacts/:id/refresh-profile
//
// Re-fetch one contact's username/name/photo from Instagram.
//
// This is no longer just a debugging helper: the frontend <Avatar> component
// calls it when a stored profile picture URL fails to load, because Instagram
// CDN URLs are signed and expire after roughly four days. That makes it
// user-triggerable at the rate of "every broken avatar on screen", so it is
// throttled twice over:
//
//   1. PROFILE_MIN_REFRESH_MS below — a database-backed freshness check on
//      contact.lastFetchedAt. This is the one that actually protects the Graph
//      API quota: it survives restarts and holds across multiple instances,
//      because the timestamp lives in Postgres rather than in a process.
//   2. refreshProfileLimiter — an in-memory request limiter, so a client that
//      ignores the 429 cannot spin the endpoint even though step 1 makes each
//      call cheap.
//
// Tenant isolation is unchanged and was already correct: requireAuth +
// requireWorkspace run for the whole router, and the findFirst below scopes on
// `instagramAccount: { userId: req.userId }`, so another tenant's contact id
// returns 404 rather than data.
// ============================================

// One Instagram call per contact per hour. A signed URL lives for days, so
// refreshing more often than this cannot fix anything it has not already fixed.
const PROFILE_MIN_REFRESH_MS = 60 * 60 * 1000;

// Keyed by user id; the contact id is part of the request path, which the
// limiter folds into its bucket key — so this is per-user, per-contact.
const refreshProfileLimiter = createRateLimiter({
  windowMs: PROFILE_MIN_REFRESH_MS,
  max: 4,
  keyBy: (req) => req.userId,
  message: 'That profile was refreshed recently. Try again later.',
});

router.post('/contacts/:id/refresh-profile', refreshProfileLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    const contact = await prisma.contact.findFirst({
      where: {
        id: id,
        instagramAccount: { userId: req.userId },
      },
      include: { instagramAccount: true },
    });

    if (!contact) {
      return res.status(404).json({ error: 'That contact no longer exists.' });
    }

    // Already refreshed within the window — hand back what we have instead of
    // spending a Graph API call. The caller cannot tell the difference, and a
    // second broken load in the same hour is not going to be fixed by asking
    // Instagram the same question again.
    const age = contact.lastFetchedAt ? Date.now() - contact.lastFetchedAt.getTime() : Infinity;
    if (age < PROFILE_MIN_REFRESH_MS) {
      const { instagramAccount, ...safeContact } = contact;
      return res.json(safeContact);
    }

    const accessToken = decrypt(contact.instagramAccount.accessToken);
    const profile = await instagram.fetchUserProfile(contact.igsid, accessToken);

    if (!profile) {
      return res.status(502).json({ error: "Couldn't refresh that profile from Instagram. Try again." });
    }

    const updated = await prisma.contact.update({
      where: { id: contact.id },
      data: {
        username: profile.username || contact.username,
        name: profile.name || contact.name,
        profilePicUrl: profile.profile_pic || contact.profilePicUrl,
        lastFetchedAt: new Date(),
      },
    });

    console.log('[API] Force-refreshed profile for contact:', updated.igsid);
    res.json(updated);
  } catch (error) {
    console.error('[API] Error refreshing profile:', error.message);
    res.status(500).json({ error: "Couldn't refresh that profile. Try again." });
  }
});

module.exports = router;
