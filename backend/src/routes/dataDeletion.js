/**
 * Data deletion — the surface Meta App Review requires.
 *
 * Two entry points:
 *
 *   POST /data-deletion/instagram
 *     Meta's Data Deletion Request Callback. Meta posts a `signed_request`
 *     (base64url payload + HMAC-SHA256 over it, keyed with the app secret)
 *     identifying an Instagram user who asked for their data to be removed.
 *     We verify the signature, delete the Meta-derived data for that
 *     Instagram account (never a Siffty login or billing — see
 *     eraseInstagramUserData), reply with the {url, confirmation_code} shape
 *     Meta expects, and email the affected owner(s) a confirmation.
 *
 *   GET /data-deletion/status
 *     The human-readable status URL referenced in that reply.
 *
 *   POST /data-deletion/deauthorize
 *     Meta's Deauthorize Callback — fired when a user removes Codeback from
 *     Instagram's settings. This DISCONNECTS only; it never emails, because
 *     Meta sends the Data Deletion Request Callback for the same event right
 *     after, and that is the one that actually erases data. See the note on
 *     that route below.
 *
 * Both routes are deliberately unauthenticated — Meta calls them
 * server-to-server with no session. The signature IS the authentication, so
 * it is verified exactly as strictly as the webhook's, including in
 * non-production, and every branch of that verification is logged with a
 * tag identifying which check failed. Never log tokens, signed_request,
 * secrets, or email addresses — the Instagram user id is fine.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../lib/prisma');
const { hashIgUserId } = require('../lib/igIdentity');
const { destroyUserSessions } = require('../lib/session');
const { disconnectUserSockets } = require('../lib/socket');
// Bound as `mailer`, never `email` — see routes/auth.js. A local `email`
// variable shadowing this module silently broke registration once already.
const mailer = require('../lib/email');

/** base64url -> Buffer (Meta uses URL-safe base64 without padding). */
function b64urlDecode(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

/**
 * Verify and parse Meta's signed_request, reporting WHICH check failed.
 *
 * Returns { payload, reason }. `payload` is null on any failure; `reason` is
 * one of 'missing_field' | 'bad_format' | 'bad_algorithm' | 'bad_signature',
 * present only when payload is null. This is the ONE verification used by
 * both /instagram and /deauthorize — see FINDINGS.md and the Gate 0-B
 * diagnosis: the two routes have never used different code here.
 */
function verifySignedRequest(signedRequest, appSecret) {
  if (!signedRequest || typeof signedRequest !== 'string') {
    return { payload: null, reason: 'missing_field' };
  }

  const [encodedSig, encodedPayload] = signedRequest.split('.');
  if (!encodedSig || !encodedPayload) {
    return { payload: null, reason: 'bad_format' };
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(encodedPayload).toString('utf8'));
  } catch {
    return { payload: null, reason: 'bad_format' };
  }

  if (String(payload.algorithm).toUpperCase() !== 'HMAC-SHA256') {
    return { payload: null, reason: 'bad_algorithm' };
  }

  const expected = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
  const provided = b64urlDecode(encodedSig);

  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false.
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { payload: null, reason: 'bad_signature' };
  }

  return { payload, reason: null };
}

/** Backward-compatible form: the payload, or null. Reason-blind callers only. */
function parseSignedRequest(signedRequest, appSecret) {
  return verifySignedRequest(signedRequest, appSecret).payload;
}

/**
 * Erase the META-DERIVED data for one Instagram user id — for every tenant
 * that holds (or held) that Instagram account.
 *
 * WHAT IS ERASED (F3 scope, approved 2026-09-25): the connection itself and
 * its encrypted token and profile (InstagramAccount), and everything that
 * came from Instagram through it — contacts, conversations, messages, AI
 * analyses, summaries, reply drafts, brand deals and webhook logs (all
 * cascade from InstagramAccount / Conversation), plus the notifications that
 * point at those conversations or brand deals (no FK, so deleted explicitly —
 * their titles can quote DM content).
 *
 * WHAT IS NEVER ERASED: a Siffty login (User), billing, orders, payments,
 * credits, or any OTHER connected Instagram account. Those belong to the
 * Siffty customer, not to the Instagram user who asked Meta for deletion.
 * This used to delete an owner's whole Siffty account when the deleted
 * Instagram connection was their last one — including an EARLIER owner's
 * account, after a workspace transfer.
 *
 * ALL rows for this Instagram id, not one: igUserId is not globally unique —
 * disconnected rows persist as history and a workspace transfer leaves the
 * previous owner's row behind. A deletion request covers the person, not one
 * link.
 *
 * Returns { accountsRemoved, notifications }, notifications having one entry
 * per distinct owner affected: { userId, email, igUsername, userDeleted:false }.
 */
