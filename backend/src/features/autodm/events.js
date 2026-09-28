/**
 * Live updates for the Auto DM screens. Own event names (`autodm:*`), sent
 * only to the owning user's room via the existing lib/socket.js helper.
 * Ids and statuses only — never comment or message text.
 */

const { emitToUser } = require('../../lib/socket');

function runPayload(run) {
  return {
    runId: run.id,
    automationId: run.automationId,
    status: run.status,
    updatedAt: run.updatedAt || new Date(),
  };
}

function emitRunCreated(run) {
  try {
    emitToUser(run.userId, 'autodm:run_created', runPayload(run));
  } catch {
    /* live updates are best-effort */
  }
}

function emitRunUpdated(run) {
  try {
    emitToUser(run.userId, 'autodm:run_updated', runPayload(run));
  } catch {
    /* live updates are best-effort */
  }
}

module.exports = { emitRunCreated, emitRunUpdated };
