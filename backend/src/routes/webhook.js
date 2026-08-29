/**
 * Webhook routes — handles incoming Instagram webhook events.
 *
 * Meta sends all DM events to a single webhook endpoint. We identify which
 * Codeback user owns the account via entry.id (the IG User ID), persist the
 * message immediately, and queue AI analysis to run in the background — the
 * webhook itself must stay fast and must never block on AI inference.
 *
 * Important: The raw body must be available for signature verification.
 * The main server passes `req.rawBody` for this purpose.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../lib/prisma');
const instagram = require('../lib/instagram');
const { decrypt } = require('../lib/crypto');
const { emitToUser } = require('../lib/socket');
const { enqueueMessageAnalysis } = require('../jobs');
const isProduction = process.env.NODE_ENV === 'production';

// Kept for backwards compatibility with index.js — Socket.io is now
// accessed through lib/socket.js everywhere, so this is a no-op shim.
function setSocketIO() {}

// ============================================
// GET /webhook & GET /webhooks/instagram
// Webhook verification endpoint (Meta sends this to verify your endpoint)
// ============================================
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('[Webhook] Verification request received:', { mode, token: token ? '***' : undefined });

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('[Webhook] Verified successfully with Meta!');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] Verification failed — token mismatch or invalid mode.');
  return res.status(403).send('Verification failed');
});

// ============================================
// POST /webhook & POST /webhooks/instagram
// Receive incoming webhook events (messages, reactions, read receipts)
// ============================================
router.post('/', async (req, res) => {
  const signatureHeader = req.headers['x-hub-signature-256'];

  if (!verifySignature(req.rawBody, signatureHeader)) {
    console.warn('[Webhook] Rejected request: invalid or missing X-Hub-Signature-256.');
    return res.status(401).send('Invalid signature');
  }

  const body = req.body || {};

  // Respond immediately with 200 (Meta requires a fast response — all AI
  // processing happens asynchronously after this, never before it).
  res.status(200).send('EVENT_RECEIVED');

  try {
    for (const entry of body.entry || []) {
      await processEntry(entry, body);
    }
  } catch (error) {
    console.error('[Webhook] Error processing event:', error.message);
  }
});

/**
 * Verify the X-Hub-Signature-256 header to ensure the request came from Meta.
 */
