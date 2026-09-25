/**
 * Meta (Instagram) webhook processing — everything that happens AFTER a
 * delivery is safely stored (services/webhookDeliveries.js).
 *
 * Moved out of routes/webhook.js so the same code runs from three places: the
 * webhook queue worker, the inline fallback when the queue is unavailable,
 * and the recovery sweep. It is idempotent per message: Message.igMessageId
 * is unique, so re-processing a delivery never duplicates a DM.
 *
 * Tenant routing: entry.id is the receiving IG account; the event is
 * attributed only to the CONNECTED account with that igUserId (at most one,
 * enforced by ig_one_active_link), and every write and emit below is scoped
 * to that account's owner.
 */

const prisma = require('../lib/prisma');
const instagram = require('../lib/instagram');
const { decrypt } = require('../lib/crypto');
const { emitToUser } = require('../lib/socket');

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
  // igUserId is no longer globally unique: disconnected rows persist as
  // history. Prefer the ACTIVE link (at most one exists, enforced by
  // ig_one_active_link); fall back to any row so that a delivery for a
  // disconnected account is still distinguishable from one for an account we
  // have never seen.
  const account =
    (await prisma.instagramAccount.findFirst({
      where: { igUserId, connectionStatus: 'CONNECTED' },
      include: { user: true },
    })) ||
    (await prisma.instagramAccount.findFirst({
      where: { igUserId },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    }));

  if (!account) {
    console.warn('[Webhook] No account found for IG User ID:', igUserId);

    // Record unmapped webhook event — metadata only. This row has no
    // instagramAccountId (there is no account to attach it to), so unlike
    // every other WebhookLog row it can never be reached by a deletion
    // cascade — the 30-day age-based purge is the only thing that ever
    // clears it. There's no linked customer who could act on this content
    // anyway, so it is never stored in the first place rather than stored
    // and left to age out.
    await prisma.webhookLog.create({
      data: {
        igUserId,
        eventType: 'unmapped',
        status: 'SKIPPED',
        payload: null,
        errorMessage: `No connected account found for IG User ID ${igUserId}`,
      }
    }).catch(() => {});

    return;
  }

  // Check if the account has been disconnected by the user
  if (account.connectionStatus === 'DISCONNECTED') {
    console.warn(`[Webhook] Account ${igUserId} is disconnected. Skipping event.`);

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

  console.log('[Webhook] Processing event for account:', account.igUserId);

  // Process messaging events
  try {
    for (const messagingEvent of entry.messaging || []) {
      if (messagingEvent.message) {
        await handleIncomingMessage(account, messagingEvent);
      } else if (messagingEvent.read) {
        console.log('[Webhook] Read receipt for account:', account.id);
      } else if (messagingEvent.reaction) {
        console.log('[Webhook] Reaction for account:', account.id);
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

    // Re-throw: the delivery must stay UNPROCESSED so the queue retry or the
    // recovery sweep runs it again. Messages already saved are skipped on the
    // retry by the igMessageId dedupe below.
    throw error;
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
    console.log('[Webhook] Skipping echo/outbound message for account:', account.id);
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

  console.log('[Webhook] Incoming message for account:', account.id);

  // Step 1: Find or create the contact, fetching their profile if needed
  let contact = await prisma.contact.findUnique({
    where: {
      instagramAccountId_igsid: {
        instagramAccountId: account.id,
        igsid: senderIgsid,
      },
    },
  });

  // Fetch the profile when the contact is new, when we last looked more than a
  // day ago, or when the stored photo URL is about to stop working.
  //
  // That last case is the one that matters for broken avatars. Instagram
  // profile picture URLs are SIGNED and carry an `oe=` expiry roughly four
  // days out; after it the CDN returns 403. The plain 24-hour staleness rule
  // below refreshes often enough for someone who keeps messaging, but it is
  // keyed on when we last *fetched*, not on when the URL *dies* — so a URL
  // fetched 23 hours before its own expiry was considered fresh and went stale
  // an hour later. Checking the expiry directly costs nothing (it is parsed
  // out of the URL we already hold, no network call) and refreshes the photo
  // on the last DM before it would have broken.
  const profilePicExpiring = instagram.isProfilePicExpiring(contact?.profilePicUrl);
  const shouldFetchProfile = !contact ||
    !contact.lastFetchedAt ||
    (Date.now() - contact.lastFetchedAt.getTime() > 24 * 60 * 60 * 1000) ||
    profilePicExpiring;

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
  // TEMP (pre-Meta-review): observability only — confirms the real Meta `type`
  // value for reel/story shares from production logs (unverified in any test
  // fixture as of Gate 0 §0.4). Remove once that value is confirmed.
  if (messageType !== 'text') {
    console.log('[Webhook] Non-text message type observed:', messageType);
  }
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
  // Lazily required: jobs/index.js registers the processor that calls this file.
  await require('../jobs').enqueueMessageAnalysis(savedMessage.id);
}


module.exports = { processEntry, handleIncomingMessage };
