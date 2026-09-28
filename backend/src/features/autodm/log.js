/**
 * Every Auto DM log line carries the `[autodm]` prefix, and ONLY ids, statuses
 * and safe error codes — never tokens, payloads, comment text or message text.
 */

const PREFIX = '[autodm]';

module.exports = {
  info: (...args) => console.log(PREFIX, ...args),
  warn: (...args) => console.warn(PREFIX, ...args),
  error: (...args) => console.error(PREFIX, ...args),
};
