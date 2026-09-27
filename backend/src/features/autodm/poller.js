/**
 * Adapted from OpenReply (MIT) — lib/polling/comment-reconciler.ts.
 * Copyright (c) 2026 Anish Raj, Copyright (c) 2026 Diwen Huang.
 * See THIRD_PARTY_NOTICES.md.
 *
 * The comment poller: a safety net for comment webhooks Meta never sends
 * (and for the pre-Advanced-Access period). AUTODM_POLL_MODE = off |
 * allowlist | all.
 *
 * Every 2 minutes, for each connected account with the comments scope whose
 * owner has Auto DM access (in `allowlist` mode: a named beta user — an admin
 * grant or the env list), for each ACTIVE automation: read the recent comments on that automation's posts (its picked
 * posts, or the 10 most recent for "any post") and feed new ones to the SAME
 * intake the webhook uses. Our unique commentId is the dedupe, so no
 * "already replied?" Graph calls are made.
 *
 *   lookback: 72 hours — and never before the automation was last saved, so
 *             creating or re-activating an automation never DMs people who
 *             commented before it existed (Siffty change);
 *   cap:      30 new comments per automation per sweep (a viral post drains
 *             gradually instead of bursting into the comment API);
 *   backoff:  error 368 or any other Meta rate-limit code pauses that account
 *             for 15 minutes.
 *
 * ONE sweep across all pods: each sweep runs through the scheduler's own
 * runIfDue() (jobs/scheduler.js) — a Postgres advisory lock on the scheduler's
 * lock pool plus a due-check inside the lock against job_runs. A pod that
 * loses the lock, or finds the sweep already done this interval, skips.
 * Queue claiming stays FOR UPDATE SKIP LOCKED (worker.js).
 *
 * Known limit: only top-level comments are read (replies arrive by webhook).
 */

const prisma = require('../../lib/prisma');
const { readAccountToken } = require('../../lib/crypto');
const { handleMetaError } = require('../../lib/tokenHealth');
const { isTokenInvalidError } = require('../../lib/instagram');
const config = require('./config');
const graph = require('./graph');
const log = require('./log');
const { intakeComment, normalizeComment, ACCOUNT_SELECT } = require('./intake');
const { runIfDue } = require('../../jobs/scheduler');
const { hasAutoDmAccess, isBetaUser } = require('./access');

const JOB_NAME = 'autodm_poll';

const SWEEP_EVERY_MS = 2 * 60 * 1000;
const LOOKBACK_MS = 72 * 60 * 60 * 1000;
const MAX_NEW_PER_AUTOMATION = 30;
const RECENT_MEDIA_LIMIT = 10;
const RATE_LIMIT_PAUSE_MS = 15 * 60 * 1000;

let lastSweepAt = 0;
const pausedUntil = new Map(); // instagramAccountId -> epoch ms

/** Called every worker tick; sweeps at most once per interval ACROSS pods. */
async function maybePoll({ now = Date.now() } = {}) {
  if (config.pollMode() === 'off') return null;
  if (now - lastSweepAt < SWEEP_EVERY_MS) return null; // don't even ask for the lock every tick
  lastSweepAt = now;
  return sweepOnce({ now });
}

/**
 * One locked sweep. Resolves { ran: true, result } for the pod that won the
 * lock (and found the sweep due), or { ran: false, reason: 'locked' |
 * 'not_due' | 'busy' | 'disabled' } for everyone else.
 */
function sweepOnce({ now = Date.now() } = {}) {
  return runIfDue(JOB_NAME, SWEEP_EVERY_MS, () => sweep({ now }), {
    enabled: () => config.pollMode() !== 'off',
  });
}

function tokenOf(account) {
  try {
    const t = readAccountToken(account);
    return t && t !== 'revoked' ? t : null;
  } catch {
    return null;
  }
}

