/**
 * Data deletion — the surface Meta App Review requires.
 *
 * Two entry points:
 *
 *   POST /data-deletion/instagram
 *     Meta's Data Deletion Request Callback. Meta posts a `signed_request`
 *     (base64url payload + HMAC-SHA256 over it, keyed with the app secret)
 *     identifying an Instagram user who asked for their data to be removed.
 *     We verify the signature, delete that account and everything hanging off
 *     it, and reply with the {url, confirmation_code} shape Meta expects.
 *
 *   GET /data-deletion/status
 *     The human-readable status URL referenced in that reply.
 *
 * This route is deliberately unauthenticated — Meta calls it server-to-server
 * with no session. The signature IS the authentication, so it is verified
 * exactly as strictly as the webhook's, including in non-production.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const prisma = require('../lib/prisma');
const { hashIgUserId } = require('../lib/igIdentity');
const email = require('../lib/email');

/** base64url -> Buffer (Meta uses URL-safe base64 without padding). */
function b64urlDecode(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

/**
 * Verify and parse Meta's signed_request.
 * Returns the payload object, or null if anything about it is wrong.
 */
function parseSignedRequest(signedRequest, appSecret) {
  if (!signedRequest || typeof signedRequest !== 'string' || !appSecret) return null;

  const [encodedSig, encodedPayload] = signedRequest.split('.');
  if (!encodedSig || !encodedPayload) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(encodedPayload).toString('utf8'));
  } catch {
    return null;
  }

  if (String(payload.algorithm).toUpperCase() !== 'HMAC-SHA256') return null;

  const expected = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
  const provided = b64urlDecode(encodedSig);

  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  return payload;
}

/**
 * Erase everything tied to one Instagram user id.
 *
 * Deleting the InstagramAccount cascades to contacts, conversations,
 * messages, AI analyses, summaries, brand deals and webhook logs (see
 * prisma/schema.prisma). If the owning user has no other connected account
 * left, the user record goes too — otherwise we would keep a profile for
 * someone who has asked to be forgotten.
 *
 * Returns the number of Instagram accounts removed.
 */
async function eraseInstagramUserData(igUserId) {
  // ALL rows for this Instagram id, not one. igUserId is no longer globally
  // unique — a disconnected row is retained as history, and a workspace
  // transfer leaves the previous owner's row behind. A deletion request from
  // Meta covers the person, not one link, so every row must go or their
  // message history survives the erasure they asked for.
  const accounts = await prisma.instagramAccount.findMany({
    where: { igUserId: String(igUserId) },
    select: { id: true, userId: true },
  });

  if (accounts.length === 0) return 0;

  await prisma.instagramAccount.deleteMany({
    where: { id: { in: accounts.map((a) => a.id) } },
  });

  // Each owning user loses their profile too, unless they still have another
  // connected account — otherwise we keep a profile for someone who asked to
  // be forgotten.
  const ownerIds = [...new Set(accounts.map((a) => a.userId))];
  for (const userId of ownerIds) {
    const remaining = await prisma.instagramAccount.count({ where: { userId } });
    if (remaining === 0) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  }

  return accounts.length;
}

