/**
 * Instagram Graph API helper functions.
 * 
 * All Instagram Login (non-Facebook) API calls go through graph.instagram.com.
 * Reference: main.py in project root for the token exchange flow.
 */

const axios = require('axios');

const INSTAGRAM_GRAPH_URL = 'https://graph.instagram.com';
const INSTAGRAM_OAUTH_URL = 'https://api.instagram.com/oauth/access_token';

/**
 * The permissions this app actually uses. Exported so the OAuth callback can
 * compare them against what Meta reports as GRANTED — a user can untick a
 * permission on the consent screen, and without that comparison the connect
 * silently "succeeds" while no webhook will ever arrive.
 */
const REQUIRED_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'];

/**
 * Build the Instagram OAuth authorization URL.
 * Uses Instagram Login (Business Login for Instagram) — no Facebook Page needed.
 *
 * `state` is required: it is the CSRF binding between the browser that
 * started the flow and the browser that returns to the callback. The caller
 * generates it, stores it on the session, and verifies it on return.
 */
function getAuthorizationUrl(appId, redirectUri, state, { extraScopes = [] } = {}) {
  // Request only what the product actually exercises, and only what can be
  // demonstrated on camera for App Review.
  //
  // instagram_business_manage_comments and instagram_business_content_publish
  // were previously requested but never used — there is no comment or
  // publishing code anywhere in this repo, and the webhook subscribes to
  // messages/message_reactions/messaging_seen only. Asking for permissions
  // with no demonstrable use case is a standard App Review rejection, and it
  // over-scopes every tenant's token in the meantime.
  //
  // `extraScopes` is Auto DM's (src/features/autodm/connect.js): the comments
  // scope, for allowlisted users only. Without it the URL is unchanged.
  const scopes = REQUIRED_SCOPES.concat(extraScopes.filter((s) => !REQUIRED_SCOPES.includes(s))).join(',');

  return (
    `https://www.instagram.com/oauth/authorize` +
    `?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}`
  );
}

/**
 * Exchange an authorization code for a short-lived access token.
 * POST https://api.instagram.com/oauth/access_token (form-encoded body)
 * 
 * Returns: { access_token, user_id }
 */
