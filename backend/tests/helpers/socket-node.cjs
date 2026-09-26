/**
 * One "API instance" for tests/socket-multi-instance.test.js, run as its own
 * Node process: an HTTP server + Socket.io wired with the PRODUCTION adapter
 * (src/lib/socketAdapter.js) and the production emitToUser (src/lib/socket.js).
 *
 * Session auth is replaced by a handshake `auth.userId` — the test is about
 * cross-instance delivery, not login — so the room a socket joins is the same
 * `user:<id>` room the real app uses.
 *
 *   POST /emit?user=<id>&text=<t>   emitToUser(id, 'new_message', {...}) HERE
 *
 * Reports { port, adapter } to the parent over IPC once listening.
 */

const http = require('http');
const { Server } = require('socket.io');
const { attachSocketAdapter } = require('../../src/lib/socketAdapter');
const { setIO, emitToUser } = require('../../src/lib/socket');
const { closeRedis } = require('../../src/lib/redis');

const name = process.env.NODE_NAME || 'node';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/emit') {
    emitToUser(url.searchParams.get('user'), 'new_message', { from: name, text: url.searchParams.get('text') });
    res.end('ok');
    return;
  }
  res.statusCode = 404;
  res.end();
});

const io = new Server(server, { transports: ['websocket'] });
const adapter = attachSocketAdapter(io);
setIO(io);

io.on('connection', (socket) => {
  const userId = socket.handshake.auth && socket.handshake.auth.userId;
  if (!userId) return socket.disconnect(true);
  socket.join(`user:${userId}`);
});

server.listen(0, '127.0.0.1', () => {
  process.send({ port: server.address().port, adapter });
});

process.on('message', async (msg) => {
  if (msg === 'stop') {
    io.close();
    await closeRedis();
    process.exit(0);
  }
});