async function sweepAccount(state, now, stats) {
  const account = state.instagramAccount;
  const token = tokenOf(account);
  if (!token) return;

  const automations = await prisma.autoDmAutomation.findMany({
    where: { instagramAccountId: account.id, userId: account.userId, status: 'active' },
    select: { id: true, postScope: true, mediaIds: true, updatedAt: true },
  });
  if (automations.length === 0) return;

  const intakeAccount = {
    id: account.id,
    userId: account.userId,
    igUserId: account.igUserId,
    igUsername: account.igUsername,
    connectionStatus: account.connectionStatus,
  };
  const commentsCache = new Map();
  let recentMedia = null;

  const commentsFor = async (mediaId) => {
    if (!commentsCache.has(mediaId)) commentsCache.set(mediaId, await graph.listComments(mediaId, token));
    return commentsCache.get(mediaId);
  };

  for (const automation of automations) {
    let mediaIds;
    if (automation.postScope === 'SPECIFIC') {
      mediaIds = automation.mediaIds || [];
    } else {
      if (recentMedia === null) recentMedia = (await graph.listMedia(token, { limit: RECENT_MEDIA_LIMIT })).map((m) => String(m.id));
      mediaIds = recentMedia;
    }

    const since = Math.max(now - LOOKBACK_MS, new Date(automation.updatedAt).getTime());
    const candidates = [];
    for (const mediaId of mediaIds) {
      for (const raw of await commentsFor(mediaId)) {
        const comment = normalizeComment({ ...raw, media: { id: mediaId } }, now);
        if (!comment) continue;
        if (comment.createdAt.getTime() < since) continue;
        if (comment.commenterId === String(account.igUserId)) continue;
        candidates.push(comment);
      }
    }
    if (candidates.length === 0) continue;

    // Already handled (run exists) = skip. One query, no Graph calls.
    const known = await prisma.autoDmRun.findMany({
      where: { commentId: { in: candidates.map((c) => c.commentId) } },
      select: { commentId: true },
    });
    const knownIds = new Set(known.map((k) => k.commentId));

    const fresh = candidates
      .filter((c) => !knownIds.has(c.commentId))
      .sort((a, b) => a.createdAt - b.createdAt) // earliest commenter first
      .slice(0, MAX_NEW_PER_AUTOMATION);

    for (const comment of fresh) {
      const outcome = await intakeComment(intakeAccount, comment, { source: 'poll', now });
      stats.fed += 1;
      if (outcome === 'queued') stats.queued += 1;
      knownIds.add(comment.commentId);
    }
  }
}

/** One pass over every eligible account. Returns counts only. */
async function sweep({ now = Date.now() } = {}) {
  const mode = config.pollMode();
  if (mode === 'off') return null;

  const states = await prisma.autoDmAccountState.findMany({
    where: { commentsGranted: true, instagramAccount: { connectionStatus: 'CONNECTED' } },
    include: {
      user: { select: { id: true, email: true } },
      instagramAccount: {
        select: {
          ...ACCOUNT_SELECT,
          accessToken: true,
          tokenCiphertext: true,
          tokenIv: true,
          tokenAuthTag: true,
          tokenKeyVersion: true,
        },
      },
    },
  });

  const stats = { accounts: 0, fed: 0, queued: 0, paused: 0 };
  for (const state of states) {
    if (state.instagramAccount.userId !== state.userId) continue;
    // Runtime check every sweep: a revoked owner's automations are skipped.
    if (!(await hasAutoDmAccess(state.user))) continue;
    if (mode === 'allowlist' && !(await isBetaUser(state.user))) continue;
    if ((pausedUntil.get(state.instagramAccountId) || 0) > now) {
      stats.paused += 1;
      continue;
    }

    stats.accounts += 1;
    try {
      await sweepAccount(state, now, stats);
      await prisma.autoDmAccountState
        .update({ where: { id: state.id }, data: { pollCursorAt: new Date(now) } })
        .catch(() => {});
    } catch (err) {
      const code = graph.safeErrorCode(err);
      if (graph.isRateLimitError(err)) {
        pausedUntil.set(state.instagramAccountId, now + RATE_LIMIT_PAUSE_MS);
        log.warn(`poller: account ${state.instagramAccountId} rate-limited (${code}); paused 15 minutes`);
      } else if (isTokenInvalidError(err)) {
        await handleMetaError(err, state.instagramAccountId).catch(() => {});
        log.warn(`poller: account ${state.instagramAccountId} token invalid`);
      } else {
        log.warn(`poller: account ${state.instagramAccountId} sweep failed (${code})`);
      }
    }
  }

  if (stats.queued || stats.paused) {
    log.info(`poller: ${stats.accounts} account(s), ${stats.fed} new comment(s), ${stats.queued} run(s) queued, ${stats.paused} paused`);
  }
  return stats;
}

/** Test hook: forget the sweep clock and any rate-limit pauses. */
function resetPollerState() {
  lastSweepAt = 0;
  pausedUntil.clear();
}

module.exports = { maybePoll, sweepOnce, sweep, resetPollerState, JOB_NAME, SWEEP_EVERY_MS, LOOKBACK_MS, MAX_NEW_PER_AUTOMATION };
