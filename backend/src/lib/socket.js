/**
 * Shared Socket.io accessor.
 *
 * Centralizes the io instance so any module (webhook handler, background
 * worker, routes) can emit real-time events without awkward per-file
 * setSocketIO() plumbing or relying on `req.app.get('io')` inside code paths
 * that don't have access to `req` (a real bug the old webhook handler had —
 * `handleIncomingMessage` tried to read `req.app.get('io')` despite never
 * receiving `req`, which threw on every single incoming message and was
 * silently swallowed by its surrounding try/catch).
 */

let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

function getIO() {
  return ioInstance;
}

/** Emit an event to everything owned by a given Codeback user. */
function emitToUser(userId, event, payload) {
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${userId}`).emit(event, payload);
}

module.exports = { setIO, getIO, emitToUser };
