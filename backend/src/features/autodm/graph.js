/**
 * Partly adapted from OpenReply (MIT) — lib/meta/client.ts
 * (sendPrivateReplyWithButton, sendDirectMessageWithButton, getUserFollowStatus).
 * Copyright (c) 2026 Anish Raj, Copyright (c) 2026 Diwen Huang.
 * See THIRD_PARTY_NOTICES.md.
 *
 * Every Graph API call Auto DM makes, and nothing else. graph.instagram.com
 * only (Instagram API with Instagram Login), same host and version as
 * lib/instagram.js.
 *
 * Calls go through the shared `axios` module object (axios.get / axios.post),
 * never a private instance, so the test suite's Meta boundary stub
 * (tests/helpers/fake-meta.js) intercepts them — no test can reach Meta.
 *
 * No URL here is ever built from user-supplied input except Meta's own ids,
 * which are shape-checked by the callers (no SSRF surface).
 */

const axios = require('axios');

const GRAPH = 'https://graph.instagram.com/v22.0';
const TIMEOUT_MS = 15 * 1000;

function auth(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ---------------------------------------------------------------------------
// Error classification. Callers store and log ONLY safeErrorCode(err).
// ---------------------------------------------------------------------------

function metaError(err) {
  return (err && err.response && err.response.data && err.response.data.error) || null;
}

/** e.g. META_100_2534022, HTTP_500, NETWORK — never Meta's message text. */
function safeErrorCode(err) {
  const meta = metaError(err);
  if (meta && Number.isFinite(Number(meta.code))) {
    return meta.error_subcode ? `META_${meta.code}_${meta.error_subcode}` : `META_${meta.code}`;
  }
  if (err && err.response && err.response.status) return `HTTP_${err.response.status}`;
  if (err && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND')) {
    return 'NETWORK';
  }
  if (err && typeof err.autodmCode === 'string') return err.autodmCode;
  return 'INTERNAL';
}

// Meta's throttling codes: app/user/page-level limits, "too many calls", and
// 368 — the comment API's "temporarily blocked" answer (OpenReply).
const RATE_LIMIT_CODES = new Set([4, 17, 32, 368, 613, 80002, 80006]);

function isRateLimitError(err) {
  const meta = metaError(err);
  if (meta && RATE_LIMIT_CODES.has(Number(meta.code))) return true;
  return Boolean(err && err.response && err.response.status === 429);
}

/**
 * "Meta rejected something in the request body" — the signal to retry a
 * quick reply as plain text, or a button template as text + link.
 */
function isRejectedParam(err) {
  const meta = metaError(err);
  return Boolean(meta && Number(meta.code) === 100);
}

/**
 * A send whose outcome is UNKNOWN: the request may have reached Meta but no
 * answer came back (timeout, connection reset mid-request). Distinct from a
 * connection that was never made (DNS failure, refused), where nothing was
 * sent and a retry is safe.
 */
const UNCONFIRMED_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ERR_SOCKET_CONNECTION_TIMEOUT']);

function isUnconfirmedSendError(err) {
  if (!err || err.response) return false;
  if (UNCONFIRMED_CODES.has(err.code)) return true;
  return /socket hang up|timeout/i.test(String(err.message || ''));
}

function autodmError(code) {
  const e = new Error(code);
  e.autodmCode = code;
  return e;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/** A button template with ONE postback button (Meta caps: text 640, title 20). */
function postbackButtonMessage(text, title, payload) {
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: String(text).slice(0, 640),
        buttons: [{ type: 'postback', title: String(title).slice(0, 20), payload }],
      },
    },
  };
}

/** Private reply to a comment. Resolves Meta's { recipient_id, message_id }. */
async function sendPrivateReply(commentId, message, token) {
  const res = await axios.post(
    `${GRAPH}/me/messages`,
    { recipient: { comment_id: commentId }, message },
    { headers: auth(token), timeout: TIMEOUT_MS }
  );
  return res.data || {};
}

/** Private reply as a button template; tapping fires a messaging_postbacks webhook. */
function sendPrivateReplyWithButton(commentId, text, title, payload, token) {
  return sendPrivateReply(commentId, postbackButtonMessage(text, title, payload), token);
}

