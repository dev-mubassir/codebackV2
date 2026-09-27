/**
 * The Auto DM queue loop. Follow-gate semantics adapted from OpenReply (MIT) —
 * lib/queue/dm-worker.ts (after a tap, only `false` means "not following"; an
 * unverifiable answer fails OPEN). Copyright (c) 2026 Anish Raj,
 * Copyright (c) 2026 Diwen Huang. See THIRD_PARTY_NOTICES.md.
 *
 * The queue IS the autodm_runs table: a run is due when pending_action is set
 * and next_attempt_at has passed. Each tick claims up to BATCH due rows with
 * UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED), stamping a lease
 * (claimed_at) — safe with any number of instances.
 *
 *   OPENER    public reply (optional, at most once) → private reply: button
 *             template with ONE postback button (AUTODM:<id>:GET); if Meta
 *             rejects the template, plain text (which names the LINK
 *             keyword) → OPENER_SENT, igsid stored from recipient_id.
 *             A timeout / connection reset during that send → the reply may
 *             have gone out, and Meta allows only ONE per comment, so it is
 *             never retried: OPENER_UNCONFIRMED (igsid provisionally the
 *             commenter id). A later tap or keyword reply still works.
 *   GET       follow gate off → main message. On → follow check.
 *   FOLLOWED  follow check again.
 *   follow check: true → main message; false → follow prompt (postback
 *             AUTODM:<id>:FOLLOWED), AWAITING_FOLLOW, followChecks+1 — the
 *             3rd false sends the polite final message → NOT_FOLLOWING;
 *             null (Meta would not say) → FAIL OPEN: main message, and
 *             last_error = FAIL_OPEN is recorded on the run.
 *   main message: image (if any, once) → text; with a link, a web_url
 *             button template, falling back to text + link → DELIVERED.
 *
 * Failures: exponential backoff, 5 attempts → FAILED. A dead token flags the
 * account (existing lib/tokenHealth) and fails at once. Meta rate limits back
 * off 15 minutes. Private replies are throttled per account below Meta's
 * 750/hour: overflow is re-queued, never dropped. 7 days after the comment an
 * unsent opener → EXPIRED (Meta no longer allows the private reply).
 *
 * Kill switch off → every tick returns before touching the database.
 */

const prisma = require('../../lib/prisma');
const { readAccountToken } = require('../../lib/crypto');
const { handleMetaError } = require('../../lib/tokenHealth');
const { isTokenInvalidError } = require('../../lib/instagram');
const config = require('./config');
const graph = require('./graph');
const log = require('./log');
const { emitRunUpdated } = require('./events');
const { pickRandom, utf8Bytes } = require('./util');
const {
  DEFAULT_OPENER_BUTTON,
  DEFAULT_FOLLOW_BUTTON,
  DEFAULT_FOLLOW_FAIL,
  defaultFollowPrompt,
} = require('./messages');

const TICK_MS = 5 * 1000;
const BATCH = 10;
const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 15 * 1000;
const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FOLLOW_CHECKS = 3;
// Meta allows 750 private replies per hour per account (posts and reels).
// Stay below it; the rest waits, it is never dropped.
const PRIVATE_REPLIES_PER_HOUR = 700;
const THROTTLE_REQUEUE_MS = 10 * 60 * 1000;
const MAX_TEXT_BYTES = 1000;

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

/** Claim up to `limit` due runs. Timestamps are UTC (Prisma stores UTC). */
async function claimDueRuns(limit = BATCH) {
  const rows = await prisma.$queryRaw`
    UPDATE "autodm_runs"
       SET "claimed_at" = (NOW() AT TIME ZONE 'UTC'),
           "attempts" = "attempts" + 1,
           "updated_at" = (NOW() AT TIME ZONE 'UTC')
     WHERE "id" IN (
       SELECT "id" FROM "autodm_runs"
        WHERE "pending_action" IS NOT NULL
          AND "next_attempt_at" <= (NOW() AT TIME ZONE 'UTC')
          AND ("claimed_at" IS NULL
               OR "claimed_at" < (NOW() AT TIME ZONE 'UTC') - (${LEASE_MS}::int * INTERVAL '1 millisecond'))
        ORDER BY "next_attempt_at" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
 RETURNING "id"`;
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

async function update(run, data) {
  const updated = await prisma.autoDmRun.update({ where: { id: run.id }, data });
  if (data.status && data.status !== run.status) emitRunUpdated(updated);
  return updated;
}

/** Nothing more is due for this run. */
function finish(run, status, extra = {}) {
  return update(run, {
    status,
    pendingAction: null,
    nextAttemptAt: null,
    claimedAt: null,
    attempts: 0,
    ...extra,
  });
}

async function fail(run, err) {
  const code = graph.safeErrorCode(err);

  if (isTokenInvalidError(err)) {
    await handleMetaError(err, run.instagramAccountId).catch(() => {});
    log.warn(`run ${run.id}: token invalid, account flagged for reconnect`);
    return finish(run, 'FAILED', { lastError: code, attempts: run.attempts });
  }

  if (run.attempts >= MAX_ATTEMPTS) {
    log.warn(`run ${run.id}: failed after ${run.attempts} attempts (${code})`);
    return finish(run, 'FAILED', { lastError: code, attempts: run.attempts });
  }

  const delay = graph.isRateLimitError(err)
    ? RATE_LIMIT_BACKOFF_MS
    : BASE_BACKOFF_MS * 2 ** Math.max(0, run.attempts - 1);
  log.info(`run ${run.id}: attempt ${run.attempts} failed (${code}); retry in ${Math.round(delay / 1000)}s`);
  return update(run, { nextAttemptAt: new Date(Date.now() + delay), claimedAt: null, lastError: code });
}

// ---------------------------------------------------------------------------
// Sends
// ---------------------------------------------------------------------------

function payloadFor(run, action) {
  return `AUTODM:${run.id}:${action}`;
}

/** Button template first; on a rejected template, the plain text once. */
async function withTextFallback(sendTemplate, sendPlain) {
  try {
    return await sendTemplate();
  } catch (err) {
    if (!graph.isRejectedParam(err)) throw err;
    log.info('button template rejected by Meta; retrying as plain text');
    return sendPlain();
  }
}

async function throttled(run) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const sent = await prisma.autoDmRun.count({
    where: {
      instagramAccountId: run.instagramAccountId,
      OR: [{ openerSentAt: { gte: since } }, { status: 'OPENER_UNCONFIRMED', updatedAt: { gte: since } }],
    },
  });
  return sent >= PRIVATE_REPLIES_PER_HOUR;
}

