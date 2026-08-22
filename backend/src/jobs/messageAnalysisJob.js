/**
 * message.analysis job — runs OFF the webhook's request/response cycle.
 *
 * Pipeline:
 *   load message + conversation + contact + recent history
 *     -> AI analysis (classification, priority signal, brand deal extraction)
 *     -> persist AIAnalysis (append-only)
 *     -> update Conversation's denormalized category/priority/needsAttention
 *     -> upsert BrandDeal if a collaboration was detected
 *     -> maybe regenerate the ConversationSummary (periodic, not every message)
 *     -> record usage events
 *     -> notify the creator for genuinely important events only
 *     -> push a live `analysis_completed` update over Socket.io
 *
 * Idempotent: if the message was already analyzed (aiStatus === 'completed'),
 * this is a no-op. On failure, the message stays visible in the inbox with
 * aiStatus 'failed' and the job queue retries with backoff — AI problems
 * never hide or block a message from appearing.
 */

const prisma = require('../lib/prisma');
const aiService = require('../services/aiService');
const { getOrCreatePreferences } = require('../services/preferencesService');
const { getOrCreateBusinessProfile } = require('../services/businessProfileService');
const { upsertBrandDeal } = require('../services/brandDealService');
const { notifyBrandDeal, notifyHighPriority, notifyImportantCustomer, emitAnalysisUpdate, emitBrandDealDetected } = require('../lib/notify');
const instagram = require('../lib/instagram');
const { decrypt } = require('../lib/crypto');
const { emitToUser } = require('../lib/socket');

const SUMMARY_MESSAGE_INTERVAL = 5; // regenerate summary every N new messages

async function recordUsage(userId, type, quantity = 1, metadata = null) {
  try {
    await prisma.usageEvent.create({
      data: { userId, type, quantity, metadata: metadata ? JSON.stringify(metadata) : null },
    });
  } catch (err) {
    console.error('[UsageEvent] Failed to record usage:', err.message);
  }
}

