/**
 * Runtime settings and kill switches (app_settings), read through a short
 * in-memory cache.
 *
 * Every key is declared here with its DEFAULT and its VALIDATION. The default
 * is what the code did before the setting existed — so an empty table changes
 * nothing in production (Gate 7 rule: defaults match current behaviour). A
 * stored value that fails validation is ignored in favour of the default (and
 * logged) rather than trusted: a bad row must not, say, set the idle timeout
 * to zero and log everyone out on every request.
 *
 * Two ways to read:
 *   getSetting(key)      async; refreshes from the DB when the 30s cache is stale
 *   getSettingSync(key)  sync; the cached value, else the default — for hot,
 *                        synchronous callers (isBillingEnabled). A background
 *                        refresher (startSettingsRefresher, every 30s) keeps
 *                        the cache current in the running server.
 *
 * Cache: 30 seconds, per process (single instance). An admin edit takes effect
 * within 30 seconds; the editor clears the cache so its own process sees it now.
 *
 * A database error is NOT fatal: the last cached value is kept if there is
 * one, else the default. Settings are read on hot paths and must not turn a
 * DB blip into an outage.
 */

const prisma = require('./prisma');

const CACHE_TTL_MS = 30 * 1000;

const isIntIn = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const isNumIn = (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isBool = (v) => typeof v === 'boolean';

/**
 * group: 'flag' (kill switches — step-up to change), 'session', 'alert'.
 * default may be a function (evaluated at read time).
 */
const DEFINITIONS = Object.freeze({
  // ---- Kill switches (Gate 7). Defaults = current production behaviour. ----
  ai_classification_enabled: {
    group: 'flag', default: true, valid: isBool,
    label: 'AI classification and automatic replies',
  },
  signups_enabled: {
    group: 'flag', default: true, valid: isBool,
    label: 'New sign-ups (email and Google)',
  },
  maintenance_mode: {
    group: 'flag', default: false, valid: isBool,
    label: 'Maintenance mode (customer app answers "back soon"; webhooks keep working)',
  },
  enforce_subscriptions: {
    group: 'flag',
    // Until an admin sets it, it follows the BILLING_ENABLED env var exactly
    // as before — read at call time, so nothing changes by default.
    default: () => process.env.BILLING_ENABLED === 'true',
    valid: isBool,
    label: 'Enforce plans and trials (billing)',
  },

  // ---- Sessions (Gate 2) ----
  user_session_idle_minutes: {
    group: 'session', default: 30, valid: isIntIn(5, 1440),
    label: 'Customer sign-out after this many idle minutes',
  },

  // ---- Alert thresholds (Gate 7) ----
  alert_ai_error_rate_pct: { group: 'alert', default: 20, valid: isNumIn(1, 100), label: 'AI error rate over 15 minutes above (%)' },
  alert_ai_daily_cost_usd: { group: 'alert', default: 5, valid: isNumIn(0.01, 100000), label: 'AI cost today above (USD, estimated)' },
  alert_user_usage_multiplier: { group: 'alert', default: 5, valid: isNumIn(1.5, 1000), label: "One customer's AI calls today above this many times their 7-day daily average" },
  alert_no_webhook_hours: { group: 'alert', default: 6, valid: isNumIn(0.5, 168), label: 'No Meta deliveries for this many hours (while accounts are connected)' },
  alert_db_ping_ms: { group: 'alert', default: 500, valid: isIntIn(10, 60000), label: 'Database ping above (ms)' },
});

const cache = new Map(); // key -> { value, expiresAt }

function definitionOf(key) {
  const def = DEFINITIONS[key];
  if (!def) throw new Error(`settings: unknown key "${key}"`);
  return def;
}

const defaultOf = (def) => (typeof def.default === 'function' ? def.default() : def.default);

async function getSetting(key) {
  const def = definitionOf(key);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value === undefined ? defaultOf(def) : hit.value;

  // `undefined` in the cache means "no row" — the default is re-evaluated at
  // every read, so an env-derived default still follows the env.
  let value;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (row) {
      if (def.valid(row.value)) value = row.value;
      else console.error(`[Settings] Ignoring invalid stored value for ${key}; using the default.`);
    }
  } catch (err) {
    console.error(`[Settings] Could not read ${key}:`, err.message);
    if (hit) return hit.value === undefined ? defaultOf(def) : hit.value; // stale beats default during a blip
  }

  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value === undefined ? defaultOf(def) : value;
}

/** Cached value (even if stale), else the default. Never touches the DB. */
function getSettingSync(key) {
  const def = definitionOf(key);
  const hit = cache.get(key);
  return hit && hit.value !== undefined ? hit.value : defaultOf(def);
}

/** Every setting with its effective value, default and source — for the admin editor. */
async function listSettings() {
  const rows = await prisma.appSetting.findMany();
  const stored = new Map(rows.map((r) => [r.key, r]));
  return Object.entries(DEFINITIONS).map(([key, def]) => {
    const row = stored.get(key);
    const valid = row && def.valid(row.value);
    return {
      key,
      group: def.group,
      label: def.label,
      value: valid ? row.value : defaultOf(def),
      defaultValue: defaultOf(def),
      source: valid ? 'admin' : 'default',
      updatedAt: row ? row.updatedAt : null,
      updatedBy: row ? row.updatedBy : null,
    };
  });
}

/** Validate and store. Returns { before, after }. Throws on an invalid value. */
async function setSetting(key, value, adminId) {
  const def = definitionOf(key);
  if (!def.valid(value)) {
    const err = new Error(`Invalid value for ${key}`);
    err.code = 'INVALID_SETTING';
    throw err;
  }
  const before = await getSetting(key);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value, updatedBy: adminId }, update: { value, updatedBy: adminId } });
  // Write-through, never delete: a synchronous reader (isBillingEnabled)
  // must not see the default in between.
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return { before, after: value };
}

/** Put a setting back to its default (deletes the row). */
async function resetSetting(key) {
  definitionOf(key);
  const before = await getSetting(key);
  await prisma.appSetting.deleteMany({ where: { key } });
  cache.set(key, { value: undefined, expiresAt: Date.now() + CACHE_TTL_MS });
  return { before, after: defaultOf(DEFINITIONS[key]) };
}

async function refreshAllSettings() {
  // Expire rather than clear: the stale values keep serving getSettingSync
  // until each fresh read lands.
  for (const hit of cache.values()) hit.expiresAt = 0;
  await Promise.all(Object.keys(DEFINITIONS).map((k) => getSetting(k)));
}

function startSettingsRefresher({ intervalMs = CACHE_TTL_MS } = {}) {
  refreshAllSettings().catch((err) => console.error('[Settings] Initial load failed:', err.message));
  const timer = setInterval(() => {
    refreshAllSettings().catch((err) => console.error('[Settings] Refresh failed:', err.message));
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

/** Test seam only — production code writes through (setSetting/resetSetting). */
function clearSettingsCache() {
  cache.clear();
}

module.exports = {
  getSetting,
  getSettingSync,
  listSettings,
  setSetting,
  resetSetting,
  refreshAllSettings,
  startSettingsRefresher,
  clearSettingsCache,
  DEFINITIONS,
  CACHE_TTL_MS,
};
