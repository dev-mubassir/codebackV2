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
  const account = await prisma.instagramAccount.findUnique({
    where: { igUserId: String(igUserId) },
    select: { id: true, userId: true },
  });

  if (!account) return 0;

  await prisma.instagramAccount.delete({ where: { id: account.id } });

  const remaining = await prisma.instagramAccount.count({ where: { userId: account.userId } });
  if (remaining === 0) {
    await prisma.user.delete({ where: { id: account.userId } }).catch(() => {});
  }

  return 1;
}

// ============================================
// POST /data-deletion/instagram
// ============================================
router.post('/instagram', async (req, res) => {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appSecret) {
    console.error('[DataDeletion] INSTAGRAM_APP_SECRET is not configured; cannot verify requests.');
    return res.status(503).json({ error: 'Data deletion is not configured on this server.' });
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

  // Confirmation code is for the user's own reference when contacting
  // support. Deletion is synchronous and irreversible, so there is no
  // pending state to look up.
  const confirmationCode = crypto.randomBytes(12).toString('hex');

  try {
    const removed = await eraseInstagramUserData(igUserId);
    console.log(
      `[DataDeletion] Processed deletion request for IG user (accounts removed: ${removed}, ref: ${confirmationCode}).`
    );
  } catch (err) {
    console.error('[DataDeletion] Deletion failed:', err.message);
    return res.status(500).json({ error: 'Failed to process deletion request' });
  }

  const base = process.env.FRONTEND_URL || '';
  return res.json({
    url: `${base}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
});

// ============================================
// GET /data-deletion/status
// ============================================
router.get('/status', (req, res) => {
  res.json({
    status: 'completed',
    message:
      'Instagram data deletion requests are processed immediately and irreversibly. ' +
      'If you need written confirmation, contact support with your confirmation code.',
  });
});

module.exports = router;
module.exports.parseSignedRequest = parseSignedRequest;
module.exports.eraseInstagramUserData = eraseInstagramUserData;
