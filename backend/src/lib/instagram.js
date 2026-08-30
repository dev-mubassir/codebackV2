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
 * Build the Instagram OAuth authorization URL.
 * Uses Instagram Login (Business Login for Instagram) — no Facebook Page needed.
 *
 * `state` is required: it is the CSRF binding between the browser that
 * started the flow and the browser that returns to the callback. The caller
 * generates it, stores it on the session, and verifies it on return.
 */
function getAuthorizationUrl(appId, redirectUri, state) {
  // Request only what the product actually exercises, and only what can be
  // demonstrated on camera for App Review.
  //
  // instagram_business_manage_comments and instagram_business_content_publish
  // were previously requested but never used — there is no comment or
  // publishing code anywhere in this repo, and the webhook subscribes to
  // messages/message_reactions/messaging_seen only. Asking for permissions
  // with no demonstrable use case is a standard App Review rejection, and it
  // over-scopes every tenant's token in the meantime.
  const scopes = ['instagram_business_basic', 'instagram_business_manage_messages'].join(',');

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
  getAuthorizationUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchMyProfile,
  fetchUserProfile,
  subscribeToWebhooks,
  sendMessage,
};
