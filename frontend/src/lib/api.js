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

/** Get the currently logged-in user's info */
export async function getMe(userId) {
  const url = userId ? `/auth/me?user_id=${encodeURIComponent(userId)}` : '/auth/me';
  const { data } = await api.get(url);
  return data;
}

/** Log out the current user */
export async function logout() {
  const { data } = await api.post('/auth/logout');
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

/** Disconnect an Instagram account */
export async function disconnectAccount(accountId) {
  const { data } = await api.delete(`/api/accounts/${accountId}`);
  return data;
}

// ---- Conversations ----

/** Sync conversations directly from Instagram API */
export async function syncConversations() {
  const { data } = await api.post('/api/conversations/sync');
  return data;
}

/** List all conversations (optionally filtered by accountId and category) */
export async function getConversations(accountId, category) {
  const params = new URLSearchParams();
  if (accountId) params.append('accountId', accountId);
  if (category) params.append('category', category);
  
  const queryString = params.toString();
  const url = queryString ? `/api/conversations?${queryString}` : '/api/conversations';
  const { data } = await api.get(url);
  return data;
}

/** Get messages for a conversation */
export async function getMessages(conversationId) {
  const { data } = await api.get(`/api/conversations/${conversationId}/messages`);
  return data;
}

/** Send a reply in a conversation */
export async function sendReply(conversationId, text) {
  const { data } = await api.post(`/api/conversations/${conversationId}/reply`, { text });
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