// ============================================
// POST /data-deletion/instagram
// ============================================
router.post('/instagram', async (req, res) => {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appSecret) {
    console.error('[DataDeletion] INSTAGRAM_APP_SECRET is not configured; cannot verify requests.');
    return res.status(503).json({ error: 'Data deletion is not set up on this server.' });
  }

  const signedRequest = req.body?.signed_request;
  const payload = parseSignedRequest(signedRequest, appSecret);

  if (!payload) {
    console.warn('[DataDeletion] Rejected request: missing or invalid signed_request.');
    return res.status(400).json({ error: 'Invalid signed_request' });
  }

  const igUserId = payload.user_id;
  if (!igUserId) {
    return res.status(400).json({ error: 'signed_request did not identify a user' });
  }

  // The confirmation code is now PERSISTED. Previously it was generated per
  // call and stored nowhere, so the status endpoint returned a static
  // "completed" for any string at all — including one nobody had ever issued.
  // Meta requires a status URL that means something.
  //
  // Keyed by the same pseudonymised hash as the ledger, so the record itself
  // does not reveal which Instagram account requested deletion.
  const confirmationCode = crypto.randomBytes(12).toString('hex');
  const igUserIdHash = hashIgUserId(igUserId);

  let request;
  try {
    request = await prisma.deletionRequest.create({
      data: { code: confirmationCode, igUserIdHash, status: 'PROCESSING' },
    });
  } catch (err) {
    console.error('[DataDeletion] Could not record the request:', err.message);
    return res.status(500).json({ error: 'Failed to process deletion request' });
  }

  try {
    const removed = await eraseInstagramUserData(igUserId);
    await prisma.deletionRequest.update({
      where: { id: request.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    console.log(
      `[DataDeletion] Processed deletion request for IG user (accounts removed: ${removed}, ref: ${confirmationCode}).`
    );
  } catch (err) {
    console.error('[DataDeletion] Deletion failed:', err.message);
    await prisma.deletionRequest
      .update({ where: { id: request.id }, data: { status: 'FAILED' } })
      .catch(() => {});
    return res.status(500).json({ error: 'Failed to process deletion request' });
  }

  // Meta requires an ABSOLUTE url here. With FRONTEND_URL unset this used to
  // emit a relative "/data-deletion?code=..." which Meta rejects.
  const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  return res.json({
    url: `${base}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
});

// ============================================
// POST /data-deletion/deauthorize
//
// Meta's Deauthorize Callback. THIS DID NOT EXIST — `grep -ri deauth` over the
// whole repo returned nothing. Meta asks for this URL alongside the Data
// Deletion URL, and without it a user who removes Codeback from their
// Instagram settings left us holding a token we would keep trying to use,
// while the dashboard reported the account as healthy.
//
// Same signed_request contract as deletion, so the same verification. This
// DISCONNECTS rather than deletes: removing an app's permission is not a
// request to erase message history, and conflating the two would destroy data
// the user never asked us to destroy.
// ============================================
router.post('/deauthorize', async (req, res) => {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appSecret) {
    console.error('[Deauthorize] INSTAGRAM_APP_SECRET is not configured; cannot verify requests.');
    return res.status(503).json({ error: 'Deauthorization is not set up on this server.' });
  }

  const payload = parseSignedRequest(req.body?.signed_request, appSecret);
  if (!payload) {
    console.warn('[Deauthorize] Rejected request: missing or invalid signed_request.');
    return res.status(400).json({ error: 'Invalid signed_request' });
  }

  const igUserId = payload.user_id;
  if (!igUserId) {
    return res.status(400).json({ error: 'signed_request did not identify a user' });
  }

  try {
    const accounts = await prisma.instagramAccount.findMany({
      where: { igUserId: String(igUserId), connectionStatus: 'CONNECTED' },
      select: { id: true, igUsername: true, user: { select: { id: true, email: true } } },
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

      // Tell the user. Otherwise their DMs simply stop arriving and the only
      // symptom is silence.
      if (account.user?.email) {
        try {
          await email.sendTokenExpiry(account.user.email, {
            igUsername: account.igUsername,
            reconnectUrl: `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/dashboard`,
          });
        } catch (mailErr) {
          console.error('[Deauthorize] Notification email failed:', mailErr.message);
        }
      }
    }

    console.log(`[Deauthorize] Disconnected ${accounts.length} account(s) after deauthorization.`);
    // Meta expects a 200; anything else invites retries.
    return res.json({ success: true, disconnected: accounts.length });
  } catch (err) {
    console.error('[Deauthorize] Failed:', err.message);
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
module.exports.eraseInstagramUserData = eraseInstagramUserData;
