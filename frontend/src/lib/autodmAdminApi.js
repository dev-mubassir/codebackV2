/**
 * Admin — Auto DM rollout control. Uses the shared axios instance (admin
 * session cookie, the admin sign-out handling in ./api).
 */

import api from './api';

export async function getAutoDmAdmin() {
  const { data } = await api.get('/api/admin/autodm');
  return data;
}

/** Needs a recent step-up (the page wraps it in withStepUp). EVERYONE needs confirm: 'EVERYONE'. */
export async function setAutoDmMode(mode, reason, confirm) {
  const { data } = await api.put('/api/admin/autodm/mode', { mode, reason, ...(confirm ? { confirm } : {}) });
  return data;
}

export async function grantAutoDm(email, note) {
  const { data } = await api.post('/api/admin/autodm/grants', { email, note });
  return data;
}

export async function revokeAutoDm(userId, reason) {
  const { data } = await api.delete(`/api/admin/autodm/grants/${encodeURIComponent(userId)}`, { data: { reason } });
  return data;
}
