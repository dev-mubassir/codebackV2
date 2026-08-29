/**
 * API client for communicating with the Codeback backend.
 * Configured with credentials so session cookies are sent automatically.
 */

import axios from 'axios';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: BACKEND_URL,
  withCredentials: true, // Send session cookies with every request
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response &&
      error.response.status === 401 &&
      typeof window !== 'undefined' &&
      window.location.pathname.startsWith('/admin') &&
      window.location.pathname !== '/admin/login'
    ) {
      window.location.href = '/admin/login';
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

// ---- Creator AI Settings ----

export async function getAISettings() {
  const { data } = await api.get('/api/settings/ai');
  return data;
}

export async function updateAISettings(update) {
  const { data } = await api.put('/api/settings/ai', update);
  return data;
}

// ---- Subscription & Usage ----

export async function getSubscription() {
  const { data } = await api.get('/api/subscription');
  return data;
}

export async function getUsage() {
  const { data } = await api.get('/api/usage');
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

export async function adminLogin(username, password) {
  const { data } = await api.post('/api/admin/login', { username, password });
  return data;
}

export async function getAdminMe() {
  const { data } = await api.get('/api/admin/me');
  return data;
}

export async function adminLogout() {
  const { data } = await api.post('/api/admin/logout');
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

export async function toggleUserSuspension(id, suspend) {
  const { data } = await api.post(`/api/admin/users/${id}/suspend`, { suspend });
  return data;
}

export async function deleteUserAdmin(id) {
  const { data } = await api.delete(`/api/admin/users/${id}`);
  return data;
}

export async function impersonateUser(id) {
  const { data } = await api.post(`/api/admin/users/${id}/impersonate`);
  return data;
}

export async function exitImpersonation() {
  const { data } = await api.post('/api/admin/impersonate/exit');
  return data;
}

export async function getAdminAccounts(search = '', status = '') {
  const { data } = await api.get(`/api/admin/accounts?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`);
  return data;
}

export async function refreshAccountToken(id) {
  const { data } = await api.post(`/api/admin/accounts/${id}/refresh-token`);
  return data;
}

export async function resubscribeAccountWebhook(id) {
  const { data } = await api.post(`/api/admin/accounts/${id}/resubscribe-webhook`);
  return data;
}

export async function disconnectAccountAdmin(id) {
  const { data } = await api.delete(`/api/admin/accounts/${id}`);
  return data;
}

export async function getAdminWebhookLogs(limit = 50, status = '') {
  const { data } = await api.get(`/api/admin/logs/webhooks?limit=${limit}&status=${encodeURIComponent(status)}`);
  return data;
}

export async function pruneWebhookLogs(days = 30) {
  const { data } = await api.post('/api/admin/logs/prune', { days });
  return data;
}

export async function getAdminAuditLogs() {
  const { data } = await api.get('/api/admin/logs/audit');
  return data;
}

export async function supportSearch(query) {
  const { data } = await api.get(`/api/admin/support/search?q=${encodeURIComponent(query)}`);
  return data;
}

export async function getSupportConversation(id) {
  const { data } = await api.get(`/api/admin/support/conversations/${id}`);
  return data;
}

export async function getAdminSettings() {
  const { data } = await api.get('/api/admin/settings');
  return data;
}

export default api;
