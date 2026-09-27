/**
 * Small shared helpers: id shape checks, UTF-8 sizing, text normalisation.
 */

// Meta ids are numeric strings today; this accepts the conservative superset
// (letters, digits, _ . : -), bounded, so an id can never smuggle a path,
// query string or whitespace into a Graph URL or a log line.
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

function isId(value) {
  return (typeof value === 'string' || typeof value === 'number') && ID_RE.test(String(value));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function utf8Bytes(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

/**
 * Canonical form for comparing human text: Unicode NFKC (full-width and
 * compatibility forms fold together), lower-cased, whitespace collapsed and
 * trimmed. Emoji and non-Latin scripts pass through untouched.
 */
function normalizeText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** Meta timestamps arrive in seconds or milliseconds; same rule as the DM path. */
function toDate(value, fallback = new Date()) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return new Date(n > 1e11 ? n : n * 1000);
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

module.exports = { ID_RE, isId, isUuid, utf8Bytes, normalizeText, pickRandom, toDate };
