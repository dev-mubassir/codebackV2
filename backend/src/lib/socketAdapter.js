/**
 * Socket.io across instances.
 *
 * With more than one API instance, a user's browser holds its socket on ONE of
 * them, while the webhook (or worker) that produces their event runs on any.
 * The Redis adapter relays every room emit through Redis pub/sub, so
 * emitToUser() on instance A reaches a socket connected to instance B.
 *
 * Without REDIS_URL the default in-memory adapter stays — correct for one
 * instance, and the rollback path.
 *
 * Kept separate from src/index.js so the multi-instance integration test can
 * attach the exact production adapter to its own servers.
 */

const { createRedisConnection } = require('./redis');

let mode = 'memory';

/**
 * Attach the Redis adapter to `io` when Redis is configured.
 * @returns {'redis' | 'memory'}
 */
function attachSocketAdapter(io) {
  const pubClient = createRedisConnection('socket-pub');
  if (!pubClient) {
    mode = 'memory';
    return mode;
  }
  const subClient = createRedisConnection('socket-sub');
  const { createAdapter } = require('@socket.io/redis-adapter');
  io.adapter(createAdapter(pubClient, subClient, { key: 'socket.io' }));
  mode = 'redis';
  return mode;
}

/** 'redis' | 'memory' — for the boot log and the admin health page. */
function socketAdapterMode() {
  return mode;
}

module.exports = { attachSocketAdapter, socketAdapterMode };
