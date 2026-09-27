/**
 * Auto DM (comment-to-DM) — the ONLY entry point the rest of the codebase
 * uses. Everything Auto DM does lives in this folder; the existing code calls
 * the handful of functions exported here (see docs/autodm/GATE_LOG.md for the
 * exact touch points). Removing the feature = deleting this folder plus those
 * few lines.
 *
 * Fail-safe contract: nothing exported here throws into its caller unless the
 * caller explicitly asked for it (comment-only deliveries, so the durable
 * webhook inbox retries them).
 */

const config = require('./config');

module.exports = {
  config,
  get apiRouter() {
    return require('./routes');
  },
  get publicRouter() {
    return require('./publicRoutes');
  },
};
