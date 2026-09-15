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
const entitlementService = require('../services/entitlementService');
const { isBillingEnabled } = require('../lib/billingFlags');
const { handleMetaError } = require('../lib/tokenHealth');
const aiService = require('../services/aiService');
const { getOrCreatePreferences } = require('../services/preferencesService');
const { getOrCreateBusinessProfile } = require('../services/businessProfileService');
const { upsertBrandDeal } = require('../services/brandDealService');
const { notifyBrandDeal, notifyHighPriority, notifyImportantCustomer, emitAnalysisUpdate, emitBrandDealDetected } = require('../lib/notify');
const instagram = require('../lib/instagram');
const { decrypt } = require('../lib/crypto');
const { emitToUser } = require('../lib/socket');

const SUMMARY_MESSAGE_INTERVAL = 5; // regenerate summary every N new messages

// How long an auto-reply claim stays valid before another worker may take it.
// Long enough to cover a slow AI call plus the Instagram send; short enough
// that a crashed worker does not wedge a conversation for long.
const AUTO_REPLY_CLAIM_TTL_MS = 2 * 60 * 1000;

// A message left 'processing' for longer than this had its worker die
// mid-flight (or the in-process queue lost the job on restart).
const STALLED_ANALYSIS_MS = 15 * 60 * 1000;

// How a message blocked ONLY by the hourly classification throttle is
// retried. The throttle window is one hour, so 7 attempts at 10 minutes
// covers a full window with room to spare — after that the tenant is not
// merely bursty and re-queueing forever would just move the backlog into
// the queue. Delayed classification is acceptable; a silently dropped DM
// is not.
const THROTTLE_REQUEUE_DELAY_MS = 10 * 60 * 1000;
const MAX_THROTTLE_REQUEUES = 7;

// A message re-queued by services/skippedMessageRecovery (aiRecoveredAt set)
// may still auto-reply only if it ARRIVED within this window. Older ones are
// classified and left for the human: an automatic answer to a two-day-old DM
// is worse than silence. Measured from createdAt — when the DM reached us —
// and read from the durable column, so it also holds when the stalled-analysis
// sweeper re-queues the message without the recovery's job data.
const RECOVERED_AUTO_REPLY_WINDOW_MS = 60 * 60 * 1000;

/**
 * The reply mode actually in force for a tenant.
 *
 * FAILS CLOSED. Both gates below used `businessProfile?.autoReplyMode ||
 * 'smart'`, so a user with no BusinessProfile row — or one whose row has not
 * been saved yet — resolved to 'smart', the single mode that sends a DM on
 * their behalf. The database column defaults to 'human_only' precisely so that
 * automatic sending is opt-in, and this fallback quietly inverted that for
 * exactly the accounts least likely to have finished setup: brand-new signups
 * and reviewer test accounts. Meanwhile the dashboard, the inbox, and the
 * landing page all state that nothing is sent without approval.
 *
 * Anything that is not the literal string 'smart' means do not send. An
 * unrecognised or empty value therefore fails closed too, not just null.
 *
 * Keep in sync with prisma/schema.prisma BusinessProfile.autoReplyMode and
 * services/businessProfileService.js DEFAULT_PROFILE.
 */
const DEFAULT_REPLY_MODE = 'human_only';

function effectiveReplyMode(businessProfile) {
  const stored = businessProfile?.autoReplyMode;
  return typeof stored === 'string' && stored.trim() ? stored : DEFAULT_REPLY_MODE;
}

/**
 * Take the per-conversation auto-reply claim.
 *
 * A single conditional UPDATE ... WHERE is atomic, so exactly one racing
 * worker can transition the row from "unclaimed or stale" to "claimed". The
 * counting guards below it (consecutive replies, daily cap) are read-then-act
 * sequences spanning an await, which is precisely why they need this.
 */
async function claimAutoReply(conversationId) {
  const staleBefore = new Date(Date.now() - AUTO_REPLY_CLAIM_TTL_MS);
  const claimed = await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      OR: [{ autoReplyClaimedAt: null }, { autoReplyClaimedAt: { lt: staleBefore } }],
    },
    data: { autoReplyClaimedAt: new Date() },
  });
  return claimed.count === 1;
}

