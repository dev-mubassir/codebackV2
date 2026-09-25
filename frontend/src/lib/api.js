/**
 * API client for communicating with the Codeback backend.
 * Configured with credentials so session cookies are sent automatically.
 */

import axios from 'axios';
import { BACKEND_URL } from './backendUrl';
import { broadcastSession, SESSION_EXPIRED_URL } from './sessionChannel';

const api = axios.create({
  baseURL: BACKEND_URL,
  withCredentials: true, // Send session cookies with every request
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Admin pages: an admin API call that comes back as "not an admin" (the
 * generic 404 — the backend answers every non-admin that way) or as an
 * expired admin session (401 ADMIN_SESSION_EXPIRED) sends the browser to the
 * admin sign-in. A 404 with any OTHER body is a real "that record no longer
 * exists" and is left to the page.
 */
function isAdminSignOut(error) {
  const res = error.response;
  if (!res) return null;
  const url = String(error.config?.url || '');
  if (!url.startsWith('/api/admin') || url.startsWith('/api/admin/login')) return null;
  if (res.status === 401 && res.data?.code === 'ADMIN_SESSION_EXPIRED') return 'expired';
  if (res.status === 404 && res.data?.error === 'Not found.') return 'signed-out';
  return null;
}

/**
 * Customer pages: the backend ended the session for inactivity (or at the
 * 7-day limit). Tell every other open tab, then go to login with a message
 * saying why — rather than each page's own catch bouncing to a bare /login.
 */
const CUSTOMER_SESSION_ENDED = new Set(['SESSION_IDLE_EXPIRED', 'SESSION_EXPIRED']);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      typeof window !== 'undefined' &&
      error.response?.status === 401 &&
      CUSTOMER_SESSION_ENDED.has(error.response.data?.code) &&
      !window.location.pathname.startsWith('/admin')
    ) {
      broadcastSession({ type: 'expired' });
      window.location.href = SESSION_EXPIRED_URL;
      return Promise.reject(error);
    }

    const reason = typeof window !== 'undefined' ? isAdminSignOut(error) : null;
    if (
      reason &&
      window.location.pathname.startsWith('/admin') &&
      window.location.pathname !== '/admin/login'
    ) {
      window.location.href = reason === 'expired' ? '/admin/login?expired=1' : '/admin/login';
    }
    return Promise.reject(error);
  }
);

// ---- Auth ----

/** Register a new account with email & password */
export async function register({ name, email, password, confirmPassword }) {
  const { data } = await api.post('/auth/register', { name, email, password, confirmPassword });
  return data;
}

