/**
 * Who may use Auto DM — ONE function, used everywhere (status, API, connect
 * scope, subscribe calls, intake, taps, worker, poller).
 *
 * Kill switch off → false before any database query.
 */

const config = require('./config');

/**
 * @param {{ id?: string, email?: string|null } | null} user
 * @returns {Promise<boolean>}
 */
async function hasAutoDmAccess(user) {
  if (!config.isEnabled()) return false;
  if (!user) return false;
  return config.isScopeAllowed(user.email);
}

module.exports = { hasAutoDmAccess };
