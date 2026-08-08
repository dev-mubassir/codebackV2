/**
 * Webhook routes — handles incoming Instagram webhook events.
 * 
 * Meta sends all DM events to a single webhook endpoint.
 * We identify which Codeback user owns the account via entry.id (the IG User ID),
 * then process the message and push it to the frontend in real-time.
 * 
 * Important: The raw body must be available for signature verification.
 * The main server passes `req.rawBody` for this purpose.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const instagram = require('../lib/instagram');
const { decrypt } = require('../lib/crypto');
const { classifyAndSuggest, shouldUpdateCategory } = require('../services/aiService');

const prisma = new PrismaClient();

// Reference to Socket.io server — set from index.js
let io = null;
function setSocketIO(socketIO) {
  io = socketIO;
}

// ============================================
// GET /webhook & GET /webhooks/instagram
// Webhook verification endpoint (Meta sends this to verify your endpoint)
// ============================================
router.get('/', (req, res) => {
  const challenge = req.query['hub.challenge'];
  const token = req.query['hub.verify_token'];

  console.log('[Webhook] Verification GET request received. Verify token:', token);

  if (challenge) {
    console.log('[Webhook] Responding with challenge string:', challenge);
    return res.status(200).send(challenge);
  }

  res.status(200).send('Webhook Endpoint Active');
});

// ============================================
// POST /webhook & POST /webhooks/instagram
// Receive incoming webhook events (messages, reactions, read receipts)
// ============================================
router.post('/', async (req, res) => {
  const body = req.body || {};

  // Respond immediately with 200 (Meta requires fast response)
  res.status(200).send('EVENT_RECEIVED');

  // Process the webhook payload asynchronously
  try {
    for (const entry of body.entry || []) {
      await processEntry(entry);
    }
  } catch (error) {
    console.error('[Webhook] Error processing event:', error.message);
  }
});

/**
 * Verify the X-Hub-Signature-256 header to ensure the request came from Meta.
 */
function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader || !rawBody) {
    console.warn('[Webhook] Missing signature or raw body');
    // For testing, allow unsigned requests if WEBHOOK_VERIFY_SIGNATURE is not set
    if (process.env.SKIP_SIGNATURE_VERIFICATION === 'true') {
      return true;
    }
    return false;
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', process.env.INSTAGRAM_APP_SECRET)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expectedSignature)
  );
}

/**
 * Process a single entry from the webhook payload.
 * entry.id = the Instagram User ID that received the event.
 */
async function processEntry(entry, fullBody) {
  const igUserId = String(entry.id);

  // Redact payload sensitive tokens/secrets before storing in WebhookLog
  const redactedPayload = JSON.stringify(fullBody, (key, value) => {
    if (['access_token', 'client_secret', 'signature'].includes(key)) return '[REDACTED]';
    return value;
  });

  // Find the Codeback Instagram account that matches this IG User ID
  const account = await prisma.instagramAccount.findUnique({
    where: { igUserId: igUserId },
    include: { user: true },
  });

  if (!account) {
    console.warn('[Webhook] No account found for IG User ID:', igUserId);

    // Record unmapped webhook event
    await prisma.webhookLog.create({
      data: {
        igUserId,
        eventType: 'unmapped',
        status: 'SKIPPED',
        payload: redactedPayload,
        errorMessage: `No connected account found for IG User ID ${igUserId}`,
      }
    }).catch(() => {});

    return;
  }

  // Update lastWebhookAt timestamp
  await prisma.instagramAccount.update({
    where: { id: account.id },
    data: { lastWebhookAt: new Date() }
  }).catch(() => {});

  console.log('[Webhook] Processing event for account:', account.igUsername);

  // Process messaging events
  try {
    for (const messagingEvent of entry.messaging || []) {
      if (messagingEvent.message) {
        await handleIncomingMessage(account, messagingEvent);
      } else if (messagingEvent.read) {
        console.log('[Webhook] Read receipt from:', messagingEvent.sender?.id);
      } else if (messagingEvent.reaction) {
        console.log('[Webhook] Reaction from:', messagingEvent.sender?.id);
      }
    }

    // Record successful webhook log
    await prisma.webhookLog.create({
      data: {
        instagramAccountId: account.id,
        igUserId,
        eventType: 'messaging',
        status: 'SUCCESS',
        payload: redactedPayload,
      }
    }).catch(() => {});

  } catch (error) {
    console.error('[Webhook] Processing error:', error.message);

    // Record failed webhook log
    await prisma.webhookLog.create({
      data: {
        instagramAccountId: account.id,
        igUserId,
        eventType: 'messaging',
        status: 'FAILED',
        payload: redactedPayload,
        errorMessage: error.message,
      }
    }).catch(() => {});
  }
}

/**
 * Handle an incoming DM.
 * - Find or create the contact (fetch profile if needed)
 * - Find or create the conversation
 * - Save the message
 * - Push to frontend via Socket.io
 */
