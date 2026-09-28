/**
 * Taps and replies that belong to an Auto DM run.
 *
 * Two ways in, one handler:
 *   1. POSTBACK — the opener / follow prompt is a button template with one
 *      postback button; the tap arrives as entry.messaging[].postback with
 *      payload AUTODM:<runId>:GET | AUTODM:<runId>:FOLLOWED. No Message row
 *      exists for a postback (the DM pipeline never stored them).
 *   2. MESSAGE (the seam in metaWebhookProcessor.handleIncomingMessage, after
 *      the DM is stored and emitted, before classification is enqueued):
 *        - a quick_reply payload AUTODM:<runId>:… (kept for robustness), or
 *        - text exactly equal to the automation's fallback keyword (default
 *          LINK — quick replies and buttons do not show on desktop), from a
 *          sender with an OPENER_SENT / AWAITING_FOLLOW run on this account.
 *      When it is ours, the run is claimed AND the message is marked
 *      aiStatus 'autodm' in ONE transaction, so classification and auto-reply
 *      skip exactly that message; the requeue sweep ignores 'autodm'.
 *   3. CONVERSATION WINDOW (same seam): any other inbound DM from a sender
 *      who has an Auto DM run on this account with activity (updated_at) in
 *      the last 24 hours, in any status except the pre-send ones (QUEUED,
 *      SENDING, WAITING_QUOTA), while the owner has access. Stored and shown
 *      as today, marked aiStatus 'autodm': no classification, no auto-reply,
 *      no AI credits. 24 hours after the run's last activity the person's
 *      next DM is sorted normally. The DM itself never extends the window.
 *
 * SECURITY. A tap counts only when the run belongs to the Instagram account
 * the webhook entry is for (entry.id → account) AND sender.id equals the
 * run's igsid (the recipient Meta returned for the private reply). Anything
 * else — a malformed payload, another tenant's run id, a different sender —
 * returns false: a message then goes to normal sorting, and a postback keeps
 * today's behaviour (ignored).
 *
 * FAIL-SAFE. Every error is logged and swallowed, and the answer is false.
 * With the kill switch off the answer is false before any database query.
 */

const prisma = require('../../lib/prisma');
const config = require('./config');
const log = require('./log');
const { isId, normalizeText } = require('./util');
const { hasAutoDmAccess, getRolloutMode } = require('./access');
const { emitToUser } = require('../../lib/socket');

/** The account owner's access, loading the owner when the caller did not. */
async function ownerHasAccess(account) {
  const owner =
    account.user && account.user.id
      ? account.user
      : await prisma.user.findUnique({ where: { id: account.userId }, select: { id: true, email: true } });
  return hasAutoDmAccess(owner);
}

const PAYLOAD_RE = /^AUTODM:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(GET|FOLLOWED)$/;
const KEYWORD_MAX = 20;

// Which run statuses a tap may move forward.
const CLAIMABLE = {
  GET: ['OPENER_SENT', 'AWAITING_FOLLOW', 'OPENER_UNCONFIRMED'],
  FOLLOWED: ['AWAITING_FOLLOW'],
};

// Statuses the reply keyword (LINK) can act on.
const KEYWORD_STATUSES = ['OPENER_SENT', 'AWAITING_FOLLOW', 'OPENER_UNCONFIRMED'];

// Conversation window: DMs from someone with recent Auto DM activity are not
// sorted. Pre-send runs have not DMed anyone yet, so they never open it.
const CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const PRE_SEND_STATUSES = ['QUEUED', 'SENDING', 'WAITING_QUOTA'];

function isAutoDmPayload(payload) {
  return typeof payload === 'string' && payload.startsWith('AUTODM:');
}

/** A messaging event carrying an AUTODM: postback (pure function, no I/O). */
function isAutoDmPostback(event) {
  return Boolean(event && event.postback && isAutoDmPayload(event.postback.payload));
}

