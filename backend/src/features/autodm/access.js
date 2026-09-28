/**
 * Who may use Auto DM — ONE function, used everywhere: the status route and
 * sidebar, the API, the Instagram connect scope, both subscribe calls, comment
 * intake, taps, the worker and the poller.
 *
 *   hasAutoDmAccess(user) =
 *     AUTODM_ENABLED
 *     AND ( mode = EVERYONE
 *           OR ( mode = BETA AND ( the user has an AutoDmAccess row
 *                                  OR their email is in AUTODM_SCOPE_ALLOWLIST ) ) )
 *
 * The rollout mode (OFF | BETA | EVERYONE, default OFF) is the app_settings
 * row `autodm_rollout_mode`, set from the admin page /admin/autodm. It is not
 * registered in lib/settings.js DEFINITIONS on purpose: the generic settings
 * editor only knows booleans and numbers, and this module owns the value.
 *
 * Revoking access is immediate for grants (no cache) and within MODE_TTL_MS
 * for mode changes on other pods. No data is ever deleted by a revoke.
 *
 * Kill switch off → false before any database query.
 */

const prisma = require('../../lib/prisma');
const config = require('./config');
const log = require('./log');

const MODES = Object.freeze(['OFF', 'BETA', 'EVERYONE']);
const MODE_KEY = 'autodm_rollout_mode';
const MODE_TTL_MS = 10 * 1000;

let modeCache = { value: 'OFF', at: 0 };

const isMode = (v) => typeof v === 'string' && MODES.includes(v);

/** The current rollout mode (cached briefly). Any read problem = the last known value, else OFF. */
async function getRolloutMode() {
  const now = Date.now();
  if (now - modeCache.at < MODE_TTL_MS) return modeCache.value;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: MODE_KEY } });
    const value = row && isMode(row.value) ? row.value : 'OFF';
    modeCache = { value, at: now };
    return value;
  } catch (err) {
    log.error(`could not read the rollout mode (${err && err.code ? err.code : 'error'}); using ${modeCache.value}`);
    return modeCache.at ? modeCache.value : 'OFF';
  }
}

/** Admin only (routes/admin via adminRoutes.js). Returns { before, after }. */
async function setRolloutMode(mode, adminId = null) {
  if (!isMode(mode)) {
    const err = new Error('invalid rollout mode');
    err.code = 'INVALID_MODE';
    throw err;
  }
  const row = await prisma.appSetting.findUnique({ where: { key: MODE_KEY } });
  const before = row && isMode(row.value) ? row.value : 'OFF';
  await prisma.appSetting.upsert({
    where: { key: MODE_KEY },
    create: { key: MODE_KEY, value: mode, updatedBy: adminId },
    update: { value: mode, updatedBy: adminId },
  });
  modeCache = { value: mode, at: Date.now() };
  return { before, after: mode };
}

/** Tests only: forget the cached mode (the DB is reset between tests). */
function resetAccessCache() {
  modeCache = { value: 'OFF', at: 0 };
}

async function hasGrant(userId) {
  if (!userId) return false;
  const row = await prisma.autoDmAccess.findUnique({ where: { userId }, select: { id: true } });
  return Boolean(row);
}

/** A named beta user: an access row, or the env allowlist (bootstrap). */
async function isBetaUser(user) {
  if (!user) return false;
  if (config.isOnAllowlist(user.email)) return true;
  return hasGrant(user.id);
}

/**
 * @param {{ id?: string, email?: string|null } | null} user
 * @returns {Promise<boolean>}
 */
async function hasAutoDmAccess(user) {
  if (!config.isEnabled()) return false;
  if (!user || (!user.id && !user.email)) return false;
  const mode = await getRolloutMode();
  if (mode === 'EVERYONE') return true;
  if (mode !== 'BETA') return false;
  return isBetaUser(user);
}

module.exports = {
  MODES,
  MODE_KEY,
  getRolloutMode,
  setRolloutMode,
  resetAccessCache,
  hasAutoDmAccess,
  isBetaUser,
};
