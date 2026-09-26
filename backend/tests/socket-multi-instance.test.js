/**
 * Two API instances, one Redis: an event emitted on instance A reaches a
 * browser whose socket is connected to instance B.
 *
 * This is the whole reason for the Redis adapter. Each instance is a REAL,
 * separate Node process (tests/helpers/socket-node.cjs) using the production
 * adapter and emitToUser, so nothing is shared in memory between them — the
 * only path from A to B is Redis pub/sub.
 *
 * The negative control runs the same two processes WITHOUT Redis and proves
 * the event does NOT arrive, so a pass above cannot be an artefact of the
 * harness.
 *
 * Needs a Redis: TEST_REDIS_URL, default redis://localhost:56379
 * (docker run -d --name siffty-test-redis -p 56379:6379 redis:7-alpine).
 * CI provides one as a service container.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';

const here = path.dirname(fileURLToPath(import.meta.url));
const NODE_SCRIPT = path.join(here, 'helpers', 'socket-node.cjs');
const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:56379';

const children = [];
const clients = [];

function startNode(name, { redis }) {
  const env = { ...process.env, NODE_NAME: name };
  if (redis) env.REDIS_URL = REDIS_URL;
  else delete env.REDIS_URL;
  const child = fork(NODE_SCRIPT, [], { env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  children.push(child);
  return new Promise((resolve, reject) => {
    child.once('message', (info) => resolve({ child, ...info }));
    child.once('exit', (code) => reject(new Error(`${name} exited early (code ${code})`)));
  });
}

function connectClient(port, userId) {
  const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], auth: { userId }, reconnection: false });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

const emitVia = (port, userId, text) =>
  fetch(`http://127.0.0.1:${port}/emit?user=${encodeURIComponent(userId)}&text=${encodeURIComponent(text)}`, { method: 'POST' });

/**
 * Emit on A until B's client hears it (the adapter subscribes asynchronously,
 * so the very first publish can race the subscription), or give up.
 */
async function deliveredAcross(portA, clientOnB, userId, { timeoutMs }) {
  const received = [];
  clientOnB.on('new_message', (payload) => received.push(payload));
  const deadline = Date.now() + timeoutMs;
  let n = 0;
  while (Date.now() < deadline && received.length === 0) {
    await emitVia(portA, userId, `hello-${n++}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  return received;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once('exit', resolve);
          child.send('stop');
          setTimeout(() => child.kill('SIGKILL'), 3000).unref();
        })
    )
  );
});

describe('Socket.io across two instances', () => {
  it('an event emitted on instance A reaches a client connected to instance B, through Redis', async () => {
    const [a, b] = await Promise.all([startNode('A', { redis: true }), startNode('B', { redis: true })]);
    expect(a.adapter).toBe('redis');
    expect(b.adapter).toBe('redis');

    const userId = `user-${Date.now()}`;
    const onB = await connectClient(b.port, userId);
    const received = await deliveredAcross(a.port, onB, userId, { timeoutMs: 8000 });

    expect(received.length, 'B received the event A emitted').toBeGreaterThan(0);
    expect(received[0].from).toBe('A');
  });

  it('only the addressed user receives it — another user on B hears nothing', async () => {
    const [a, b] = await Promise.all([startNode('A', { redis: true }), startNode('B', { redis: true })]);
    const target = `user-${Date.now()}`;
    const bystander = await connectClient(b.port, `other-${Date.now()}`);
    const heardByBystander = [];
    bystander.on('new_message', (p) => heardByBystander.push(p));

    const onB = await connectClient(b.port, target);
    const received = await deliveredAcross(a.port, onB, target, { timeoutMs: 8000 });

    expect(received.length).toBeGreaterThan(0);
    expect(heardByBystander).toEqual([]);
  });

  it('two users on two instances: an event for B reaches B, and A (on the other instance) receives nothing', async () => {
    const [one, two] = await Promise.all([startNode('A', { redis: true }), startNode('B', { redis: true })]);
    const userA = `user-a-${Date.now()}`;
    const userB = `user-b-${Date.now()}`;
    const clientA = await connectClient(one.port, userA);
    const heardByA = [];
    clientA.on('new_message', (p) => heardByA.push(p));
    const clientB = await connectClient(two.port, userB);

    // Emitted on instance one (where A is connected), addressed to B.
    const received = await deliveredAcross(one.port, clientB, userB, { timeoutMs: 8000 });
    expect(received.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(heardByA).toEqual([]);
  });

  it('negative control: without Redis the event does NOT cross instances', async () => {
    const [a, b] = await Promise.all([startNode('A', { redis: false }), startNode('B', { redis: false })]);
    expect(a.adapter).toBe('memory');

    const userId = `user-${Date.now()}`;
    const onB = await connectClient(b.port, userId);
    const received = await deliveredAcross(a.port, onB, userId, { timeoutMs: 1500 });

    expect(received).toEqual([]);
  });
});