function senderOf(account, event) {
  const raw = event && event.sender ? event.sender.id : null;
  if (!isId(raw)) return null;
  const sender = String(raw);
  return sender === String(account.igUserId) ? null : sender; // our own echo
}

/**
 * Claim the run for `action`. Marks `messageId` aiStatus 'autodm' in the same
 * transaction. A verified tap on a run that is busy or already finished still
 * counts as ours (true) but changes nothing — a double tap never re-sends.
 */
async function claim({ account, runId, sender, action, messageId, bindSender = false }) {
  const claimed = await prisma.$transaction(async (tx) => {
    const res = await tx.autoDmRun.updateMany({
      where: bindSender
        ? // OPENER_UNCONFIRMED: the tap proves the opener arrived, and to whom.
          { id: runId, instagramAccountId: account.id, userId: account.userId, status: 'OPENER_UNCONFIRMED', pendingAction: null }
        : {
            id: runId,
            instagramAccountId: account.id,
            userId: account.userId,
            igsid: sender,
            status: { in: CLAIMABLE[action] },
            pendingAction: null,
          },
      data: {
        pendingAction: action,
        nextAttemptAt: new Date(),
        attempts: 0,
        claimedAt: null,
        lastError: null,
        ...(bindSender ? { igsid: sender, status: 'OPENER_SENT', openerSentAt: new Date() } : {}),
      },
    });
    if (messageId) {
      await tx.message.update({ where: { id: messageId }, data: { aiStatus: 'autodm' } });
    }
    return res.count === 1;
  });
  log.info(claimed ? `run ${runId}: ${action} tap accepted` : `run ${runId}: ${action} tap had nothing to do`);
  return true;
}

/** Payload tap (postback or quick reply). */
async function handlePayloadTap(account, sender, payload, messageId) {
  const match = PAYLOAD_RE.exec(payload);
  if (!match) {
    log.warn(`malformed AUTODM payload ignored (account ${account.id})`);
    return false;
  }
  const [, runId, action] = match;

  // Ownership: this account, this tenant, this sender. One query decides all
  // three, so a foreign run id and a wrong sender look identical (no oracle).
  // Exception: an OPENER_UNCONFIRMED run never learned its recipient's id
  // (Meta's answer was lost), so a GET tap carrying its unguessable run id —
  // which only the opener's recipient ever saw — binds the tapper to it.
  const run = await prisma.autoDmRun.findFirst({
    where: {
      id: runId,
      instagramAccountId: account.id,
      userId: account.userId,
      OR: [{ igsid: sender }, ...(action === 'GET' ? [{ status: 'OPENER_UNCONFIRMED' }] : [])],
    },
    select: { id: true, status: true },
  });
  if (!run) {
    log.warn(`tap for run ${runId} rejected: not this account's run or not its recipient (account ${account.id})`);
    return false;
  }
  return claim({ account, runId, sender, action, messageId, bindSender: run.status === 'OPENER_UNCONFIRMED' });
}

/** Text reply equal to the fallback keyword. */
async function handleKeyword(account, sender, text, messageId) {
  const runs = await prisma.autoDmRun.findMany({
    where: {
      instagramAccountId: account.id,
      userId: account.userId,
      igsid: sender,
      status: { in: KEYWORD_STATUSES },
    },
    select: { id: true, status: true, automation: { select: { fallbackKeyword: true } } },
    orderBy: { openerSentAt: 'desc' },
    take: 10,
  });
  const wanted = normalizeText(text);
  const run = runs.find((r) => r.automation && normalizeText(r.automation.fallbackKeyword) === wanted);
  if (!run) return false;
  const action = run.status === 'AWAITING_FOLLOW' ? 'FOLLOWED' : 'GET';
  return claim({ account, runId: run.id, sender, action, messageId, bindSender: run.status === 'OPENER_UNCONFIRMED' });
}

