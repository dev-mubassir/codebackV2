/**
 * API routes — conversations, messages, and reply.
 * 
 * All routes require authentication (session cookie).
 * They operate on the logged-in user's Instagram accounts.
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const instagram = require('../lib/instagram');
const { decrypt } = require('../lib/crypto');

const prisma = new PrismaClient();

// All API routes require authentication
router.use(requireAuth);

// ============================================
// GET /api/conversations
// List all conversations for the logged-in user's Instagram accounts
// ============================================
router.get('/conversations', async (req, res) => {
  try {
    const { accountId, category } = req.query;

    // Get all Instagram accounts owned by this user
    let accounts = await prisma.instagramAccount.findMany({
      where: { userId: req.userId },
      select: { id: true },
    });

    if (accounts.length === 0 && process.env.NODE_ENV !== 'production') {
      accounts = await prisma.instagramAccount.findMany({
        select: { id: true },
      });
    }

    const userAccountIds = accounts.map(a => a.id);
    const targetAccountIds = accountId ? [accountId].filter(id => userAccountIds.includes(id)) : userAccountIds;

    const whereClause = { instagramAccountId: { in: targetAccountIds } };
    if (category) {
      whereClause.category = category;
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
      },
      orderBy: { lastMessageAt: 'desc' },
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
      const { messages, ...rest } = conv;
      return { ...rest, messagingWindow };
    });

    res.json(conversationsWithWindow);
  } catch (error) {
    console.error('[API] Error fetching conversations:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// ============================================
// GET /api/conversations/:id/messages
// Get messages for a specific conversation
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

    if (!conversation && process.env.NODE_ENV !== 'production') {
      conversation = await prisma.conversation.findUnique({
        where: { id: id },
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
    }

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
// POST /api/conversations/:id/reply
// Send a reply message in a conversation
// ============================================
router.post('/conversations/:id/reply', async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

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
        igTimestamp: new Date(),
      },
    });

    // Update conversation's last message
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: text.trim(),
        lastMessageAt: new Date(),
      },
    });

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
