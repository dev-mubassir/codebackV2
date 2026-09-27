/**
 * Comment intake — the ONE function both the comment webhook and the poller
 * feed. Creates an AutoDmRun (QUEUED) for the winning automation, or nothing.
 *
 * Payload parsing partly adapted from OpenReply (MIT) — lib/meta/webhook.ts
 * (`id ?? comment_id`, `media.id ?? media_id`, `original_media_id` for boosted
 * posts). Copyright (c) 2026 Anish Raj, Copyright (c) 2026 Diwen Huang.
 * See THIRD_PARTY_NOTICES.md.
 *
 * No run is created when:
 *   - the commenter is the account itself (our own public replies come back
 *     as comments) — compared by id AND username;
 *   - the comment is 7+ days old (a private reply is no longer allowed);
 *   - no active automation matches;
 *   - this comment already has a run (unique commentId: duplicate webhooks,
 *     webhook + poller) or this commenter already has a run for the winning
 *     automation (unique automationId+commenterId: one DM per person).
 */

const crypto = require('crypto');
const prisma = require('../../lib/prisma');
const config = require('./config');
const log = require('./log');
const { selectAutomation } = require('./matcher');
const { emitRunCreated } = require('./events');
const { isId, toDate } = require('./util');

const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const COMMENT_TEXT_MAX = 300; // stored for the run log only

const ACCOUNT_SELECT = { id: true, userId: true, igUserId: true, igUsername: true, connectionStatus: true };

/**
 * Normalise one webhook `comments` change value (or a polled comment) into
 * { commentId, commenterId, commenterUsername, text, mediaId,
 *   originalMediaId, createdAt } — or null when the shape is not trustworthy.
 */
function normalizeComment(value, fallbackTime) {
  if (!value || typeof value !== 'object') return null;
  const commentId = value.id ?? value.comment_id;
  const from = value.from && typeof value.from === 'object' ? value.from : {};
  if (!isId(commentId) || !isId(from.id)) return null;

  const media = value.media && typeof value.media === 'object' ? value.media : {};
  const mediaIdRaw = media.id ?? value.media_id;
  const originalRaw = media.original_media_id;
  const username = typeof from.username === 'string' ? from.username : value.username;

  return {
    commentId: String(commentId),
    commenterId: String(from.id),
    commenterUsername: typeof username === 'string' ? username.slice(0, 64) : null,
    text: typeof value.text === 'string' ? value.text.slice(0, 2200) : '',
    mediaId: isId(mediaIdRaw) ? String(mediaIdRaw) : null,
    originalMediaId: isId(originalRaw) && String(originalRaw) !== String(mediaIdRaw) ? String(originalRaw) : null,
    createdAt: toDate(value.timestamp, toDate(fallbackTime)),
  };
}

function isSelfComment(account, comment) {
  if (comment.commenterId === String(account.igUserId)) return true;
  const own = typeof account.igUsername === 'string' ? account.igUsername.toLowerCase() : null;
  return Boolean(own && comment.commenterUsername && comment.commenterUsername.toLowerCase() === own);
}

/**
 * @returns {Promise<'self'|'too_old'|'no_automation'|'no_match'|'duplicate'|'queued'>}
 * Throws only on a database failure (the caller decides whether that retries).
 */
async function intakeComment(account, comment, { source = 'webhook', now = Date.now() } = {}) {
  if (isSelfComment(account, comment)) return 'self';
  if (now - comment.createdAt.getTime() >= PRIVATE_REPLY_WINDOW_MS) return 'too_old';

  const automations = await prisma.autoDmAutomation.findMany({
    where: { instagramAccountId: account.id, userId: account.userId, status: 'active' },
  });
  if (automations.length === 0) return 'no_automation';

  const winner = selectAutomation(automations, comment);
  if (!winner) return 'no_match';

  let run;
  try {
    run = await prisma.autoDmRun.create({
      data: {
        id: crypto.randomUUID(),
        userId: account.userId,
        instagramAccountId: account.id,
        automationId: winner.id,
        commentId: comment.commentId,
        commenterId: comment.commenterId,
        commenterUsername: comment.commenterUsername,
        commentText: comment.text ? comment.text.slice(0, COMMENT_TEXT_MAX) : null,
        mediaId: comment.mediaId,
        source,
        status: 'QUEUED',
        pendingAction: 'OPENER',
        nextAttemptAt: new Date(now),
        commentCreatedAt: comment.createdAt,
      },
    });
  } catch (err) {
    if (err && err.code === 'P2002') return 'duplicate';
    throw err;
  }

  log.info(`run ${run.id} queued (automation ${winner.id}, source ${source})`);
  emitRunCreated(run);
  return 'queued';
}

// ---------------------------------------------------------------------------
// Webhook side
// ---------------------------------------------------------------------------

/** An entry that carries `changes` and no `messaging` (pure function, no I/O). */
function isCommentOnlyEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const hasChanges = Array.isArray(entry.changes) && entry.changes.length > 0;
  const hasMessaging = Array.isArray(entry.messaging) && entry.messaging.length > 0;
  return hasChanges && !hasMessaging;
}

/** Every entry in the delivery is comment-only. */
function isCommentOnlyDelivery(body) {
  const entries = body && Array.isArray(body.entry) ? body.entry : [];
  return entries.length > 0 && entries.every(isCommentOnlyEntry);
}

/**
 * Handle a comment-only webhook entry. Kill switch off = return before any
 * database query. Errors are logged and swallowed, EXCEPT when
 * `propagateErrors` is set (the whole delivery is comments), so the durable
 * webhook inbox (services/webhookDeliveries.js) retries it later.
 */
async function handleCommentEntry(entry, { propagateErrors = false } = {}) {
  if (!config.isEnabled()) return;
  try {
    const changes = (Array.isArray(entry.changes) ? entry.changes : []).filter(
      (c) => c && c.field === 'comments' && c.value && typeof c.value === 'object'
    );
    if (changes.length === 0 || !isId(entry.id)) return;

    const account = await prisma.instagramAccount.findFirst({
      where: { igUserId: String(entry.id), connectionStatus: 'CONNECTED' },
      select: ACCOUNT_SELECT,
    });
    if (!account) return; // unknown or disconnected account: inert

    for (const change of changes) {
      const comment = normalizeComment(change.value, entry.time);
      if (!comment) {
        log.warn(`ignored a comment payload with an invalid shape (account ${account.id})`);
        continue;
      }
      const outcome = await intakeComment(account, comment, { source: 'webhook' });
      if (outcome !== 'queued') log.info(`comment ${comment.commentId}: ${outcome}`);
    }
  } catch (err) {
    log.error(`comment intake failed (${err && err.code ? err.code : 'error'})${propagateErrors ? ' — the delivery will be retried' : ''}`);
    if (propagateErrors) throw err;
  }
}

module.exports = {
  normalizeComment,
  isSelfComment,
  intakeComment,
  isCommentOnlyEntry,
  isCommentOnlyDelivery,
  handleCommentEntry,
  ACCOUNT_SELECT,
  PRIVATE_REPLY_WINDOW_MS,
};
