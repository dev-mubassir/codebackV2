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
 * grant or the env list): work out the POSTS its active automations watch —
 * every picked post, plus the 3 most recent posts when any automation is on
 * "any post" — and read each post's comments ONCE, however many automations
 * share it (Gate 9B: users can have 100–500 automations). New comments go to
 * the SAME intake the webhook uses; our unique commentId is the dedupe, so no
 * "already replied?" Graph calls are made.
 *
 *   tiers:    a post under 48 hours old is read every sweep (2 minutes), one
 *             2–7 days old every 15 minutes, older ones every 60 minutes. When
 *             a post was published and last read is kept per post in
 *             autodm_media_states, shared by every pod (a post's publish time
 *             is fetched once);
 *   lookback: 72 hours — and never before the automation was last saved
 *             (intake ignores automations saved after the comment), so
 *             creating or re-activating an automation never DMs people who
 *             commented before it existed (Siffty change);
 *   cap:      30 new comments per post per sweep (a viral post drains
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
const MAX_NEW_PER_MEDIA = 30;
const RECENT_MEDIA_LIMIT = 3; // "any post" automations watch the latest 3 posts
const RATE_LIMIT_PAUSE_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** How often a post is read, by its age. Unknown age = treated as new. */
function pollIntervalFor(mediaCreatedAt, now) {
  if (!mediaCreatedAt) return SWEEP_EVERY_MS;
  const age = now - new Date(mediaCreatedAt).getTime();
  if (age < 48 * HOUR_MS) return SWEEP_EVERY_MS;
  if (age < 7 * 24 * HOUR_MS) return 15 * 60 * 1000;
  return 60 * 60 * 1000;
}

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
    select: { postScope: true, mediaIds: true, updatedAt: true },
  });
  if (automations.length === 0) return;
  // Nothing written before the oldest active automation was saved can match
  // (intake also checks each automation's own save time).
  const since = Math.max(now - LOOKBACK_MS, Math.min(...automations.map((a) => new Date(a.updatedAt).getTime())));

  const intakeAccount = {
    id: account.id,
    userId: account.userId,
    igUserId: account.igUserId,
    igUsername: account.igUsername,
    connectionStatus: account.connectionStatus,
  };

  // The posts to watch: every picked post, plus the latest 3 for "any post".
  const published = new Map(); // mediaId -> Date | null (from listMedia)
  const watched = new Set();
  for (const a of automations) if (a.postScope === 'SPECIFIC') for (const id of a.mediaIds || []) watched.add(String(id));
  if (automations.some((a) => a.postScope !== 'SPECIFIC')) {
    for (const m of await graph.listMedia(token, { limit: RECENT_MEDIA_LIMIT })) {
      const id = String(m.id);
      watched.add(id);
      const ts = m.timestamp ? new Date(m.timestamp) : null;
      published.set(id, ts && !Number.isNaN(ts.getTime()) ? ts : null);
    }
  }
  if (watched.size === 0) return;

  const mediaIds = [...watched];
  const states = new Map(
    (
      await prisma.autoDmMediaState.findMany({
        where: { instagramAccountId: account.id, mediaId: { in: mediaIds } },
        select: { mediaId: true, mediaCreatedAt: true, lastPolledAt: true },
      })
    ).map((m) => [m.mediaId, m])
  );

  for (const mediaId of mediaIds) {
    const known = states.get(mediaId);
    let createdAt = known && known.mediaCreatedAt ? known.mediaCreatedAt : published.get(mediaId) || null;
    if (!known && !createdAt) createdAt = await graph.getMediaTimestamp(mediaId, token); // once per post

    if (known && known.lastPolledAt && now - new Date(known.lastPolledAt).getTime() < pollIntervalFor(createdAt, now)) {
      stats.skippedMedia += 1;
      continue;
    }

    const raws = await graph.listComments(mediaId, token);
    stats.mediaPolled += 1;
    await prisma.autoDmMediaState.upsert({
      where: { instagramAccountId_mediaId: { instagramAccountId: account.id, mediaId } },
      create: { instagramAccountId: account.id, mediaId, mediaCreatedAt: createdAt, lastPolledAt: new Date(now) },
      update: { lastPolledAt: new Date(now), ...(createdAt ? { mediaCreatedAt: createdAt } : {}) },
    });

    const candidates = [];
    for (const raw of raws) {
      const comment = normalizeComment({ ...raw, media: { id: mediaId } }, now);
      if (!comment) continue;
      if (comment.createdAt.getTime() < since) continue;
      if (comment.commenterId === String(account.igUserId)) continue;
      candidates.push(comment);
    }
    if (candidates.length === 0) continue;

    // Already handled (run exists) = skip. One query, no Graph calls.
    const handled = await prisma.autoDmRun.findMany({
      where: { commentId: { in: candidates.map((c) => c.commentId) } },
      select: { commentId: true },
    });
    const handledIds = new Set(handled.map((k) => k.commentId));

    const fresh = candidates
      .filter((c) => !handledIds.has(c.commentId))
      .sort((a, b) => a.createdAt - b.createdAt) // earliest commenter first
      .slice(0, MAX_NEW_PER_MEDIA);

    for (const comment of fresh) {
      const outcome = await intakeComment(intakeAccount, comment, { source: 'poll', now });
      stats.fed += 1;
      if (outcome === 'queued') stats.queued += 1;
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

  const stats = { accounts: 0, mediaPolled: 0, skippedMedia: 0, fed: 0, queued: 0, paused: 0 };
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

module.exports = {
  maybePoll,
  sweepOnce,
  sweep,
  resetPollerState,
  pollIntervalFor,
  JOB_NAME,
  SWEEP_EVERY_MS,
  LOOKBACK_MS,
  MAX_NEW_PER_MEDIA,
  RECENT_MEDIA_LIMIT,
};