async function maybeRegenerateSummary({ conversation, userId }) {
  try {
    const preferences = await getOrCreatePreferences(userId);
    if (!preferences.autoGenerateSummary) return;

    const [existingSummary, messageCount, recentMessages, latestBrandDeal] = await Promise.all([
      prisma.conversationSummary.findUnique({ where: { conversationId: conversation.id } }),
      prisma.message.count({ where: { conversationId: conversation.id } }),
      prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      prisma.brandDeal.findFirst({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' } }),
    ]);

    const messagesSinceLastSummary = messageCount - (existingSummary?.messageCountAtSummary || 0);
    const shouldRegenerate =
      !existingSummary ||
      messagesSinceLastSummary >= SUMMARY_MESSAGE_INTERVAL ||
      (latestBrandDeal && existingSummary.updatedAt < latestBrandDeal.updatedAt);

    if (!shouldRegenerate) return;

    const result = await aiService.summarizeConversation({
      recentMessages: recentMessages.reverse(),
      previousSummary: existingSummary?.summary || null,
      brandDeal: latestBrandDeal,
    });

    if (!result.summary) return;

    await prisma.conversationSummary.upsert({
      where: { conversationId: conversation.id },
      create: {
        conversationId: conversation.id,
        summary: result.summary,
        stage: result.stage,
        messageCountAtSummary: messageCount,
      },
      update: {
        summary: result.summary,
        stage: result.stage,
        messageCountAtSummary: messageCount,
      },
    });
  } catch (err) {
    // Summaries are a nice-to-have enrichment — never let a failure here
    // affect classification/priority which already succeeded.
    console.error('[messageAnalysisJob] Summary regeneration failed:', err.message);
  }
}

async function processMessageAnalysis(job) {
  const { messageId } = job.data;

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      conversation: {
        include: { contact: true, instagramAccount: true },
      },
    },
  });

  if (!message) {
    console.warn(`[messageAnalysisJob] Message ${messageId} no longer exists, skipping.`);
    return;
  }

  // Idempotency guard — a retried/duplicated job should not re-run analysis.
  if (message.aiStatus === 'completed') {
    return;
  }

  const { conversation } = message;
  const userId = conversation.instagramAccount.userId;

  await prisma.message.update({ where: { id: message.id }, data: { aiStatus: 'processing' } }).catch(() => {});

  try {
    const preferences = await getOrCreatePreferences(userId);
    const businessProfile = await getOrCreateBusinessProfile(userId);

    const recentMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const analysis = await aiService.analyzeConversation({
      messageText: message.content,
      contactUsername: conversation.contact.username,
      recentMessages: recentMessages.reverse(),
      businessProfile,
      preferences,
    });

    const previousPriority = conversation.priority;
    const previousCategory = conversation.category;

    // 1. Persist the append-only analysis record with generalized fields.
    await prisma.aIAnalysis.create({
      data: {
        conversationId: conversation.id,
        triggerMessageId: message.id,
        category: analysis.category,
        intent: analysis.intent,
        customerType: analysis.customerType,
        leadQuality: analysis.leadQuality,
        purchaseIntent: analysis.purchaseIntent,
        riskLevel: analysis.riskLevel,
        scamProbability: analysis.scamProbability,
        shouldAutoReply: analysis.shouldAutoReply,
        recommendedAction: analysis.recommendedAction,
        priority: analysis.priority,
        priorityScore: analysis.priorityScore,
        confidence: analysis.confidence,
        needsAttention: analysis.needsCreatorAttention,
        summary: analysis.summary,
        reason: analysis.reason,
        model: analysis.model,
        rawResponse: analysis.rawResponse ? JSON.stringify(analysis.rawResponse) : null,
        status: analysis.failed ? 'failed' : 'completed',
        errorMessage: analysis.errorMessage || null,
      },
    });

    // 2. Update the conversation's fast-read denormalized fields.
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        category: analysis.category,
        intent: analysis.intent,
        customerType: analysis.customerType,
        leadQuality: analysis.leadQuality,
        purchaseIntent: analysis.purchaseIntent,
        riskLevel: analysis.riskLevel,
        scamProbability: analysis.scamProbability,
        aiExplanation: analysis.reason,
        recommendedAction: analysis.recommendedAction,
        needsHuman: analysis.needsCreatorAttention,
        priority: analysis.priority,
        priorityScore: analysis.priorityScore,
        needsAttention: analysis.needsCreatorAttention,
      },
    });

    // 3. Update the message itself (legacy convenience fields + AI status).
    await prisma.message.update({
      where: { id: message.id },
      data: {
        category: analysis.category,
        aiStatus: analysis.failed ? 'failed' : 'completed',
        analyzedAt: new Date(),
      },
    });

    await recordUsage(userId, 'messages_analyzed', 1, { conversationId: conversation.id, category: analysis.category });

    // 4. Brand deal extraction + upsert (if relevant to profile/message).
    let brandDealResult = null;
    if (analysis.brandDeal) {
      brandDealResult = await upsertBrandDeal({
        conversationId: conversation.id,
        instagramAccountId: conversation.instagramAccountId,
        userId,
        extracted: analysis.brandDeal,
      });

      if (brandDealResult.isNew) {
        await recordUsage(userId, 'brand_deals_detected', 1, { conversationId: conversation.id });
        emitBrandDealDetected(userId, { conversationId: conversation.id, brandDeal: brandDealResult.brandDeal });
        await notifyBrandDeal(userId, {
          conversationId: conversation.id,
          brandDealId: brandDealResult.brandDeal.id,
          brandName: brandDealResult.brandDeal.brandName,
          contactUsername: conversation.contact.username,
        });
      }
    }

    // 5. Notify on meaningful state transitions only.
    if (analysis.priority === 'critical' && previousPriority !== 'critical') {
      await notifyHighPriority(userId, {
        conversationId: conversation.id,
        contactUsername: conversation.contact.username,
        reason: analysis.reason,
      });
    } else if (analysis.category === 'customer' && analysis.needsCreatorAttention && previousCategory !== 'customer') {
      await notifyImportantCustomer(userId, {
        conversationId: conversation.id,
        contactUsername: conversation.contact.username,
        reason: analysis.reason,
      });
    }

    // 6. Live inbox update (always, lightweight, not persisted as a notification).
    emitAnalysisUpdate(userId, {
      conversationId: conversation.id,
      category: analysis.category,
      intent: analysis.intent,
      customerType: analysis.customerType,
      leadQuality: analysis.leadQuality,
      purchaseIntent: analysis.purchaseIntent,
      riskLevel: analysis.riskLevel,
      scamProbability: analysis.scamProbability,
      aiExplanation: analysis.reason,
      recommendedAction: analysis.recommendedAction,
      needsHuman: analysis.needsCreatorAttention,
      priority: analysis.priority,
      priorityScore: analysis.priorityScore,
      needsAttention: analysis.needsCreatorAttention,
      summary: analysis.summary,
      aiFailed: analysis.failed,
    });

    // 7. Periodic conversation summary.
    await maybeRegenerateSummary({ conversation, userId });

    // 8. Multi-Stage Intelligent Auto-Reply Safety Gate
    if (conversation.autoReplyEnabled && message.direction === 'inbound') {
      await maybeAutoReply({
        conversation,
        contact: conversation.contact,
        instagramAccount: conversation.instagramAccount,
        userId,
        businessProfile,
        preferences,
        brandDeal: brandDealResult?.brandDeal || null,
        analysis,
      });
    }
  } catch (err) {
    await prisma.message
      .update({
        where: { id: message.id },
        data: { aiStatus: 'failed', attempts: { increment: 1 } },
      })
      .catch(() => {});
    throw err; // let the queue's retry/backoff handle it
  }
}

/**
 * Executes an automated AI reply for a specific conversation that has
 * auto-reply enabled by the user, applying strict multi-stage safety checks.
 */
