/**
 * The last 100 backend errors, in memory, for the admin health page (Gate 3).
 *
 * Captured from console.error — every route and job in this codebase already
 * reports its failures there — plus the final Express error handler. Each
 * entry is { message, route, at }.
 *
 * SANITISED, because an error line can carry things the admin panel must
 * never show:
 *   - first line only (a Prisma error's later lines dump query arguments,
 *     message text included);
 *   - quoted strings longer than 24 characters are cut (DM text inside an
 *     error, e.g. a Prisma argument echoed on the first line);
 *   - connection strings, key=… / token=… / Bearer … values and email
 *     addresses are masked;
 *   - 240 characters at most.
 * `route` is METHOD + path with no query string (where tokens could sit).
 *
 * In memory by design (single instance): a restart clears it. It is a
 * debugging aid, not an audit trail.
 */

const { AsyncLocalStorage } = require('async_hooks');
const util = require('util');

const MAX = 100;
const ring = [];
const requestContext = new AsyncLocalStorage();

function sanitize(text) {
  return String(text ?? '')
    .split('\n')[0]
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[db-url]')
    .replace(/https?:\/\/\S*[?&](key|token|access_token|api_key)=\S+/gi, '[url-with-secret]')
    .replace(/\b(key|token|secret|password|apikey|api_key|access_token)\s*[=:]\s*\S+/gi, '$1=[hidden]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [hidden]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(["'`])([^"'`]{24,})\1/g, '$1…$1')
    .slice(0, 240);
}

function recordError(message, route) {
  const ctx = requestContext.getStore();
  ring.push({
    message: sanitize(message),
    route: route || (ctx ? ctx.route : null),
    at: new Date().toISOString(),
  });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
}

function recentErrors() {
  return [...ring].reverse();
}

/** Express middleware: remembers METHOD + path (no query) for errors logged during this request. */
function captureRequestContext(req, res, next) {
  requestContext.run({ route: `${req.method} ${String(req.path || '').slice(0, 120)}` }, next);
}

let installed = false;
/** Tee console.error into the ring. Call once at boot. */
function installConsoleErrorCapture() {
  if (installed) return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args) => {
    try {
      recordError(util.format(...args));
    } catch {
      // never let the capture break logging
    }
    original(...args);
  };
}

function _reset() {
  ring.length = 0;
}

module.exports = { recordError, recentErrors, captureRequestContext, installConsoleErrorCapture, sanitize, _reset, MAX };