async function eraseInstagramUserData(igUserId) {
  const accounts = await prisma.instagramAccount.findMany({
    where: { igUserId: String(igUserId) },
    select: { id: true, userId: true, igUsername: true },
  });

  if (accounts.length === 0) return { accountsRemoved: 0, notifications: [] };

  const accountIds = accounts.map((a) => a.id);
  const ownerIds = [...new Set(accounts.map((a) => a.userId))];
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, email: true },
  });
  const emailByOwner = new Map(owners.map((o) => [o.id, o.email]));

  // One representative username per owner for the email.
  const usernameByOwner = new Map();
  for (const a of accounts) {
    if (!usernameByOwner.has(a.userId) && a.igUsername) usernameByOwner.set(a.userId, a.igUsername);
  }

  await prisma.$transaction(async (tx) => {
    const [conversations, brandDeals] = await Promise.all([
      tx.conversation.findMany({ where: { instagramAccountId: { in: accountIds } }, select: { id: true } }),
      tx.brandDeal.findMany({ where: { instagramAccountId: { in: accountIds } }, select: { id: true } }),
    ]);
    const conversationIds = conversations.map((c) => c.id);
    const brandDealIds = brandDeals.map((b) => b.id);
    if (conversationIds.length || brandDealIds.length) {
      await tx.notification.deleteMany({
        where: { OR: [{ conversationId: { in: conversationIds } }, { brandDealId: { in: brandDealIds } }] },
      });
    }
    // Cascades: contacts, conversations, messages, analyses, summaries, reply
    // drafts, brand deals, webhook logs.
    await tx.instagramAccount.deleteMany({ where: { id: { in: accountIds } } });
  });

  // Live views of the deleted conversations must not linger in open tabs.
  for (const userId of ownerIds) disconnectUserSockets(userId);

  const notifications = ownerIds.map((userId) => ({
    userId,
    email: emailByOwner.get(userId) || null,
    igUsername: usernameByOwner.get(userId) || null,
    userDeleted: false,
  }));

  return { accountsRemoved: accounts.length, notifications };
}