async function doOpener(run, token) {
  const a = run.automation;

  if (Date.now() - new Date(run.commentCreatedAt).getTime() >= PRIVATE_REPLY_WINDOW_MS) {
    log.info(`run ${run.id}: comment older than 7 days, expired`);
    return finish(run, 'EXPIRED');
  }

  if (await throttled(run)) {
    // Overflow waits; the claim did not count as an attempt.
    log.info(`run ${run.id}: account at the hourly private-reply cap, re-queued`);
    return update(run, {
      nextAttemptAt: new Date(Date.now() + THROTTLE_REQUEUE_MS),
      claimedAt: null,
      attempts: Math.max(0, run.attempts - 1),
    });
  }

  // Public reply: optional, AT MOST ONCE (stamped before posting, so a crash
  // can never post it twice), and never blocks the private reply.
  if (a.publicReplyEnabled && Array.isArray(a.publicReplies) && a.publicReplies.length && !run.publicReplyAt) {
    run = await update(run, { publicReplyAt: new Date() });
    try {
      await graph.replyToComment(run.commentId, pickRandom(a.publicReplies), token);
    } catch (err) {
      log.warn(`run ${run.id}: public reply failed (${graph.safeErrorCode(err)}); continuing`);
      if (isTokenInvalidError(err)) throw err;
    }
  }

  const label = a.openerButtonLabel || DEFAULT_OPENER_BUTTON;
  let res;
  try {
    res = await withTextFallback(
      () => graph.sendPrivateReplyWithButton(run.commentId, a.openerText, label, payloadFor(run, 'GET'), token),
      () => graph.sendPrivateReply(run.commentId, { text: a.openerText }, token)
    );
  } catch (err) {
    if (!graph.isUnconfirmedSendError(err)) throw err;
    // It may have been delivered; a second private reply to this comment would
    // be refused (or worse, duplicated). Stop here, keep the run tappable.
    log.warn(`run ${run.id}: opener outcome unknown (${graph.safeErrorCode(err)}); not retried`);
    return finish(run, 'OPENER_UNCONFIRMED', { igsid: run.commenterId, lastError: 'OPENER_UNCONFIRMED' });
  }

  const recipient = res && res.recipient_id != null ? String(res.recipient_id) : null;
  if (!recipient) log.warn(`run ${run.id}: Meta returned no recipient_id; using the commenter id`);
  log.info(`run ${run.id}: opener sent`);
  return finish(run, 'OPENER_SENT', {
    igsid: recipient || run.commenterId,
    openerSentAt: new Date(),
    lastError: null,
  });
}

