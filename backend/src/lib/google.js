/**
 * Google OAuth (secondary login).
 *
 * Scopes are openid / email / profile and nothing else. Those are
 * non-sensitive, so Google's app verification review is not triggered. Adding
 * anything else changes that — don't.
 *
 * No google-auth-library dependency. The authorization-code flow is a
 * server-to-server exchange, so the profile is fetched from Google's userinfo
 * endpoint over TLS using the access token we just received directly from
 * Google. Nothing client-supplied is trusted, and there is no id_token
 * signature to verify because we never accept an id_token from the browser.
 *
 * The redirect URI is DERIVED from BACKEND_URL — the same public base URL the
 * Instagram flow already uses. A second env var for the same value is a second
 * thing to get wrong.
 */

const axios = require('axios');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

const SCOPES = ['openid', 'email', 'profile'];

/** Where Google sends the user back. Derived, never separately configured. */
function getRedirectUri() {
  const base = (process.env.BACKEND_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('BACKEND_URL is not set — cannot build the Google redirect URI.');
  return `${base}/auth/google/callback`;
}

function isConfigured() {
  return Boolean(
    (process.env.GOOGLE_CLIENT_ID || '').trim() && (process.env.GOOGLE_CLIENT_SECRET || '').trim()
  );
}

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    // Force the account chooser rather than silently reusing whichever Google
    // account the browser happens to be signed into.
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const { data } = await axios.post(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return data; // { access_token, id_token, expires_in, ... }
}

/**
 * Fetch the profile.
 *
 * `email_verified` is the field that matters: the linking rules refuse to
 * auto-link a Google identity to a local account unless Google itself says the
 * address is verified. An unverified Google email is an unproven claim, and
 * treating it as proof would let anyone who can create a Google account with
 * someone's address take over the matching Codeback account.
 */
async function fetchProfile(accessToken) {
  const { data } = await axios.get(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return {
    providerAccountId: data.sub, // stable Google id; NOT the email
    email: typeof data.email === 'string' ? data.email.trim().toLowerCase() : null,
    emailVerified: data.email_verified === true,
    name: data.name || null,
  };
}

module.exports = {
  SCOPES,
  isConfigured,
  getRedirectUri,
  getAuthUrl,
  exchangeCodeForTokens,
  fetchProfile,
};