async function releaseAutoReply(conversationId) {
  await prisma.conversation
    .update({ where: { id: conversationId }, data: { autoReplyClaimedAt: null } })
    .catch(() => {});
}

/**
 * Reclaim messages stranded in 'processing'.
 *
 * processMessageAnalysis flips a message to 'processing' before calling the
 * AI provider. If the worker dies in between — a crash, a deploy, or the
 * in-process queue losing its jobs on restart — nothing ever rescans that
 * row, so the message sits unclassified forever while the inbox shows it as
 * pending analysis. Resetting it to 'pending' makes it eligible again.
 *
 * Idempotent, so it is safe to run from more than one instance.
 */
async function sweepStalledAnalyses({ olderThanMs = STALLED_ANALYSIS_MS } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.message.updateMany({
    where: { aiStatus: 'processing', createdAt: { lt: cutoff } },
    data: { aiStatus: 'pending' },
  });

  if (count > 0) {
    console.log(`[Sweeper] Reset ${count} message(s) stranded in 'processing' back to 'pending'.`);
  }
  return count;
}

async function maybeRegenerateSummary({ conversation, userId, analysis }) {
  try {
    // 1. Skip secondary AI summary calls for non-business, spam, scam, abusive, or fan messages to save tokens
    const NON_BUSINESS_CATEGORIES = ['spam', 'scam', 'abusive', 'fan'];
    if (analysis && NON_BUSINESS_CATEGORIES.includes(analysis.category)) {
      console.log(`[Summary] Skipping summary AI call for non-business category: "${analysis.category}"`);
      return;
    }

    const preferences = await getOrCreatePreferences(userId);
    if (!preferences.autoGenerateSummary) return;

    // 2. Fetch only the last 3 messages to keep summary token cost minimal
    const [existingSummary, messageCount, recentMessages, latestBrandDeal] = await Promise.all([
      prisma.conversationSummary.findUnique({ where: { conversationId: conversation.id } }),
      prisma.message.count({ where: { conversationId: conversation.id } }),
      prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: 3,
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

  // ENTITLEMENT GATE. On trial expiry, AI classification and automatic replies
  // stop; the inbox stays fully readable and nothing is deleted.
  //
  // The message is already persisted and already visible in the inbox by the
  // time this runs — the webhook writes it before enqueuing. So skipping here
  // costs the user nothing except the AI layer, which is exactly what the
  // trial was for. It is marked 'skipped' rather than 'failed' so the stalled
  // -analysis sweeper does not keep retrying it forever, and so an operator
  // can tell "not entitled" from "the model errored".
  //
  // This is also a spend control: without it, an expired tenant's inbound DMs
  // keep costing Gemini calls indefinitely.
  //
  // Gated on BILLING_ENABLED: while billing is dark (Meta App Review), every
  // tenant classifies freely, exactly as they did before this gate returned.
  if (isBillingEnabled()) {
    const gate = await entitlementService.classificationGateReason(userId);

    if (gate === 'hourly_throttle') {
      // The ONE reason that is not a drop: the hourly window clears by
      // itself, so this is re-queued with a delay instead of skipped.
      // Every other reason is durable until a plan or cycle changes, where
      // retrying in ten minutes could not possibly help.
      //
      // The message stays 'pending' and fully visible in the inbox the
      // whole time — only the AI enrichment waits.
      const attempt = (job.data.throttleAttempt || 0) + 1;

      if (attempt <= MAX_THROTTLE_REQUEUES) {
        // Lazily required: jobs/index.js requires THIS module at load, so a
        // top-level require here would be circular and resolve to {}.
        const { enqueueMessageAnalysis } = require('./index');
        await enqueueMessageAnalysis(messageId, {
          delayMs: THROTTLE_REQUEUE_DELAY_MS,
          throttleAttempt: attempt,
        });
        console.log(
          `[messageAnalysisJob] ${messageId} hourly-throttled for user ${userId} — re-queued (attempt ${attempt}/${MAX_THROTTLE_REQUEUES}).`
        );
        return;
      }

      await prisma.message
        .update({ where: { id: message.id }, data: { aiStatus: 'skipped', aiSkipReason: 'hourly_throttle' } })
        .catch((err) => console.error(`[messageAnalysisJob] Could not mark ${messageId} skipped:`, err.message));
      console.warn(
        `[messageAnalysisJob] Skipped ${messageId}: still hourly-throttled after ${MAX_THROTTLE_REQUEUES} re-queues.`
      );
      return;
    }

    if (gate !== 'ok') {
      // The reason is recorded, not just the status: `not_entitled` is what
      // services/skippedMessageRecovery re-queues once a trial or plan starts,
      // and the inbox tells the customer why this DM went unsorted.
      await prisma.message
        .update({ where: { id: message.id }, data: { aiStatus: 'skipped', aiSkipReason: gate } })
        .catch((err) => console.error(`[messageAnalysisJob] Could not mark ${messageId} skipped:`, err.message));
      console.log(`[messageAnalysisJob] Skipped ${messageId}: ${gate} for user ${userId}.`);
      return;
    }
  }

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

    // Count the classification the moment the call returns, BEFORE the
    // writes below — the spend already happened whether or not we manage
    // to persist the result.
    //
    // The test is `billable`, not `!failed`: a provider call that returned
    // unparseable output still cost money and counts, while the textless
    // and keyword-prefilter short-circuits never touched a provider and
    // must not be charged to the tenant. Idempotent on
    // (tenantId, messageId, CLASSIFY), so the queue's own retries and the
    // Gemini->xAI->OpenAI failover all resolve to exactly one count.
    //
    // A bookkeeping failure is logged, never thrown: re-running the job
    // would re-run the AI call and spend MORE than the count we lost.
    if (isBillingEnabled() && analysis.billable) {
      await entitlementService.recordClassification(userId, message.id).catch((err) => {
        console.error(`[messageAnalysisJob] Could not record classification for ${messageId}:`, err.message);
      });
    }

    const previousPriority = conversation.priority;
    const previousCategory = conversation.category;

    // Steps 1-3 are one unit of work. Written separately, a crash between
    // them left an AIAnalysis row whose conclusions the conversation never
    // adopted, and a message stuck in 'processing' that nothing rescanned.
    //
    //   1. the append-only analysis record
    //   2. the conversation's fast-read denormalized fields
    //   3. the message's own status
    await prisma.$transaction(async (tx) => {
      await tx.aIAnalysis.create({
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

      await tx.conversation.update({
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

      await tx.message.update({
        where: { id: message.id },
        data: {
          category: analysis.category,
          aiStatus: analysis.failed ? 'failed' : 'completed',
          analyzedAt: new Date(),
        },
      });
    });

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

    // 7. Periodic conversation summary (only for relevant commercial/business inquiries).
    // TEMP (pre-Meta-review): skip summary regen when the triggering message has
    // no text content (e.g. a reel/story share) — analyzeConversation() already
    // short-circuits textless messages at zero AI cost, but summarizeConversation()
    // has no such guard and would otherwise still be called periodically.
    if (message.content) {
      await maybeRegenerateSummary({ conversation, userId, analysis });
    }

    // 8. Multi-Stage Intelligent Auto-Reply Safety Gate
    //
    // Tenant mode is the hard gate — ONLY "smart" may ever auto-send:
    //   'smart'        -> auto-send allowed, per-conversation override may opt out
    //   'suggest_only' -> drafts only, never auto-sends (the Settings UI promises
    //                     exactly this; the previous gate only checked human_only,
    //                     so suggest_only tenants were still getting live sends)
    //   'human_only'   -> never auto-sends
    //
    // The per-conversation override is three-state and can only ever SUBTRACT:
    //   null -> inherit the mode, true -> opt in, false -> opt out even under smart.
    // It cannot re-enable sending for a tenant who chose suggest_only/human_only.
    const autoReplyMode = effectiveReplyMode(businessProfile);
    const modeAllowsAutoSend = autoReplyMode === 'smart';
    const isAutoReplyActive = modeAllowsAutoSend && conversation.autoReplyEnabled !== false;

    // Reply credits are checked HERE rather than inside maybeAutoReply, so
    // an exhausted tenant never pays for the generateReply() call that
    // would otherwise run before anyone noticed there was nothing to spend.
    // Classification above already ran and is unaffected — on expiry,
    // auto-reply stops while classification keeps going.
    const hasReplyBudget = !isBillingEnabled() || (await entitlementService.canAutoReply(userId));

    if (isAutoReplyActive && message.direction === 'inbound' && !hasReplyBudget) {
      console.log(`[messageAnalysisJob] Auto-reply withheld for ${messageId}: no reply credits or not entitled.`);
    }

    // A recovered message outside the window is classified (above) but never
    // answered automatically — see RECOVERED_AUTO_REPLY_WINDOW_MS.
    const recoveredTooLate =
      Boolean(message.aiRecoveredAt) &&
      Date.now() - new Date(message.createdAt).getTime() > RECOVERED_AUTO_REPLY_WINDOW_MS;

    if (isAutoReplyActive && message.direction === 'inbound' && hasReplyBudget && recoveredTooLate) {
      console.log(
        `[messageAnalysisJob] Auto-reply withheld for ${messageId}: recovered after a skip and arrived more than an hour ago — left for the human.`
      );
    }

    if (isAutoReplyActive && message.direction === 'inbound' && hasReplyBudget && !recoveredTooLate) {
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
 * auto-reply enabled by the user or business profile, applying strict multi-stage safety checks.
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
  let holdsClaim = false;
  try {
    // Stage 1: Check Mode Setting.
    // Re-asserted here (not just at the caller's gate) so no future call site
    // can reach the send path for a tenant who opted out of automatic sending.
    const mode = effectiveReplyMode(businessProfile);
    if (mode !== 'smart') {
      console.log(`[AutoReply] Mode is '${mode}' for user ${userId} — auto-send disabled, skipping.`);
      return;
    }
    if (conversation.autoReplyEnabled === false) {
      console.log(`[AutoReply] Conversation ${conversation.id} is explicitly opted out of auto-reply, skipping.`);
      return;
    }

    // Stage 2: Risk, Scam & Inquiry Safety Checks
    if (analysis) {
      if (analysis.riskLevel === 'HIGH' || analysis.riskLevel === 'CRITICAL') {
        console.log(`[AutoReply] Blocked auto-reply: Risk level is ${analysis.riskLevel}.`);
        return;
      }
      if (analysis.scamProbability >= 25) {
        console.log(`[AutoReply] Blocked auto-reply: Scam probability is ${analysis.scamProbability}%.`);
        return;
      }
      if (['spam', 'scam', 'abusive'].includes(analysis.category)) {
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

      // Normal business inquiry categories eligible for auto-reply
      const normalInquiryCategories = [
        'pricing_inquiry',
        'product_inquiry',
        'service_inquiry',
        'availability_inquiry',
        'delivery_inquiry',
        'hot_lead',
        'lead',
        'customer',
        'general_question',
        'support_request',
        'other',
      ];

      if (!normalInquiryCategories.includes(analysis.category) && !analysis.shouldAutoReply) {
        console.log(`[AutoReply] Category "${analysis.category}" not eligible for auto-reply.`);
        return;
      }
    }

    // Stage 2.5: Take the send claim BEFORE counting anything.
    //
    // Everything from here to the Instagram send is a read-then-act sequence
    // spanning an await on the AI provider. Two jobs for the same
    // conversation would otherwise both read the pre-send counts, both pass
    // the consecutive/daily guards, and both send — a duplicate DM to a real
    // customer and a breached cap. Released in the finally below.
    if (!(await claimAutoReply(conversation.id))) {
      console.log(
        `[AutoReply] Conversation ${conversation.id} is already being handled by another worker, skipping.`
      );
      return;
    }
    holdsClaim = true;

    // Stage 3: Fetch recent messages in conversation
    const recentMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    const lastInbound = recentMessages.find((m) => m.direction === 'inbound');
    if (!lastInbound) return;

    // Conversational Intelligence Guard 1: Ignore Short Acknowledgments / Conversation Closers
    const ACKNOWLEDGMENT_PATTERNS = [
      /^(ok|okay|k|kk|thx|thanks|thank you|ty|tysm|got it|sure|alright|cool|great|perfect|done|noted|will check|will let you know|sounds good|see you|bye|goodbye|tc)$/i,
    ];
    const trimmedInbound = (lastInbound.content || '').trim().toLowerCase();
    const isAcknowledgment = ACKNOWLEDGMENT_PATTERNS.some((p) => p.test(trimmedInbound));
    if (isAcknowledgment) {
      console.log(`[AutoReply] Message ${lastInbound.id} is a brief acknowledgment/closing, skipping auto-reply to avoid loop.`);
      return;
    }

    // Conversational Intelligence Guard 2: Consecutive Auto-Reply Limit (Max 2 in a row)
    let consecutiveAutoReplies = 0;
    for (const msg of recentMessages) {
      if (msg.direction === 'outbound') {
        if (msg.aiStatus === 'auto_replied') {
          consecutiveAutoReplies++;
        } else {
          // A manual human reply was sent, resetting the consecutive counter
          break;
        }
      }
    }

    const MAX_CONSECUTIVE_AUTO_REPLIES = 2;
    if (consecutiveAutoReplies >= MAX_CONSECUTIVE_AUTO_REPLIES) {
      console.log(`[AutoReply] Max consecutive auto-replies (${MAX_CONSECUTIVE_AUTO_REPLIES}) reached for conversation ${conversation.id}. Handing off to human.`);
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          needsHuman: true,
          needsAttention: true,
          aiExplanation: `Auto-reply session limit reached (${MAX_CONSECUTIVE_AUTO_REPLIES} replies sent). Handed off for personal human follow-up.`,
        },
      });
      return;
    }

    // Conversational Intelligence Guard 3: Daily Auto-Reply Cap (Max 3 per 24 hours per chat)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dailyAutoReplyCount = await prisma.message.count({
      where: {
        conversationId: conversation.id,
        direction: 'outbound',
        aiStatus: 'auto_replied',
        createdAt: { gte: oneDayAgo },
      },
    });

    const MAX_DAILY_AUTO_REPLIES = 3;
    if (dailyAutoReplyCount >= MAX_DAILY_AUTO_REPLIES) {
      console.log(`[AutoReply] Daily auto-reply cap (${MAX_DAILY_AUTO_REPLIES}/day) reached for conversation ${conversation.id}. Handing off to human.`);
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          needsHuman: true,
          needsAttention: true,
          aiExplanation: `Daily auto-reply limit reached (${MAX_DAILY_AUTO_REPLIES}/24h). Handed off for personal human follow-up.`,
        },
      });
      return;
    }

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
    console.log(`[AutoReply] Sending AI auto-reply to contact ${contact.igsid} (${replyText.length} chars)`);

    // Stage 6: Send via Instagram Graph API
    const accessToken = decrypt(instagramAccount.accessToken);
    let igResponse = null;
    try {
      igResponse = await instagram.sendMessage(contact.igsid, replyText, accessToken);
    } catch (apiErr) {
      console.error(`[AutoReply] Instagram sendMessage failed:`, apiErr.response?.data?.error?.message || apiErr.message);
      // If the token is dead, flag the account and email the owner ONCE, then
      // stop. Without this the queue retried against a token that would never
      // work again — burning quota indefinitely while the dashboard reported
      // the account as healthy.
      await handleMetaError(apiErr, instagramAccount.id).catch(() => {});
      return;
    }

    // Stage 6.5: Debit the reply credit — ONLY here.
    //
    // This is the first line reached after the DM has actually left for
    // Instagram, and that is the only moment the customer received what
    // they are paying for. Every earlier exit (mode gate, risk checks,
    // acknowledgment guard, 24-hour window, generation failure, send
    // failure) returns above this point and costs nothing.
    //
    // Spending AFTER the send means a send that succeeds can never fail to
    // be charged for a reason the customer would notice; the opposite order
    // would let a debited credit vanish with an undelivered reply. If the
    // balance raced to zero between canAutoReply() and here, the DM is
    // already gone — log it and let it go rather than un-sending.
    if (isBillingEnabled()) {
      const spend = await entitlementService.spendReplyCredit(userId);
      if (!spend.ok) {
        console.warn(
          `[AutoReply] Sent a reply on conversation ${conversation.id} but could not debit a credit — balance raced to empty.`
        );
      }
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
  } finally {
    // Release promptly so a follow-up message is not made to wait out the
    // claim TTL. If this never runs (process killed), the TTL covers it.
    if (holdsClaim) await releaseAutoReply(conversation.id);
  }
}

module.exports = {
  processMessageAnalysis,
  maybeAutoReply,
  sweepStalledAnalyses,
  // Exported so the fail-closed behaviour can be asserted directly, without
  // standing up a whole analysis run.
  effectiveReplyMode,
  DEFAULT_REPLY_MODE,
};
