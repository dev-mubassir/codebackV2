/**
 * Customer session lifetime: an IDLE limit and an ABSOLUTE limit.
 *
 *   idle      `user_session_idle_minutes` (default 30, lib/settings.js) since
 *             the last ACTIVITY.
 *   absolute  7 days since sign-in, however active.
 *
 * ACTIVITY IS FAIL-CLOSED — the owner-approved mechanism:
 *   - a MUTATING request (POST/PUT/PATCH/DELETE) that passed the origin guard,
 *   - or the explicit POST /auth/activity heartbeat the app sends on real
 *     clicks, keystrokes and page changes (itself a mutating request).
 * A GET never counts. So background polling, refetch-on-focus, the dashboard
 * re-loading on every socket event, and Socket.io itself can never keep an
 * unattended session alive — and a background request someone forgets to
 * mark can only make a session end SOONER, never later.
 *
 * Enforced here, centrally, BEFORE routing — not only in requireAuth — because
 * some routes read req.session.userId directly (the Instagram connect start
 * and callback, the contact form). An expired session is destroyed and the
 * request continues as logged out; requireAuth then answers 401
 * SESSION_IDLE_EXPIRED (or SESSION_EXPIRED) so the app can say why.
 *
 * Sockets: a socket is bound to the session it connected with. The session
 * guard disconnects that session's sockets the moment it expires the session,
 * and a 60-second sweep catches sessions that went idle with no further HTTP
 * request at all (a tab left open on the inbox).
 *
 * NOT affected, by construction: webhooks, the AI worker, auto-replies and
 * every cron job. None of them has or reads a customer session.
 */

const prisma = require('./prisma');
const { getSetting } = require('./settings');
const { getIO } = require('./socket');

const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
// User.lastSeenAt ("last active" in the admin panel) is written from activity
// at most this often, so a busy user costs one extra UPDATE per 5 minutes.
const LAST_SEEN_WRITE_EVERY_MS = 5 * 60 * 1000;
const SOCKET_SWEEP_MS = 60 * 1000;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function idleLimitMs() {
  return (await getSetting('user_session_idle_minutes')) * 60 * 1000;
}

/** 'idle' | 'absolute' | null for a session carrying a userId. */
function expiryReason(sess, idleMs, now = Date.now()) {
  if (typeof sess.authenticatedAt === 'number' && now - sess.authenticatedAt > ABSOLUTE_MS) return 'absolute';
  if (typeof sess.lastActivityAt === 'number' && now - sess.lastActivityAt > idleMs) return 'idle';
  return null;
}

async function deadlines(sess, now = Date.now()) {
  const idleMs = await idleLimitMs();
  const last = typeof sess.lastActivityAt === 'number' ? sess.lastActivityAt : now;
  const start = typeof sess.authenticatedAt === 'number' ? sess.authenticatedAt : now;
  const idleExpiresAt = Math.min(last + idleMs, start + ABSOLUTE_MS);
  return {
    idleMinutes: idleMs / 60000,
    idleExpiresAt: new Date(idleExpiresAt).toISOString(),
    absoluteExpiresAt: new Date(start + ABSOLUTE_MS).toISOString(),
  };
}

/** Disconnect every live socket that authenticated with this session id. */
function disconnectSessionSockets(sid) {
  const io = getIO();
  if (!io || !sid) return 0;
  let n = 0;
  for (const socket of io.of('/').sockets.values()) {
    if (socket.data && socket.data.sid === sid) {
      socket.disconnect(true);
      n += 1;
    }
  }
  return n;
}

/** Mark this request as activity, and keep User.lastSeenAt roughly current. */
function recordActivity(req, now = Date.now()) {
  const sess = req.session;
  sess.lastActivityAt = now;
  if (!sess.lastSeenWrittenAt || now - sess.lastSeenWrittenAt >= LAST_SEEN_WRITE_EVERY_MS) {
    sess.lastSeenWrittenAt = now;
    prisma.user
      .update({ where: { id: sess.userId }, data: { lastSeenAt: new Date(now) } })
      .catch(() => {}); // a deleted user is requireAuth's business, not this one's
  }
}

/**
 * The guard. Mount after the customer session middleware and the origin
 * guard (so a blocked cross-site POST never counts as activity).
 */
function userSessionGuard() {
  return async function sessionIdleGuard(req, res, next) {
    const sess = req.session;
    if (!sess || !sess.userId) return next();

    let idleMs;
    try {
      idleMs = await idleLimitMs();
    } catch (err) {
      return next(err);
    }
    const now = Date.now();

    // Sessions minted before this shipped carry neither field. They get a
    // fresh window from their next request rather than being ended on the
    // spot by a deploy.
    if (typeof sess.lastActivityAt !== 'number') sess.lastActivityAt = now;
    if (typeof sess.authenticatedAt !== 'number') sess.authenticatedAt = now;

    const reason = expiryReason(sess, idleMs, now);
    if (reason) {
      const sid = req.sessionID;
      return sess.destroy(() => {
        disconnectSessionSockets(sid);
        res.clearCookie('codeback.sid');
        req.sessionExpired = reason;
        next();
      });
    }

    if (MUTATING.has(req.method)) recordActivity(req, now);
    return next();
  };
}

/** Called from io.on('connection'): refuse a socket whose session is already over. */
async function socketSessionIsLive(socket) {
  const sess = socket.request && socket.request.session;
  if (!sess || !sess.userId) return false;
  return expiryReason(sess, await idleLimitMs()) === null;
}

/**
 * One sweep over connected sockets. Each socket's session is re-read from
 * the store, because the copy attached at handshake time never changes.
 * Store-agnostic (Postgres in production, MemoryStore in tests).
 */
async function sweepIdleSockets({ io = getIO(), store } = {}) {
  if (!io || !store) return { checked: 0, disconnected: 0 };
  const idleMs = await idleLimitMs();
  const now = Date.now();
  const sockets = [...io.of('/').sockets.values()];
  let disconnected = 0;

  for (const socket of sockets) {
    const sid = socket.data && socket.data.sid;
    // A missing session and a store ERROR must not look alike: stores report
    // "missing" as null OR undefined (MemoryStore uses undefined), and a
    // missing session must disconnect, while an error should just retry.
    const { err, sess } = sid
      ? await new Promise((resolve) => store.get(sid, (e, s) => resolve({ err: e, sess: s || null })))
      : { err: null, sess: null };

    if (err) continue; // store error: try again next sweep
    const reason = !sess || !sess.userId ? 'gone' : expiryReason(sess, idleMs, now);
    if (!reason) continue;

    if (reason !== 'gone') await new Promise((resolve) => store.destroy(sid, () => resolve()));
    socket.disconnect(true);
    disconnected += 1;
  }
  return { checked: sockets.length, disconnected };
}

function startIdleSocketSweep({ store, intervalMs = SOCKET_SWEEP_MS } = {}) {
  const timer = setInterval(() => {
    sweepIdleSockets({ store }).catch((err) => console.error('[SessionIdle] Socket sweep failed:', err.message));
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  ABSOLUTE_MS,
  LAST_SEEN_WRITE_EVERY_MS,
  userSessionGuard,
  recordActivity,
  deadlines,
  expiryReason,
  disconnectSessionSockets,
  socketSessionIsLive,
  sweepIdleSockets,
  startIdleSocketSweep,
};