async function handleIncomingMessage(account, messagingEvent) {
  const senderIgsid = String(messagingEvent.sender.id);
  const recipientId = String(messagingEvent.recipient.id);
  const message = messagingEvent.message;
  const timestamp = messagingEvent.timestamp;

  // Skip echo messages — Instagram sends your own outbound messages back
  // Check both the is_echo flag and sender matching the account owner
  if (message.is_echo || senderIgsid === account.igUserId) {
    console.log('[Webhook] Skipping echo/outbound message (is_echo:', message.is_echo, ', sender:', senderIgsid, ')');
    return;
  }

  console.log('[Webhook] Incoming message from IGSID:', senderIgsid);

  // Step 1: Find or create the contact, fetching their profile if needed
  let contact = await prisma.contact.findUnique({
    where: {
      instagramAccountId_igsid: {
        instagramAccountId: account.id,
        igsid: senderIgsid,
      },
    },
  });

  // Fetch profile if contact doesn't exist or profile is stale (older than 24 hours)
  const shouldFetchProfile = !contact ||
    !contact.lastFetchedAt ||
    (Date.now() - contact.lastFetchedAt.getTime() > 24 * 60 * 60 * 1000);

  if (shouldFetchProfile) {
    const accessToken = decrypt(account.accessToken);
    const profile = await instagram.fetchUserProfile(senderIgsid, accessToken);

    if (contact) {
      // Update existing contact with fresh profile data
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: {
          username: profile?.username || contact.username,
          name: profile?.name || contact.name,
          profilePicUrl: profile?.profile_pic || contact.profilePicUrl,
          lastFetchedAt: new Date(),
        },
      });
    } else {
      // Create new contact
      contact = await prisma.contact.create({
        data: {
          instagramAccountId: account.id,
          igsid: senderIgsid,
          username: profile?.username || `user_${senderIgsid.slice(-6)}`,
          name: profile?.name || null,
          profilePicUrl: profile?.profile_pic || null,
          lastFetchedAt: new Date(),
        },
      });
    }
  }

  // Step 2: Find or create the conversation
  let conversation = await prisma.conversation.findUnique({
    where: {
      instagramAccountId_contactId: {
        instagramAccountId: account.id,
        contactId: contact.id,
      },
    },
  });

  // Determine message content and type
  const messageText = message.text || null;
  const messageType = message.attachments?.[0]?.type || 'text';
  const attachmentUrl = message.attachments?.[0]?.payload?.url || null;
  // Timestamp from Meta is often in milliseconds. If it's less than 1e11, it's seconds.
  const parsedTimestamp = typeof timestamp === 'number' ? (timestamp > 1e11 ? timestamp : timestamp * 1000) : parseInt(timestamp, 10);
  const igTimestamp = timestamp ? new Date(parsedTimestamp) : new Date();

  const lastMessagePreview = messageText || `[${messageType}]`;

  // Step 2.5: Classify incoming message & generate AI reply suggestion
  const { category, reply: suggestedReply } = await classifyAndSuggest(messageText, contact.username);
  console.log(`[Webhook] Classified message from @${contact.username} as [${category}]`);

  const updatedConvCategory = shouldUpdateCategory(conversation?.category, category);

  if (conversation) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: lastMessagePreview,
        lastMessageAt: igTimestamp,
        category: updatedConvCategory,
      },
    });
  } else {
    conversation = await prisma.conversation.create({
      data: {
        instagramAccountId: account.id,
        contactId: contact.id,
        lastMessage: lastMessagePreview,
        lastMessageAt: igTimestamp,
        category: category,
      },
    });
  }

  // Step 3: Save the message (with deduplication via igMessageId)
  const igMessageId = message.mid;
  let existingMsg = null;

  if (igMessageId) {
    existingMsg = await prisma.message.findUnique({
      where: { igMessageId: igMessageId },
    });
  }

  if (existingMsg) {
    console.log('[Webhook] Duplicate message, skipping:', igMessageId);
    return;
  }

  const savedMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      igMessageId: igMessageId,
      direction: 'inbound',
      content: messageText,
      category: category,
      suggestedReply: suggestedReply,
      messageType: messageType,
      attachmentUrl: attachmentUrl,
      igTimestamp: igTimestamp,
    },
  });

  // Step 4: Emit Socket.io event for real-time UI updates
  try {
    const io = req.app.get('io');
    if (io) {
      const roomName = `user:${account.userId}`;
      io.to(roomName).emit('new_message', {
        conversationId: conversation.id,
        accountId: account.id,
        category: category,
        suggestedReply: suggestedReply,
        message: savedMessage,
        contact: contact,
      });
    }
  } catch (socketErr) {
    console.warn('[Webhook] Failed to emit Socket.io event:', socketErr.message);
  }

  console.log('[Webhook] Message saved:', savedMessage.id);

  // Step 4: Push to frontend via Socket.io
  if (io) {
    const payload = {
      conversationId: conversation.id,
      message: {
        id: savedMessage.id,
        direction: 'inbound',
        content: savedMessage.content,
        messageType: savedMessage.messageType,
        attachmentUrl: savedMessage.attachmentUrl,
        igTimestamp: savedMessage.igTimestamp,
        createdAt: savedMessage.createdAt,
      },
      contact: {
        id: contact.id,
        username: contact.username,
        name: contact.name,
        profilePicUrl: contact.profilePicUrl,
      },
      conversation: {
        id: conversation.id,
        lastMessage: conversation.lastMessage,
        lastMessageAt: conversation.lastMessageAt,
      },
    };

    // Emit to the user's room (user ID-based room)
    io.to(`user:${account.userId}`).emit('new_message', payload);
    console.log('[Webhook] Emitted new_message to user:', account.userId);
  }
}

module.exports = router;
module.exports.setSocketIO = setSocketIO;