/** Tell the inbox (best-effort) that this conversation's latest DM went to Auto DM. */
function emitHandedOff(account, savedMessage) {
  try {
    if (savedMessage.conversationId) {
      emitToUser(account.userId, 'autodm:conversation', { conversationId: savedMessage.conversationId });
    }
  } catch {
    /* live updates are best-effort */
  }
}

/**
 * The conversation-window check: a run for this sender on this account with
 * activity in the last 24 hours. One indexed query (instagram_account_id,
 * igsid); the caller checks the owner's access only when a run is found.
 */
async function hasRecentRun(account, sender, now = Date.now()) {
  const run = await prisma.autoDmRun.findFirst({
    where: {
      instagramAccountId: account.id,
      userId: account.userId,
      igsid: sender,
      status: { notIn: PRE_SEND_STATUSES },
      updatedAt: { gte: new Date(now - CONVERSATION_WINDOW_MS) },
    },
    select: { id: true },
  });
  return Boolean(run);
}

/** Mark the stored DM as Auto DM's. It was created 'pending' and nothing has queued it yet. */
async function markConversationMessage(savedMessage) {
  await prisma.message.update({ where: { id: savedMessage.id }, data: { aiStatus: 'autodm' } });
  log.info(`message ${savedMessage.id}: Auto DM conversation, not sorted`);
  return true;
}

/**
 * The messaging seam. `account` is the webhook's account (resolved from
 * entry.id), `event` the raw messaging event, `savedMessage` the row just
 * stored. true = Auto DM took it: skip classification/auto-reply for it.
 */
async function isAutoDmInteraction(account, event, savedMessage) {
  if (!config.isEnabled()) return false;
  try {
    const message = event && event.message;
    if (!account || !message || !savedMessage || !savedMessage.id) return false;
    const sender = senderOf(account, event);
    if (!sender) return false;

    // Mode OFF (cached): nobody has access, so no per-message query below.
    if ((await getRolloutMode()) === 'OFF') return false;

    const qr = message.quick_reply && message.quick_reply.payload;
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    const isTap = isAutoDmPayload(qr);
    const isCandidate = isTap || (text && text.length <= KEYWORD_MAX && !message.attachments);

    let accessChecked = false;
    if (isCandidate) {
      // A tap or short text costs an access check first. No access (or
      // revoked) = the message is an ordinary DM.
      if (!(await ownerHasAccess(account))) return false;
      accessChecked = true;
      const handled = isTap
        ? await handlePayloadTap(account, sender, qr, savedMessage.id)
        : await handleKeyword(account, sender, text, savedMessage.id);
      if (handled) {
        emitHandedOff(account, savedMessage);
        return true;
      }
    }

    if (!(await hasRecentRun(account, sender))) return false;
    if (!accessChecked && !(await ownerHasAccess(account))) return false;
    await markConversationMessage(savedMessage);
    emitHandedOff(account, savedMessage);
    return true;
  } catch (err) {
    log.error(`interaction check failed (${err && err.code ? err.code : 'error'}); message goes to normal sorting`);
    return false;
  }
}

/**
 * The postback branch in processEntry. Only called for AUTODM: payloads;
 * every other postback keeps today's behaviour. Never throws.
 */
async function handlePostback(account, event) {
  if (!config.isEnabled()) return false;
  try {
    if (!account || !isAutoDmPostback(event)) return false;
    const sender = senderOf(account, event);
    if (!sender) return false;
    if (!(await ownerHasAccess(account))) return false;
    return await handlePayloadTap(account, sender, event.postback.payload, null);
  } catch (err) {
    log.error(`postback handling failed (${err && err.code ? err.code : 'error'})`);
    return false;
  }
}

module.exports = {
  isAutoDmInteraction,
  handlePostback,
  isAutoDmPostback,
  isAutoDmPayload,
  PAYLOAD_RE,
  CONVERSATION_WINDOW_MS,
};