function publicBaseUrl() {
  const raw = String(process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(raw) ? raw : null;
}

async function sendMain(run, token, { failOpen = false } = {}) {
  const a = run.automation;

  if (a.image && !run.mainImageSentAt) {
    const base = publicBaseUrl();
    if (base) {
      await graph.sendImage(run.igsid, `${base}/public/autodm/images/${a.image.id}`, token);
      run = await update(run, { mainImageSentAt: new Date() });
    } else {
      log.warn(`run ${run.id}: BACKEND_URL not set, image skipped`);
    }
  }

  if (a.linkUrl) {
    await withTextFallback(
      () => graph.sendButtonTemplate(run.igsid, a.mainText, a.linkUrl, a.linkLabel || 'Open link', token),
      async () => {
        const combined = `${a.mainText}\n\n${a.linkUrl}`;
        if (utf8Bytes(combined) <= MAX_TEXT_BYTES) return graph.sendText(run.igsid, combined, token);
        await graph.sendText(run.igsid, a.mainText, token);
        return graph.sendText(run.igsid, a.linkUrl, token);
      }
    );
  } else {
    await graph.sendText(run.igsid, a.mainText, token);
  }

  log.info(`run ${run.id}: main message delivered${failOpen ? ' (follow status unavailable: FAIL_OPEN)' : ''}`);
  return finish(run, 'DELIVERED', { deliveredAt: new Date(), lastError: failOpen ? 'FAIL_OPEN' : null });
}

async function followCheck(run, token) {
  const a = run.automation;
  const follows = await graph.getFollowStatus(run.igsid, token);

  if (follows === true) return sendMain(run, token);
  if (follows === null) return sendMain(run, token, { failOpen: true });

  // Definitely not following.
  const checks = run.followChecks + 1;
  if (checks >= MAX_FOLLOW_CHECKS) {
    await graph.sendText(run.igsid, a.followFailText || DEFAULT_FOLLOW_FAIL, token);
    log.info(`run ${run.id}: not following after ${checks} checks`);
    return finish(run, 'NOT_FOLLOWING', { followChecks: checks, lastError: null });
  }

  const prompt = a.followPromptText || defaultFollowPrompt(a.fallbackKeyword);
  const label = a.followButtonLabel || DEFAULT_FOLLOW_BUTTON;
  await withTextFallback(
    () => graph.sendDirectMessageWithButton(run.igsid, prompt, label, payloadFor(run, 'FOLLOWED'), token),
    () => graph.sendText(run.igsid, prompt, token)
  );
  log.info(`run ${run.id}: follow prompt sent (check ${checks}/${MAX_FOLLOW_CHECKS})`);
  return finish(run, 'AWAITING_FOLLOW', { followChecks: checks, lastError: null });
}

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------

const ACCOUNT_FIELDS = {
  id: true,
  userId: true,
  igUserId: true,
  connectionStatus: true,
  accessToken: true,
  tokenCiphertext: true,
  tokenIv: true,
  tokenAuthTag: true,
  tokenKeyVersion: true,
};

async function processRun(id) {
  let run = await prisma.autoDmRun.findUnique({
    where: { id },
    include: {
      automation: { include: { image: { select: { id: true } } } },
      instagramAccount: { select: ACCOUNT_FIELDS },
    },
  });
  if (!run || !run.pendingAction) return;

  const account = run.instagramAccount;
  if (!account || account.userId !== run.userId || !run.automation || run.automation.userId !== run.userId) {
    log.error(`run ${run.id}: tenant mismatch, stopped`);
    return finish(run, 'FAILED', { lastError: 'TENANT_MISMATCH' });
  }
  if (account.connectionStatus !== 'CONNECTED') {
    return finish(run, 'FAILED', { lastError: 'ACCOUNT_DISCONNECTED' });
  }

  let token;
  try {
    token = readAccountToken(account);
  } catch {
    token = null;
  }
  if (!token || token === 'revoked') return finish(run, 'FAILED', { lastError: 'NO_TOKEN' });

  try {
    switch (run.pendingAction) {
      case 'OPENER':
        return await doOpener(run, token);
      case 'GET':
        if (!run.igsid) return finish(run, 'FAILED', { lastError: 'NO_RECIPIENT' });
        return run.automation.followGateEnabled ? await followCheck(run, token) : await sendMain(run, token);
      case 'FOLLOWED':
        if (!run.igsid) return finish(run, 'FAILED', { lastError: 'NO_RECIPIENT' });
        return await followCheck(run, token);
      default:
        return finish(run, 'FAILED', { lastError: 'UNKNOWN_ACTION' });
    }
  } catch (err) {
    // Re-read: a step may have stamped publicReplyAt / mainImageSentAt.
    run = (await prisma.autoDmRun.findUnique({ where: { id } })) || run;
    return fail(run, err);
  }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let timer = null;
let running = null;

/** One pass: due runs, then (when due) the comment poller. */
async function tick() {
  if (!config.isEnabled()) return; // idle: no database access at all
  try {
    const ids = await claimDueRuns();
    for (const id of ids) {
      try {
        await processRun(id);
      } catch (err) {
        log.error(`run ${id}: unexpected error (${err && err.code ? err.code : 'error'})`);
      }
    }
    await require('./poller').maybePoll();
  } catch (err) {
    log.error(`tick failed (${err && err.code ? err.code : 'error'})`);
  }
}

/**
 * Start the loop (idempotent). Not under NODE_ENV=test: tests drive tick()
 * directly, the same way RUN_IN_PROCESS_SCHEDULER=false keeps the scheduler
 * out of the suite.
 */
function startLoop() {
  if (timer || process.env.NODE_ENV === 'test') return;
  timer = setInterval(() => {
    if (running) return;
    running = tick().finally(() => {
      running = null;
    });
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

async function stopLoop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (running) await running.catch(() => {});
}

module.exports = {
  tick,
  startLoop,
  stopLoop,
  claimDueRuns,
  processRun,
  MAX_ATTEMPTS,
  MAX_FOLLOW_CHECKS,
  PRIVATE_REPLIES_PER_HOUR,
};