/** Public reply under a comment. */
async function replyToComment(commentId, text, token) {
  const res = await axios.post(`${GRAPH}/${encodeURIComponent(commentId)}/replies`, null, {
    params: { message: text },
    headers: { Authorization: `Bearer ${token}` },
    timeout: TIMEOUT_MS,
  });
  return res.data || {};
}

/** A Send API message to a person who has messaged us (the 24h window is open). */
async function sendMessage(igsid, message, token) {
  const res = await axios.post(
    `${GRAPH}/me/messages`,
    { recipient: { id: igsid }, message },
    { headers: auth(token), timeout: TIMEOUT_MS }
  );
  return res.data || {};
}

function sendText(igsid, text, token) {
  return sendMessage(igsid, { text }, token);
}

function sendImage(igsid, url, token) {
  return sendMessage(igsid, { attachment: { type: 'image', payload: { url } } }, token);
}

/** A DM with one postback button (the follow-gate re-prompt). */
function sendDirectMessageWithButton(igsid, text, title, payload, token) {
  return sendMessage(igsid, postbackButtonMessage(text, title, payload), token);
}

function sendButtonTemplate(igsid, text, url, title, token) {
  return sendMessage(
    igsid,
    {
      attachment: {
        type: 'template',
        payload: { template_type: 'button', text, buttons: [{ type: 'web_url', url, title }] },
      },
    },
    token
  );
}

/**
 * Does this person follow the business? true / false, or null when Meta does
 * not say (any error, or the field missing) — the caller decides what an
 * unverifiable answer means (OpenReply: fail open after a tap). Never throws.
 * User Profile API — consent exists because the person has just tapped/messaged.
 */
async function getFollowStatus(igsid, token) {
  try {
    const res = await axios.get(`${GRAPH}/${encodeURIComponent(igsid)}`, {
      params: { fields: 'is_user_follow_business' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: TIMEOUT_MS,
    });
    const value = res && res.data ? res.data.is_user_follow_business : undefined;
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

/** The account's recent posts and reels, for the post picker. */
async function listMedia(token, { limit = 24 } = {}) {
  const res = await axios.get(`${GRAPH}/me/media`, {
    params: {
      fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp',
      limit,
    },
    headers: { Authorization: `Bearer ${token}` },
    timeout: TIMEOUT_MS,
  });
  return Array.isArray(res.data && res.data.data) ? res.data.data : [];
}

/** When one media item was published (poller tiers). null if Meta does not say. */
async function getMediaTimestamp(mediaId, token) {
  const res = await axios.get(`${GRAPH}/${encodeURIComponent(mediaId)}`, {
    params: { fields: 'id,timestamp' },
    headers: { Authorization: `Bearer ${token}` },
    timeout: TIMEOUT_MS,
  });
  const ts = res.data && res.data.timestamp;
  const d = ts ? new Date(ts) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Top-level comments on one media item (poller), newest first per Meta. */
async function listComments(mediaId, token, { limit = 50 } = {}) {
  const res = await axios.get(`${GRAPH}/${encodeURIComponent(mediaId)}/comments`, {
    params: { fields: 'id,text,timestamp,username,from', limit },
    headers: { Authorization: `Bearer ${token}` },
    timeout: TIMEOUT_MS,
  });
  return Array.isArray(res.data && res.data.data) ? res.data.data : [];
}

/**
 * The SECOND subscribed_apps call, allowlisted users only: every existing
 * field plus `comments`. The first call (lib/instagram.js) is unchanged.
 */
async function subscribeWithComments(igUserId, token, fields) {
  const res = await axios.post(`${GRAPH}/${encodeURIComponent(igUserId)}/subscribed_apps`, null, {
    params: { subscribed_fields: fields, access_token: token },
    timeout: TIMEOUT_MS,
  });
  return res.data || {};
}

module.exports = {
  safeErrorCode,
  isRateLimitError,
  isRejectedParam,
  isUnconfirmedSendError,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  replyToComment,
  sendText,
  sendImage,
  sendDirectMessageWithButton,
  sendButtonTemplate,
  getFollowStatus,
  listMedia,
  getMediaTimestamp,
  listComments,
  subscribeWithComments,
};