async function exchangeCodeForToken(code, appId, appSecret, redirectUri) {
  const response = await axios.post(INSTAGRAM_OAUTH_URL, new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code: code,
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return response.data; // { access_token, user_id }
}

/**
 * Exchange a short-lived token for a long-lived token (60 days).
 * GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&...
 * 
 * Note: Uses ig_exchange_token (NOT fb_exchange_token) for Instagram Login tokens.
 * Returns: { access_token, token_type, expires_in }
 */
async function exchangeForLongLivedToken(shortLivedToken, appSecret) {
  const response = await axios.get(`${INSTAGRAM_GRAPH_URL}/access_token`, {
    params: {
      grant_type: 'ig_exchange_token',
      client_secret: appSecret,
      access_token: shortLivedToken,
    },
  });

  return response.data; // { access_token, token_type, expires_in }
}

/**
 * REFRESH a long-lived token (extends it by another 60 days).
 * GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
 *
 * NOT the same call as exchangeForLongLivedToken. That one uses
 * grant_type=ig_exchange_token, which expects a SHORT-lived token and rejects
 * an already-long-lived one. The admin "refresh token" button used it anyway,
 * so Meta rejected the call and the catch block then wrote
 * tokenStatus: 'NEEDS_RECONNECT' — meaning the one manual refresh control
 * most likely marked HEALTHY accounts broken.
 *
 * Meta requires the token to be at least 24 hours old and still valid.
 * Returns: { access_token, token_type, expires_in }
 */
async function refreshLongLivedToken(longLivedToken) {
  const response = await axios.get(`${INSTAGRAM_GRAPH_URL}/refresh_access_token`, {
    params: {
      grant_type: 'ig_refresh_token',
      access_token: longLivedToken,
    },
  });
  return response.data;
}

/**
 * Fetch the authenticated user's own profile.
 * GET https://graph.instagram.com/v22.0/me?fields=user_id,username,name,profile_picture_url
 */
async function fetchMyProfile(accessToken) {
  const response = await axios.get(`${INSTAGRAM_GRAPH_URL}/v22.0/me`, {
    params: {
      fields: 'id,user_id,username,name,profile_picture_url',
      access_token: accessToken,
    },
  });

  return response.data;
}

/**
 * Fetch a contact's profile by their Instagram Scoped ID (IGSID).
 * GET https://graph.instagram.com/v22.0/{IGSID}?fields=username,name,profile_pic
 * 
 * Used to get username/name/pic for message senders.
 */
async function fetchUserProfile(igsid, accessToken) {
  try {
    const response = await axios.get(`${INSTAGRAM_GRAPH_URL}/v22.0/${igsid}`, {
      params: {
        fields: 'username,name,profile_pic',
        access_token: accessToken,
      },
    });
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch profile for IGSID ${igsid}:`, error.response?.data || error.message);
    return null;
  }
}

/**
 * How long is left on a signed Instagram CDN URL, in milliseconds.
 *
 * Profile picture URLs look like
 *   https://scontent.cdninstagram.com/v/...&oe=6AAE70CA&...
 * where `oe` is the expiry as a HEX unix timestamp. Past it, the CDN answers
 * HTTP 403 and the avatar renders broken — which is why a stored URL cannot be
 * treated as permanent.
 *
 * Returns null when there is no URL or no readable `oe` (a URL shape we do not
 * recognise is not evidence that it expired, so callers must not treat null as
 * "expired"). Returns a negative number for a URL that has already expired.
 */
function signedUrlTimeRemaining(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/[?&]oe=([0-9A-Fa-f]+)/);
  if (!match) return null;

  const expirySeconds = parseInt(match[1], 16);
  if (!Number.isFinite(expirySeconds) || expirySeconds <= 0) return null;

  return expirySeconds * 1000 - Date.now();
}

/**
 * True when a stored profile picture URL is expired, or close enough that it
 * will be by the time anyone looks at it.
 *
 * A URL we cannot parse returns false: refreshing on every webhook because of
 * an unfamiliar URL shape would be a quota leak, and the 24-hour lastFetchedAt
 * rule in the webhook handler still covers that case.
 */
function isProfilePicExpiring(url, withinMs = 24 * 60 * 60 * 1000) {
  const remaining = signedUrlTimeRemaining(url);
  if (remaining === null) return false;
  return remaining <= withinMs;
}

/**
 * Subscribe an Instagram account to webhook events.
 * POST https://graph.instagram.com/v22.0/{IG_ID}/subscribed_apps
 * 
 * This tells Meta to send DMs, reactions, and read receipts to our webhook.
 */
async function subscribeToWebhooks(igUserId, accessToken) {
  const response = await axios.post(
    `${INSTAGRAM_GRAPH_URL}/v22.0/${igUserId}/subscribed_apps`,
    null,
    {
      params: {
        subscribed_fields: 'messages,message_reactions,messaging_seen',
        access_token: accessToken,
      },
    }
  );

  return response.data;
}

/**
 * Is this error Meta telling us the token is dead?
 *
 * Code 190 is OAuthException "invalid/expired access token". Subcodes 458/463
 * /467 are the reauthorization variants. Distinguishing these from a transient
 * failure is what lets the caller STOP RETRYING instead of burning quota on a
 * token that will never work again.
 */
function isTokenInvalidError(error) {
  const meta = error?.response?.data?.error;
  if (!meta) return false;
  if (meta.code === 190) return true;
  return [458, 459, 460, 463, 464, 467].includes(meta.error_subcode);
}

/**
 * Send a text message via the Instagram Messaging API.
 * POST https://graph.instagram.com/v22.0/me/messages
 * 
 * Body: { recipient: { id: IGSID }, message: { text: "..." } }
 * 
 * Important: Must be within the 24-hour messaging window for human-initiated conversations.
 */
async function sendMessage(recipientIgsid, text, accessToken) {
  const response = await axios.post(
    `${INSTAGRAM_GRAPH_URL}/v22.0/me/messages`,
    {
      recipient: { id: recipientIgsid },
      message: { text },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );

  return response.data;
}

module.exports = {
  REQUIRED_SCOPES,
  isTokenInvalidError,
  getAuthorizationUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  refreshLongLivedToken,
  fetchMyProfile,
  fetchUserProfile,
  signedUrlTimeRemaining,
  isProfilePicExpiring,
  subscribeToWebhooks,
  sendMessage,
};