async function maybeAutoReply({
  conversation,
  contact,
  instagramAccount,
  userId,
  businessProfile,
  preferences,
  brandDeal,
  analysis,
}) {
  try {
    // Stage 1: Check Mode Setting
    if (businessProfile?.autoReplyMode === 'human_only') {
      console.log(`[AutoReply] Mode is 'human_only' for user ${userId}, skipping auto-reply.`);
      return;
    }

    // Stage 2: Risk & Scam Safety Check
    if (analysis) {
      if (analysis.riskLevel === 'HIGH' || analysis.riskLevel === 'CRITICAL') {
        console.log(`[AutoReply] Blocked auto-reply: Risk level is ${analysis.riskLevel}.`);
        return;
      }
      if (analysis.scamProbability >= 30) {
        console.log(`[AutoReply] Blocked auto-reply: Scam probability is ${analysis.scamProbability}%.`);
        return;
      }
      if (analysis.category === 'spam' || analysis.category === 'scam' || analysis.category === 'abusive') {
        console.log(`[AutoReply] Blocked auto-reply: Category is ${analysis.category}.`);
        return;
      }
      if (analysis.category === 'fan') {
        console.log(`[AutoReply] Casual fan/social message — skipping auto-reply.`);
        return;
      }
      if (analysis.shouldAutoReply === false) {
        console.log(`[AutoReply] AI safety classifier determined shouldAutoReply=false for conversation ${conversation.id}.`);
        return;
      }
    }

    // Stage 3: Fetch recent messages in conversation
    const recentMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const lastInbound = recentMessages.find((m) => m.direction === 'inbound');
    if (!lastInbound) return;

    // Stage 4: Check 24-hour Meta messaging window
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - new Date(lastInbound.createdAt).getTime();
    if (elapsed > TWENTY_FOUR_HOURS) {
      console.log(`[AutoReply] 24-hour window expired for conversation ${conversation.id}, skipping auto-reply.`);
      return;
    }

    // Stage 5: Generate AI reply with Business Profile facts
    const replyResult = await aiService.generateReply({
      recentMessages: recentMessages.reverse(),
      contactUsername: contact.username,
      businessProfile,
      preferences,
      instructions: conversation.autoReplyPrompt || null,
      category: conversation.category || 'other',
      brandDeal,
      analysis,
    });

    if (replyResult.failed || !replyResult.text || !replyResult.text.trim()) {
      console.warn(`[AutoReply] AI reply generation failed for conversation ${conversation.id}`);
      return;
    }

    const replyText = replyResult.text.trim();
    console.log(`[AutoReply] Sending AI auto-reply to @${contact.username || contact.igsid}: "${replyText}"`);

    // Stage 6: Send via Instagram Graph API
    const accessToken = decrypt(instagramAccount.accessToken);
    let igResponse = null;
    try {
      igResponse = await instagram.sendMessage(contact.igsid, replyText, accessToken);
    } catch (apiErr) {
      console.error(`[AutoReply] Instagram sendMessage failed:`, apiErr.response?.data?.error?.message || apiErr.message);
      return;
    }

    // Stage 7: Save outbound message to DB
    const savedMsg = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        igMessageId: igResponse?.message_id || null,
        direction: 'outbound',
        content: replyText,
        messageType: 'text',
        aiStatus: 'auto_replied',
        igTimestamp: new Date(),
      },
    });

    // Stage 8: Update conversation state
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: replyText,
        lastMessageAt: new Date(),
        unread: false,
        needsAttention: false,
      },
    });

    // Stage 9: Record reply generation audit trail
    await prisma.replyGeneration.create({
      data: {
        conversationId: conversation.id,
        userId,
        contextRef: `auto_reply;category:${conversation.category || 'other'};intent:${analysis?.intent || 'general'}`,
        instructions: conversation.autoReplyPrompt || null,
        generatedText: replyText,
        model: replyResult.model,
        wasSent: true,
      },
    }).catch(() => {});

    await recordUsage(userId, 'auto_replies_sent', 1, { conversationId: conversation.id });

    // Stage 10: Emit real-time Socket.io event to the user's frontend
    emitToUser(userId, 'new_message', {
      conversationId: conversation.id,
      accountId: instagramAccount.id,
      message: {
        id: savedMsg.id,
        direction: 'outbound',
        content: savedMsg.content,
        messageType: savedMsg.messageType,
        igTimestamp: savedMsg.igTimestamp,
        createdAt: savedMsg.createdAt,
        aiStatus: 'auto_replied',
      },
      contact: {
        id: contact.id,
        username: contact.username,
        name: contact.name,
        profilePicUrl: contact.profilePicUrl,
      },
      conversation: {
        id: conversation.id,
        lastMessage: replyText,
        lastMessageAt: new Date(),
        category: conversation.category,
        intent: conversation.intent,
        customerType: conversation.customerType,
        leadQuality: conversation.leadQuality,
        purchaseIntent: conversation.purchaseIntent,
        riskLevel: conversation.riskLevel,
        scamProbability: conversation.scamProbability,
        priority: conversation.priority,
        unread: false,
        autoReplyEnabled: true,
      },
    });

    console.log(`[AutoReply] Auto-reply successfully sent and saved: ${savedMsg.id}`);
  } catch (err) {
    console.error(`[AutoReply] Error during auto-reply execution:`, err.message);
  }
}

module.exports = { processMessageAnalysis, maybeAutoReply };
