/**
 * Runtime settings (app_settings), read through a short in-memory cache.
 *
 * Every key is declared here with its DEFAULT and its VALIDATION. The default
 * is what the code did before the setting existed, so an empty table changes
 * nothing. A stored value that fails validation is ignored in favour of the
 * default (and logged) rather than trusted — a bad row must not, say, set the
 * idle timeout to zero and log everyone out on every request.
 *
 * Cache: 30 seconds, per process. This is a single-instance deployment; an
 * admin edit therefore takes effect within 30 seconds, not instantly.
 *
 * A database error is NOT fatal here: the last cached value is kept if there
 * is one, else the default. Settings are read on hot paths (every
 * authenticated request) and must not turn a DB blip into an outage.
 */

const prisma = require('./prisma');

const CACHE_TTL_MS = 30 * 1000;

const isIntIn = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;

const DEFINITIONS = Object.freeze({
  // Minutes without ACTIVITY before a customer session ends (Gate 2). Only
  // mutating requests and POST /auth/activity count as activity.
  user_session_idle_minutes: { default: 30, valid: isIntIn(5, 1440) },
});

const cache = new Map(); // key -> { value, expiresAt }

function definitionOf(key) {
  const def = DEFINITIONS[key];
  if (!def) throw new Error(`settings: unknown key "${key}"`);
  return def;
}

async function getSetting(key) {
  const def = definitionOf(key);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  let value = def.default;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (row) {
      if (def.valid(row.value)) value = row.value;
      else console.error(`[Settings] Ignoring invalid stored value for ${key}; using the default.`);
    }
  } catch (err) {
    console.error(`[Settings] Could not read ${key}:`, err.message);
    if (hit) return hit.value; // stale beats default during a blip
  }

  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/** Test seam, and for Gate 7's editor to apply its own write immediately. */
function clearSettingsCache() {
  cache.clear();
}

module.exports = { getSetting, clearSettingsCache, DEFINITIONS, CACHE_TTL_MS };