// ============================================
// POST /data-deletion/instagram
// ============================================
router.post('/instagram', async (req, res) => {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appSecret) {
    console.error('[DataDeletion] Rejected: INSTAGRAM_APP_SECRET is not configured; cannot verify requests.');
    return res.status(503).json({ error: 'Data deletion is not set up on this server.' });
  }

  const { payload, reason } = verifySignedRequest(req.body?.signed_request, appSecret);
  if (!payload) {
    console.warn(`[DataDeletion] Rejected request: ${reason}.`);
    return res.status(400).json({ error: 'Invalid signed_request' });
  }

  const igUserId = payload.user_id;
  if (!igUserId) {
    console.warn('[DataDeletion] Rejected request: signed_request had no user_id.');
    return res.status(400).json({ error: 'signed_request did not identify a user' });
  }

  // The confirmation code is PERSISTED, keyed by the same pseudonymised hash
  // as the trial-abuse ledger, so the record itself does not reveal which
  // Instagram account requested deletion.
  const confirmationCode = crypto.randomBytes(12).toString('hex');
  const igUserIdHash = hashIgUserId(igUserId);

  let request;
  try {
    request = await prisma.deletionRequest.create({
      data: { code: confirmationCode, igUserIdHash, status: 'PROCESSING' },
    });
  } catch (err) {
    console.error(`[DataDeletion] Could not record the request (igUserId=${igUserId}):`, err.message);
    return res.status(500).json({ error: 'Failed to process deletion request' });
  }

  // Meta requires an ABSOLUTE url here. With FRONTEND_URL unset this used to
  // emit a relative "/data-deletion?code=..." which Meta rejects.
  const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const statusUrl = `${base}/data-deletion?code=${confirmationCode}`;

  let erasure;
  try {
    erasure = await eraseInstagramUserData(igUserId);
    await prisma.deletionRequest.update({
      where: { id: request.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    console.log(
      `[DataDeletion] Processed deletion request (igUserId=${igUserId}, accounts removed: ${erasure.accountsRemoved}, ref: ${confirmationCode}).`
    );
  } catch (err) {
    console.error(`[DataDeletion] Deletion failed (igUserId=${igUserId}):`, err.message);
    await prisma.deletionRequest
      .update({ where: { id: request.id }, data: { status: 'FAILED' } })
      .catch(() => {});
    return res.status(500).json({ error: 'Failed to process deletion request' });
  }

  // Only for a REAL deletion. A retry that finds nothing left to erase
  // (Meta retries this callback) must not re-notify or re-evict anyone.
  if (erasure.accountsRemoved > 0) {
    for (const note of erasure.notifications) {
      // Evict the account everywhere, the same way in-app account deletion
      // does — but only when the User row itself was actually removed. There
      // is no req.session here (Meta calls this server-to-server), so this
      // goes through the Postgres session store directly rather than
      // req.session.destroy().
      if (note.userDeleted) {
        await destroyUserSessions(note.userId).catch((err) =>
          console.error('[DataDeletion] Session cleanup failed for a deleted user:', err.message)
        );
        disconnectUserSockets(note.userId);
      }

      if (note.email) {
        try {
          await mailer.sendDeletionConfirmation(note.email, {
            igUsername: note.igUsername,
            accountDeleted: note.userDeleted,
            confirmationCode,
            statusUrl,
          });
        } catch (mailErr) {
          // The deletion already committed and is irreversible either way —
          // a failed notification must not look like a failed deletion, and
          // Meta still needs its 200.
          console.error('[DataDeletion] Confirmation email failed to send:', mailErr.message);
        }
      }
    }
  }

  return res.json({
    url: statusUrl,
    confirmation_code: confirmationCode,
  });
});

// ============================================
// POST /data-deletion/deauthorize
//
// Meta's Deauthorize Callback, fired when a user removes Codeback from
// Instagram's settings. Same signed_request contract as deletion, so the
// same verification (verifySignedRequest, above — there has never been a
// second implementation of it).
//
// This DISCONNECTS rather than deletes: removing an app's permission is not
// itself a request to erase message history. NO EMAIL is sent from this
// route — Meta sends the Data Deletion Request Callback for the same event
// immediately after, and THAT route sends the confirmation once the erasure
// actually happens. Emailing "nothing has been deleted" from here would be
// false by the time the user reads it.
// ============================================
router.post('/deauthorize', async (req, res) => {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appSecret) {
    console.error('[Deauthorize] Rejected: INSTAGRAM_APP_SECRET is not configured; cannot verify requests.');
    return res.status(503).json({ error: 'Deauthorization is not set up on this server.' });
  }

  const { payload, reason } = verifySignedRequest(req.body?.signed_request, appSecret);
  if (!payload) {
    console.warn(`[Deauthorize] Rejected request: ${reason}.`);
    // Diagnostic for the "missing_field" case specifically — this is the one
    // that means req.body.signed_request itself was absent or not a string,
    // which the reason tag alone doesn't explain. Shape only, never values:
    // key NAMES (never their contents), and only the two headers that can't
    // carry anything sensitive. No signed_request, no tokens, no IDs.
    if (reason === 'missing_field') {
      console.warn(
        `[Deauthorize] Request shape: method=${req.method} ` +
          `content-type=${req.get('content-type') || 'none'} ` +
          `content-length=${req.get('content-length') || 'none'} ` +
          `bodyKeys=[${Object.keys(req.body || {}).join(',')}] ` +
          `queryKeys=[${Object.keys(req.query || {}).join(',')}]`
      );
    }
    return res.status(400).json({ error: 'Invalid signed_request' });
  }

  const igUserId = payload.user_id;
  if (!igUserId) {
    console.warn('[Deauthorize] Rejected request: signed_request had no user_id.');
    return res.status(400).json({ error: 'signed_request did not identify a user' });
  }

  try {
    const accounts = await prisma.instagramAccount.findMany({
      where: { igUserId: String(igUserId), connectionStatus: 'CONNECTED' },
      select: { id: true },
    });

    for (const account of accounts) {
      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: {
          connectionStatus: 'DISCONNECTED',
          disconnectedAt: new Date(),
          tokenStatus: 'NEEDS_RECONNECT',
          // The token is already dead on Meta's side. Do not keep it.
          accessToken: 'deauthorized',
          tokenCiphertext: null,
          tokenIv: null,
          tokenAuthTag: null,
        },
      });
    }

    console.log(`[Deauthorize] Disconnected accounts (igUserId=${igUserId}, count=${accounts.length}).`);
    // Meta expects a 200; anything else invites retries.
    return res.json({ success: true, disconnected: accounts.length });
  } catch (err) {
    console.error(`[Deauthorize] Failed (igUserId=${igUserId}):`, err.message);
    return res.status(500).json({ error: 'Failed to process deauthorization' });
  }
});

// ============================================
// GET /data-deletion/status
// ============================================
router.get('/status', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : null;

  if (!code) {
    return res.status(400).json({ error: 'A confirmation code is required.' });
  }

  const request = await prisma.deletionRequest.findUnique({
    where: { code },
    select: { status: true, requestedAt: true, completedAt: true },
  });

  // An unknown code is genuinely unknown now, rather than being reported as
  // "completed" like every other string used to be.
  if (!request) {
    return res.status(404).json({
      status: 'unknown',
      message: 'No deletion request matches that confirmation code.',
    });
  }

  return res.json({
    status: request.status.toLowerCase(),
    requestedAt: request.requestedAt,
    completedAt: request.completedAt,
    message:
      'Instagram data deletion requests are processed immediately and irreversibly. ' +
      'If you need written confirmation, contact support with your confirmation code.',
  });
});

module.exports = router;
module.exports.parseSignedRequest = parseSignedRequest;
module.exports.verifySignedRequest = verifySignedRequest;
module.exports.eraseInstagramUserData = eraseInstagramUserData;
