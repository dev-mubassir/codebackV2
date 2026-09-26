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

  // With Redis down, the adapter's PUBLISH rejects (ioredis gives up after its
  // retries) and nothing in socket.io catches it — an unhandled rejection,
  // which kills a Node process. Swallow and log it here instead: the emit
  // still reaches sockets on THIS instance (the adapter broadcasts locally
  // regardless), only the cross-instance relay is lost until Redis returns.
  const publish = pubClient.publish.bind(pubClient);
  let lastWarned = 0;
  pubClient.publish = (...args) =>
    publish(...args).catch((err) => {
      if (Date.now() - lastWarned > 60 * 1000) {
        lastWarned = Date.now();
        console.warn('[Socket.io] Redis publish failed; events reach this instance only until Redis returns:', err.message);
      }
      return 0;
    });

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