/** Log in with email & password */
export async function login({ email, password }) {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

/** Get the currently logged-in user's info (identity is taken from the session cookie) */
export async function getMe() {
  const { data } = await api.get('/auth/me');
  return data;
}

/** When this session ends. A GET — asking does not count as activity. */
export async function getSessionStatus() {
  const { data } = await api.get('/auth/session');
  return data;
}

/** The heartbeat, sent only on real clicks, keystrokes and page changes. */
export async function sendActivity() {
  const { data } = await api.post('/auth/activity');
  return data;
}

/** Log out the current user */
export async function logout() {
  const { data } = await api.post('/auth/logout');
  return data;
}

/** Permanently delete user account */
export async function deleteAccount() {
  const { data } = await api.delete('/auth/account');
  return data;
}

/** Update user profile */
export async function updateProfile(profileData) {
  const { data } = await api.put('/auth/profile', profileData);
  return data;
}

// ---- Onboarding & Business Profile ----

/** Fetch onboarding status and profile */
export async function getOnboarding() {
  const { data } = await api.get('/api/onboarding');
  return data;
}

/** Save onboarding wizard data */
export async function saveOnboarding(onboardingData) {
  const { data } = await api.put('/api/onboarding', onboardingData);
  return data;
}

/** Get Business Profile */
export async function getBusinessProfile() {
  const { data } = await api.get('/api/settings/business-profile');
  return data;
}

/** Update Business Profile */
export async function updateBusinessProfile(profileData) {
  const { data } = await api.put('/api/settings/business-profile', profileData);
  return data;
}

/** Get the URL to start Instagram OAuth (redirect, not API call) */
export function getInstagramAuthUrl() {
  return `${BACKEND_URL}/auth/instagram`;
}

// ---- Accounts ----

/** List connected Instagram accounts */
export async function getAccounts() {
  const { data } = await api.get('/api/accounts');
  return data;
}

/**
 * Disconnect an Instagram account. By default this is a SOFT disconnect —
 * historical conversations/messages are preserved and reappear if the
 * account is reconnected. Pass purge=true for irreversible data deletion.
 */
export async function disconnectAccount(accountId, purge = false) {
  const url = purge ? `/api/accounts/${accountId}?purge=true` : `/api/accounts/${accountId}`;
  const { data } = await api.delete(url);
  return data;
}

// ---- Conversations ----

/** Sync conversations directly from Instagram API */
export async function syncConversations() {
  const { data } = await api.post('/api/conversations/sync');
  return data;
}

/** List all conversations (optionally filtered by accountId, category, priority, unread, important) */
export async function getConversations(accountId, category, extra = {}) {
  const params = new URLSearchParams();
  if (accountId) params.append('accountId', accountId);
  if (category) params.append('category', category);
  if (extra.priority) params.append('priority', extra.priority);
  if (extra.unread) params.append('unread', 'true');
  if (extra.important) params.append('important', 'true');

  const queryString = params.toString();
  const url = queryString ? `/api/conversations?${queryString}` : '/api/conversations';
  const { data } = await api.get(url);
  return data;
}

/** Get messages for a conversation (also marks it read server-side) */
export async function getMessages(conversationId) {
  const { data } = await api.get(`/api/conversations/${conversationId}/messages`);
  return data;
}

/** Explicitly mark a conversation read/unread */
export async function setConversationRead(conversationId, unread = false) {
  const { data } = await api.post(`/api/conversations/${conversationId}/read`, { unread });
  return data;
}

/** Get the latest AI analysis, summary, and brand deal for a conversation */
export async function getConversationAnalysis(conversationId) {
  const { data } = await api.get(`/api/conversations/${conversationId}/ai-analysis`);
  return data;
}

/**
 * Ask AI to draft a reply. This NEVER sends anything — it only returns text
 * for the creator to review/edit. Only sendReply() below actually sends.
 */
export async function generateReply(conversationId, instructions) {
  const { data } = await api.post(`/api/conversations/${conversationId}/generate-reply`, { instructions });
  return data;
}

/** Send a reply in a conversation — the ONLY call that reaches Instagram. */
export async function sendReply(conversationId, text, replyGenerationId) {
  const { data } = await api.post(`/api/conversations/${conversationId}/reply`, { text, replyGenerationId });
  return data;
}

/** Toggle or configure AI Auto-Reply for a specific conversation */
export async function toggleAutoReply(conversationId, autoReplyEnabled, autoReplyPrompt) {
  const { data } = await api.patch(`/api/conversations/${conversationId}/auto-reply`, {
    autoReplyEnabled,
    autoReplyPrompt,
  });
  return data;
}

/** Clear all message history in a conversation (keeps conversation thread & contact) */
export async function clearChat(conversationId) {
  const { data } = await api.delete(`/api/conversations/${conversationId}/messages`);
  return data;
}

/** Fully delete a conversation thread and all related records */
export async function deleteConversation(conversationId) {
  const { data } = await api.delete(`/api/conversations/${conversationId}`);
  return data;
}

/** List all conversations with their auto-reply status for the Settings page */
export async function getAutoReplyChats() {
  const { data } = await api.get('/api/settings/auto-reply-chats');
  return data;
}

// ---- Brand Deals ----

export async function getBrandDeals(status) {
  const url = status ? `/api/brand-deals?status=${encodeURIComponent(status)}` : '/api/brand-deals';
  const { data } = await api.get(url);
  return data;
}

/**
 * Re-fetch one contact's profile from Instagram and return the updated row.
 *
 * Called by <Avatar> when a stored profile picture URL fails to load, because
 * Instagram CDN URLs are signed and expire after a few days. The server
 * refuses to call Instagram more than once an hour per contact and answers 429
 * when it is too soon, so callers must treat a rejection as "keep the
 * fallback", not as an error worth surfacing.
 */
export async function refreshContactProfile(contactId) {
  const { data } = await api.post(`/api/contacts/${contactId}/refresh-profile`);
  return data;
}

export async function getBrandDeal(id) {
  const { data } = await api.get(`/api/brand-deals/${id}`);
  return data;
}

export async function updateBrandDealStatus(id, status) {
  const { data } = await api.patch(`/api/brand-deals/${id}`, { status });
  return data;
}

// ---- Notifications ----

export async function getNotifications() {
  const { data } = await api.get('/api/notifications');
  return data;
}

export async function markNotificationRead(id) {
  const { data } = await api.post(`/api/notifications/${id}/read`);
  return data;
}

export async function markAllNotificationsRead() {
  const { data } = await api.post('/api/notifications/read-all');
  return data;
}

// ---- Reply settings ----

export async function getAISettings() {
  const { data } = await api.get('/api/settings/ai');
  return data;
}

export async function updateAISettings(update) {
  const { data } = await api.put('/api/settings/ai', update);
  return data;
}


// ---- Dashboard & Analytics ----

export async function getDashboardSummary() {
  const { data } = await api.get('/api/dashboard/summary');
  return data;
}

export async function getAnalyticsSummary(timeRange = '24h') {
  const { data } = await api.get(`/api/analytics/summary?timeRange=${encodeURIComponent(timeRange)}`);
  return data;
}

// ---- Admin API Helpers ----
//
// Every admin mutation that changes a customer's state takes a written
// `reason`; the backend refuses it without one. Destructive ones also need a
// recent step-up (adminStepUp) — see app/admin/StepUp.js, which retries the
// action after asking for the password.

export async function adminLogin(email, password) {
  const { data } = await api.post('/api/admin/login', { email, password });
  return data;
}

export async function getAdminMe() {
  const { data } = await api.get('/api/admin/me');
  return data;
}

/** The admin UI's heartbeat. Only real clicks and keystrokes send it. */
export async function adminHeartbeat() {
  const { data } = await api.post('/api/admin/activity');
  return data;
}

export async function adminLogout() {
  const { data } = await api.post('/api/admin/logout');
  return data;
}

export async function adminStepUp(password) {
  const { data } = await api.post('/api/admin/step-up', { password });
  return data;
}

export async function changeAdminPassword(currentPassword, newPassword) {
  const { data } = await api.post('/api/admin/password', { currentPassword, newPassword });
  return data;
}

export async function getAdminStats() {
  const { data } = await api.get('/api/admin/stats');
  return data;
}

export async function getAdminUsers(search = '', page = 1, limit = 10) {
  const { data } = await api.get(`/api/admin/users?search=${encodeURIComponent(search)}&page=${page}&limit=${limit}`);
  return data;
}

export async function getAdminUserDetail(id) {
  const { data } = await api.get(`/api/admin/users/${id}`);
  return data;
}

export async function setUserSuspended(id, suspend, reason) {
  const { data } = await api.post(`/api/admin/users/${id}/suspend`, { suspend, reason });
  return data;
}

export async function getAdminAccounts(search = '', status = '') {
  const { data } = await api.get(`/api/admin/accounts?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`);
  return data;
}

export async function refreshAccountToken(id, reason) {
  const { data } = await api.post(`/api/admin/accounts/${id}/refresh-token`, { reason });
  return data;
}

export async function resubscribeAccountWebhook(id, reason) {
  const { data } = await api.post(`/api/admin/accounts/${id}/resubscribe-webhook`, { reason });
  return data;
}

export async function markAccountNeedsReconnect(id, reason) {
  const { data } = await api.post(`/api/admin/accounts/${id}/mark-needs-reconnect`, { reason });
  return data;
}

export async function getAdminWebhookLogs(limit = 50, status = '') {
  const { data } = await api.get(`/api/admin/logs/webhooks?limit=${limit}&status=${encodeURIComponent(status)}`);
  return data;
}

export async function pruneWebhookLogs(days, reason) {
  const { data } = await api.post('/api/admin/logs/prune', { days, reason });
  return data;
}

export async function getAdminAuditLogs(page = 1, limit = 50) {
  const { data } = await api.get(`/api/admin/logs/audit?page=${page}&limit=${limit}`);
  return data;
}

export async function supportSearch(query) {
  const { data } = await api.get(`/api/admin/support/search?q=${encodeURIComponent(query)}`);
  return data;
}

export async function getAdminHealth() {
  const { data } = await api.get('/api/admin/health');
  return data;
}

/** One minimal call to the active AI provider. Answers ok or a safe error code. */
export async function runAdminAiTest() {
  const { data } = await api.post('/api/admin/health/ai-test').catch((err) => {
    if (err.response?.data?.errorCode) return { data: err.response.data };
    throw err;
  });
  return data;
}

export async function getAdminSettings() {
  const { data } = await api.get('/api/admin/settings');
  return data;
}

export default api;

// ---- Password reset & email verification ----

/**
 * Ask for a reset link. Always resolves the same way whether or not the
 * address has an account — the backend returns an identical response either
 * way, and surfacing a difference here would reintroduce the account
 * enumeration the endpoint is designed to prevent.
 */
export async function forgotPassword(email) {
  const { data } = await api.post('/auth/forgot-password', { email });
  return data;
}

/** Complete a reset. Invalidates every other session for this account. */
export async function resetPassword({ token, password, confirmPassword }) {
  const { data } = await api.post('/auth/reset-password', { token, password, confirmPassword });
  return data;
}

/** Confirm an email address. POST, not GET — mail clients pre-fetch links. */
export async function verifyEmail(token) {
  const { data } = await api.post('/auth/verify-email', { token });
  return data;
}

/** Request another confirmation email for the logged-in account. */
export async function resendVerification() {
  const { data } = await api.post('/auth/resend-verification');
  return data;
}

/**
 * Start the free trial for an Instagram account that is ALREADY connected.
 * Resolves with { trialGranted, trialOutcome }. A refusal (spent trial,
 * unconfirmed email, nothing connected) rejects, with the same body on
 * err.response.data.
 */
export async function claimTrial() {
  const { data } = await api.post('/api/billing/trial/claim');
  return data;
}

/**
 * Turn the two early renewal reminder emails on or off. The expiry-day and
 * grace-final notices are not affected. Resolves with { nudgeEmails }.
 */
export async function setRenewalNudgeEmails(nudgeEmails) {
  const { data } = await api.put('/api/billing/reminders', { nudgeEmails });
  return data;
}

/** Attach an email to a legacy Instagram-created account that has none. */
export async function addEmail(email) {
  const { data } = await api.post('/auth/add-email', { email });
  return data;
}

/** Add a password to a Google-only account. */
export async function setPassword({ password, confirmPassword }) {
  const { data } = await api.post('/auth/set-password', { password, confirmPassword });
  return data;
}

/**
 * Send a message from /contact ('support') or /contact/enterprise ('enterprise').
 * Works logged out; when a session exists the backend attaches the account.
 */
export async function sendContactEnquiry(kind, payload) {
  if (kind !== 'support' && kind !== 'enterprise') throw new Error(`Unknown enquiry kind "${kind}"`);
  const { data } = await api.post(`/api/contact/${kind}`, payload);
  return data;
}

/** Where to send the browser to start Google sign-in. */
export function getGoogleAuthUrl() {
  return `${BACKEND_URL}/auth/google`;
}
