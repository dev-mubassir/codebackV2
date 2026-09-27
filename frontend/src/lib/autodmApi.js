/**
 * Auto DM API client. Uses the shared axios instance from ./api (session
 * cookie, maintenance and session-expiry handling) and adds nothing to it.
 */

import api from './api';

/** { enabled, available } — drives the sidebar item. Never cached server-side. */
export async function getAutoDmStatus() {
  const { data } = await api.get('/api/autodm/status');
  return data;
}

export async function getAutoDmAccounts() {
  const { data } = await api.get('/api/autodm/accounts');
  return data;
}

export async function getAutoDmMedia(accountId) {
  const { data } = await api.get(`/api/autodm/accounts/${encodeURIComponent(accountId)}/media`);
  return data;
}

export async function listAutomations(accountId) {
  const { data } = await api.get('/api/autodm/automations', { params: accountId ? { accountId } : {} });
  return data;
}

export async function getAutomation(id) {
  const { data } = await api.get(`/api/autodm/automations/${encodeURIComponent(id)}`);
  return data;
}

export async function createAutomation(body) {
  const { data } = await api.post('/api/autodm/automations', body);
  return data;
}

export async function updateAutomation(id, body) {
  const { data } = await api.put(`/api/autodm/automations/${encodeURIComponent(id)}`, body);
  return data;
}

export async function setAutomationStatus(id, status) {
  const { data } = await api.patch(`/api/autodm/automations/${encodeURIComponent(id)}/status`, { status });
  return data;
}

export async function deleteAutomation(id) {
  const { data } = await api.delete(`/api/autodm/automations/${encodeURIComponent(id)}`);
  return data;
}

export async function getAutomationRuns(id) {
  const { data } = await api.get(`/api/autodm/automations/${encodeURIComponent(id)}/runs`);
  return data;
}

/** Raw bytes; the server decides the type from the file's magic bytes. */
export async function uploadAutoDmImage(file) {
  const { data } = await api.post('/api/autodm/images', file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  return data;
}

/** The public URL Meta fetches — also used for the edit-screen preview. */
export function autoDmImageUrl(baseUrl, imageId) {
  return `${baseUrl}/public/autodm/images/${encodeURIComponent(imageId)}`;
}

/** The server's own message for a failed call, or a fallback. Plain text only. */
export function apiErrorMessage(err, fallback) {
  const msg = err && err.response && err.response.data && err.response.data.error;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}
