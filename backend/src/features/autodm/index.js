/**
 * Auto DM (comment-to-DM) — the ONLY entry point the rest of the codebase
 * uses. Everything Auto DM does lives in this folder; the existing code calls
 * the handful of functions below (docs/autodm/GATE_LOG.md lists every touch
 * point). Removing the feature = deleting this folder plus those few lines.
 *
 * Fail-safe contract: nothing here throws into its caller, except
 * handleCommentEntry when the caller asks for it (a delivery made only of
 * comments), so the durable webhook inbox retries it.
 *
 * Kill switch (AUTODM_ENABLED=false): handleCommentEntry, isAutoDmInteraction
 * and handlePostback return before any database query; the loop idles;
 * connectScopeOptions returns undefined and afterInstagramConnect does
 * nothing, so the connect flow is byte-identical to before.
 */

const config = require('./config');
const intake = require('./intake');
const interaction = require('./interaction');
const connect = require('./connect');
const worker = require('./worker');

module.exports = {
  config,

  // metaWebhookProcessor.processEntry
  isCommentOnlyEntry: intake.isCommentOnlyEntry,
  isCommentOnlyDelivery: intake.isCommentOnlyDelivery,
  handleCommentEntry: intake.handleCommentEntry,
  isAutoDmPostback: interaction.isAutoDmPostback,
  handlePostback: interaction.handlePostback,

  // metaWebhookProcessor.handleIncomingMessage (the seam)
  isAutoDmInteraction: interaction.isAutoDmInteraction,

  // routes/auth.js (Instagram connect)
  connectScopeOptions: connect.connectScopeOptions,
  afterInstagramConnect: connect.afterInstagramConnect,

  // routes/admin.js (re-subscribe webhooks)
  afterAdminResubscribe: connect.afterAdminResubscribe,

  // jobs/index.js
  startLoop: worker.startLoop,
  stopLoop: worker.stopLoop,
  runCleanup: (...args) => require('./cleanup').runCleanup(...args),

  // src/index.js
  get apiRouter() {
    return require('./routes');
  },
  get publicRouter() {
    return require('./publicRoutes');
  },
};
