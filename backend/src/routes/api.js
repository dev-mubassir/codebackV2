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
const { requireAuth } = require('../middleware/auth');
const instagram = require('../lib/instagram');
const { decrypt } = require('../lib/crypto');
const aiService = require('../services/aiService');
const { getOrCreatePreferences } = require('../services/preferencesService');
const { getOrCreateBusinessProfile } = require('../services/businessProfileService');
const { normalizeCategory } = require('../lib/constants');
const { emitToUser } = require('../lib/socket');

// All API routes require authentication
router.use(requireAuth);

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
    const { accountId, category, priority, unread, important } = req.query;

    const userAccountIds = await getOwnedAccountIds(req.userId);
    const targetAccountIds = accountId ? [accountId].filter((id) => userAccountIds.includes(id)) : userAccountIds;

    const whereClause = { instagramAccountId: { in: targetAccountIds } };
    if (category) {
      whereClause.category = normalizeCategory(category) === category ? category : category;
    }
    if (priority) {
      whereClause.priority = priority;
    }
    if (important === 'true') {
      // Same definition used by the dashboard's "attention queue" count.
      whereClause.OR = [{ needsAttention: true }, { priority: 'critical' }];
    }
    if (unread === 'true') {
      whereClause.unread = true;
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
      let messagingWindow = { status: 'unknown', canReply: false };

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
    res.status(500).json({ error: 'Failed to fetch conversations' });
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
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Build the query for messages
    const whereClause = { conversationId: id };
    if (before) {
      whereClause.createdAt = { lt: new Date(before) };
    }

    const messages = await prisma.message.findMany({
      where: whereClause,
      orderBy: { createdAt: 'asc' },
      take: parseInt(limit),
    });

    // Opening a conversation marks it read.
    if (conversation.unread) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { unread: false },
        include: { contact: { select: { id: true, igsid: true, username: true, name: true, profilePicUrl: true } } },
      });
    }

    res.json({
      conversation,
      messages,
    });
  } catch (error) {
    console.error('[API] Error fetching messages:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
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
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { unread: Boolean(unread) },
    });

    res.json({ id: updated.id, unread: updated.unread });
  } catch (error) {
    console.error('[API] Error updating read state:', error.message);
    res.status(500).json({ error: 'Failed to update conversation' });
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
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const dataToUpdate = {};
    if (typeof autoReplyEnabled === 'boolean') {
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

    console.log(`[API] AI Auto-Reply ${updated.autoReplyEnabled ? 'ENABLED' : 'DISABLED'} for conversation ${id} (@${updated.contact.username || 'user'})`);

    res.json({
      id: updated.id,
      autoReplyEnabled: updated.autoReplyEnabled,
      autoReplyPrompt: updated.autoReplyPrompt,
      contact: updated.contact,
      message: `AI Auto-Reply ${updated.autoReplyEnabled ? 'enabled' : 'disabled'} for @${updated.contact.username || 'this chat'}`
    });
  } catch (error) {
    console.error('[API] Error updating auto-reply settings:', error.message);
    res.status(500).json({ error: 'Failed to update auto-reply settings' });
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
      return res.status(404).json({ error: 'Conversation not found' });
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

    console.log(`[API] Cleared ${deleteResult.count} messages for conversation ${id} (@${conversation.contact?.username || 'user'})`);

    res.json({
      message: 'Chat cleared successfully',
      conversationId: id,
      deletedCount: deleteResult.count,
      conversation: updated,
    });
  } catch (error) {
    console.error('[API] Error clearing chat messages:', error.message);
    res.status(500).json({ error: 'Failed to clear chat messages' });
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
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Delete the conversation (Prisma schema cascades messages, AI analyses, summaries, etc.)
    await prisma.conversation.delete({
      where: { id },
    });

    emitToUser(req.userId, 'conversation_deleted', {
      conversationId: id,
    });

    console.log(`[API] Fully deleted conversation ${id} (@${conversation.contact?.username || 'user'})`);

    res.json({
      message: 'Conversation deleted successfully',
      conversationId: id,
    });
  } catch (error) {
    console.error('[API] Error deleting conversation:', error.message);
    res.status(500).json({ error: 'Failed to delete conversation' });
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
      return res.status(404).json({ error: 'Conversation not found' });
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
    res.status(500).json({ error: 'Failed to fetch AI analysis' });
  }
});

// ============================================
// POST /api/conversations/:id/generate-reply
// On-demand AI reply draft. NEVER sends anything — only returns text for
// the creator to review, edit, and (separately) send via POST .../reply.
// ============================================
router.post('/conversations/:id/generate-reply', async (req, res) => {
  try {
    const { id } = req.params;
    const { instructions } = req.body || {};

    const conversation = await prisma.conversation.findFirst({
      where: { id, instagramAccount: { userId: req.userId } },
      include: { contact: true },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
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
    });

    if (result.failed || !result.text) {
      return res.status(502).json({
        error: 'AI reply generation is unavailable right now.',
        details: result.errorMessage || 'The AI provider did not return a draft.',
      });
    }

    const saved = await prisma.replyGeneration.create({
      data: {
        conversationId: id,
        userId: req.userId,
        contextRef: `messages:${recentMessages.length};category:${conversation.category || 'other'}`,
        instructions: typeof instructions === 'string' ? instructions.slice(0, 500) : null,
        generatedText: result.text,
        model: result.model,
      },
    });

    res.json({ id: saved.id, text: saved.generatedText, model: saved.model, createdAt: saved.createdAt });
  } catch (error) {
    console.error('[API] Error generating reply:', error.message);
    res.status(500).json({ error: 'Failed to generate reply' });
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
      return res.status(400).json({ error: 'Message text is required' });
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
      return res.status(404).json({ error: 'Conversation not found' });
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

      // Check for 24-hour window violation
      if (errorData.code === 10 || errorData.error_subcode === 2534015) {
        return res.status(400).json({
          error: 'Cannot send message — outside the 24-hour messaging window. The user must message you first.',
        });
      }

      return res.status(502).json({
        error: 'Failed to send message via Instagram',
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
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: text.trim(),
        lastMessageAt: new Date(),
        unread: false,
        needsAttention: false,
      },
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
    });
  } catch (error) {
    console.error('[API] Error sending reply:', error.message);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// ============================================
// POST /api/contacts/:id/refresh-profile
// Force-refresh a contact's profile from Instagram (debugging helper)
// ============================================
router.post('/contacts/:id/refresh-profile', async (req, res) => {
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
      return res.status(404).json({ error: 'Contact not found' });
    }

    const accessToken = decrypt(contact.instagramAccount.accessToken);
    const profile = await instagram.fetchUserProfile(contact.igsid, accessToken);

    if (!profile) {
      return res.status(502).json({ error: 'Failed to fetch profile from Instagram' });
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

    console.log('[API] Force-refreshed profile for:', updated.username);
    res.json(updated);
  } catch (error) {
    console.error('[API] Error refreshing profile:', error.message);
    res.status(500).json({ error: 'Failed to refresh profile' });
  }
});

module.exports = router;
