import { io } from 'socket.io-client';
import { BACKEND_URL } from './backendUrl';

/**
 * The one way a page opens its live-update connection.
 *
 * WEBSOCKET ONLY. The API runs as several instances behind a load balancer
 * with no sticky sessions. Socket.io's default starts on HTTP long-polling and
 * upgrades, and every poll is a separate request that can land on a different
 * instance — which does not know the handshake and answers 400. A websocket is
 * one long-lived connection pinned to one instance for its lifetime, and the
 * backend's Redis adapter fans events out to whichever instance holds it.
 *
 * No 'join' emit: the server puts the socket in the user's room from the
 * session cookie on connect (withCredentials sends it). A client-supplied
 * userId was never trusted, so sending one did nothing.
 *
 * RECONNECT. Events emitted while the socket was down are gone — the server
 * does not buffer them for a returning client. `onReconnect` runs after an automatic
 * reconnection (not on the first connect) so the page can refetch what it
 * loaded at start and catch up. Backoff is jittered so a deploy that drops
 * every client at once does not bring them all back in the same second.
 */
export function createSocket({ onReconnect } = {}) {
  const socket = io(BACKEND_URL, {
    withCredentials: true,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    randomizationFactor: 0.5,
  });
  if (onReconnect) socket.io.on('reconnect', () => onReconnect());
  return socket;
}