function verifySignature(rawBody, signatureHeader) {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;

  // Without a configured secret we cannot verify anything. Never fall back to
  // an empty HMAC key — that key is attacker-known and lets anyone forge a
  // valid signature. Reject (except the explicit non-production test hatch).
  if (!appSecret) {
    if (process.env.SKIP_SIGNATURE_VERIFICATION === 'true' && !isProduction) {
      console.warn('[Webhook] INSTAGRAM_APP_SECRET unset — allowed only because SKIP_SIGNATURE_VERIFICATION=true in non-production.');
      return true;
    }
    console.error('[Webhook] Rejected: INSTAGRAM_APP_SECRET is not configured; cannot verify signatures.');
    return false;
  }

  if (!signatureHeader || !rawBody) {
    // Development/testing escape hatch — STRUCTURALLY BLOCKED in production
    if (process.env.SKIP_SIGNATURE_VERIFICATION === 'true' && !isProduction) {
      console.warn('[Webhook] Missing signature/raw body — allowed because SKIP_SIGNATURE_VERIFICATION=true in non-production.');
      return true;
    }
    console.warn('[Webhook] Missing signature or raw body.');
    return false;
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const provided = Buffer.from(signatureHeader);
  const expected = Buffer.from(expectedSignature);

  // Buffers of different lengths would make timingSafeEqual throw instead of
  // returning false — guard against that first.
  if (provided.length !== expected.length) {
    if (process.env.SKIP_SIGNATURE_VERIFICATION === 'true' && !isProduction) {
      console.warn('[Webhook] Signature length mismatch — allowed because SKIP_SIGNATURE_VERIFICATION=true in non-production.');
      return true;
    }
    return false;
  }

  const isValid = crypto.timingSafeEqual(provided, expected);
  if (!isValid && process.env.SKIP_SIGNATURE_VERIFICATION === 'true' && !isProduction) {
    console.warn('[Webhook] Signature mismatch — allowed because SKIP_SIGNATURE_VERIFICATION=true in non-production.');
    return true;
  }

  return isValid;
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

  // Check if the account has been disconnected by the user
  if (account.connectionStatus === 'DISCONNECTED') {
    console.warn(`[Webhook] Account @${account.igUsername || igUserId} is disconnected. Skipping event.`);

    await prisma.webhookLog.create({
      data: {
        instagramAccountId: account.id,
        igUserId,
        eventType: 'skipped_disconnected',
        status: 'SKIPPED',
        payload: redactedPayload,
        errorMessage: `Account @${account.igUsername || igUserId} is disconnected. Webhook skipped.`,
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
 * - Save the message (original content is never modified by AI)
 * - Push the raw message to the frontend via Socket.io immediately
 * - Queue AI analysis to run in the background (classification, priority,
 *   brand-deal extraction, summary) — never inline/blocking here.
 */
async function handleIncomingMessage(account, messagingEvent) {
  const senderIgsid = String(messagingEvent.sender.id);
  const message = messagingEvent.message;
  const timestamp = messagingEvent.timestamp;

  // Skip echo messages — Instagram sends your own outbound messages back
  // Check both the is_echo flag and sender matching the account owner
  if (message.is_echo || senderIgsid === account.igUserId) {
    console.log('[Webhook] Skipping echo/outbound message (is_echo:', message.is_echo, ', sender:', senderIgsid, ')');
    return;
  }

  // Deduplication: Instagram/Meta can redeliver the same webhook event more
  // than once. Check first (fast path), and also guard the insert itself
  // against a race between two near-simultaneous deliveries (belt & braces).
  const igMessageId = message.mid;
  if (igMessageId) {
    const existingMsg = await prisma.message.findUnique({ where: { igMessageId } });
    if (existingMsg) {
      console.log('[Webhook] Duplicate message, skipping:', igMessageId);
      return;
    }
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
      try {
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
      } catch (err) {
        // P2002 = unique constraint violation on (instagramAccountId, igsid) —
        // a concurrent webhook delivery for the same contact already created
        // it between our findUnique() above and this create(). Re-fetch
        // instead of failing the whole event.
        if (err.code === 'P2002') {
          contact = await prisma.contact.findUnique({
            where: { instagramAccountId_igsid: { instagramAccountId: account.id, igsid: senderIgsid } },
          });
        } else {
          throw err;
        }
      }
    }
  }

  // Step 2: Find or create the conversation. Category/priority are left at
  // their defaults ("other"/"normal") here — the async AI job fills them in
  // moments later so the webhook never waits on AI inference.
  let conversation = await prisma.conversation.findUnique({
    where: {
      instagramAccountId_contactId: {
        instagramAccountId: account.id,
        contactId: contact.id,
      },
    },
  });

  const messageText = message.text || null;
  const messageType = message.attachments?.[0]?.type || 'text';
  const attachmentUrl = message.attachments?.[0]?.payload?.url || null;
  // Timestamp from Meta is often in milliseconds. If it's less than 1e11, it's seconds.
  const parsedTimestamp = typeof timestamp === 'number' ? (timestamp > 1e11 ? timestamp : timestamp * 1000) : parseInt(timestamp, 10);
  const igTimestamp = timestamp ? new Date(parsedTimestamp) : new Date();
  const lastMessagePreview = messageText || `[${messageType}]`;

  if (conversation) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: lastMessagePreview,
        lastMessageAt: igTimestamp,
        unread: true,
      },
    });
  } else {
    try {
      conversation = await prisma.conversation.create({
        data: {
          instagramAccountId: account.id,
          contactId: contact.id,
          lastMessage: lastMessagePreview,
          lastMessageAt: igTimestamp,
        },
      });
    } catch (err) {
      // P2002 = a concurrent webhook delivery for the same contact already
      // created this conversation between our findUnique() and this create().
      if (err.code === 'P2002') {
        conversation = await prisma.conversation.update({
          where: { instagramAccountId_contactId: { instagramAccountId: account.id, contactId: contact.id } },
          data: { lastMessage: lastMessagePreview, lastMessageAt: igTimestamp, unread: true },
        });
      } else {
        throw err;
      }
    }
  }

  // Step 3: Save the message. aiStatus defaults to "pending" — the
  // background job fills in category/priority after this transaction.
  let savedMessage;
  try {
    savedMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        igMessageId: igMessageId || null,
        direction: 'inbound',
        content: messageText,
        messageType: messageType,
        attachmentUrl: attachmentUrl,
        igTimestamp: igTimestamp,
      },
    });
  } catch (err) {
    // P2002 = unique constraint violation on igMessageId — another
    // concurrent delivery of the same event already inserted it.
    if (err.code === 'P2002') {
      console.log('[Webhook] Duplicate message caught at insert time, skipping:', igMessageId);
      return;
    }
    throw err;
  }

  await prisma.usageEvent.create({
    data: { userId: account.userId, type: 'messages_received', quantity: 1, metadata: JSON.stringify({ conversationId: conversation.id }) },
  }).catch(() => {});

  console.log('[Webhook] Message saved:', savedMessage.id);

  // Step 4: Push the raw message to the frontend via Socket.io immediately —
  // the creator should see new DMs the instant they arrive, without waiting
  // for AI classification.
  emitToUser(account.userId, 'new_message', {
    conversationId: conversation.id,
    accountId: account.id,
    message: {
      id: savedMessage.id,
      direction: 'inbound',
      content: savedMessage.content,
      messageType: savedMessage.messageType,
      attachmentUrl: savedMessage.attachmentUrl,
      igTimestamp: savedMessage.igTimestamp,
      createdAt: savedMessage.createdAt,
      aiStatus: savedMessage.aiStatus,
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
      category: conversation.category,
      priority: conversation.priority,
      unread: conversation.unread,
    },
  });

  // Step 5: Queue AI analysis to run in the background. This never blocks
  // the webhook and is safe to call even if it later fails — the message is
  // already persisted and visible regardless of AI outcome.
  await enqueueMessageAnalysis(savedMessage.id);
}

module.exports = router;
module.exports.setSocketIO = setSocketIO;
