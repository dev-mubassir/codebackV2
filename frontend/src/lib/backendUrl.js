/**
 * The backend origin every frontend request talks to.
 *
 * This is the SINGLE source for NEXT_PUBLIC_BACKEND_URL. It governs the
 * Next.js rewrite proxy (next.config.mjs), the axios client (lib/api.js),
 * the Socket.io connection (lib/socket.js), and two admin CSV export
 * links. Six places used to default independently — that duplication is how
 * one of them drifts or gets copy-pasted wrong. Every one of them imports
 * BACKEND_URL from here instead.
 *
 * Missing this in production is a "successful" build that talks to
 * localhost: no error, no crash, just a frontend that cannot reach its own
 * API. So the missing/wrong value is now a build failure rather than a
 * silent one:
 *
 *   - production build: throws if unset OR still pointing at localhost, and
 *     `next build` stops
 *   - development:      keeps the localhost default so local dev needs no
 *     env file, same as before
 *
 * Set NEXT_PUBLIC_BACKEND_URL in frontend/.env.local for local dev, and in
 * the deployment environment's BUILD-TIME secret group for prod — Next.js
 * inlines NEXT_PUBLIC_* values at build time, so a runtime-only secret group
 * injects nothing into the bundle.
 */

const DEV_DEFAULT = 'http://localhost:5000';
const LOCAL_URL_PATTERN = /localhost|127\.0\.0\.1/;

const configured = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && (!configured || LOCAL_URL_PATTERN.test(configured))) {
  throw new Error(
    `NEXT_PUBLIC_BACKEND_URL is ${configured ? `still "${configured}"` : 'not set'} in a production build. ` +
      'It wires the entire frontend-to-backend connection (API calls, OAuth start links, Socket.io, and the ' +
      'Next.js rewrite proxy). Set it to the public backend URL in the BUILD-TIME environment and rebuild.'
  );
}

export const BACKEND_URL = configured || DEV_DEFAULT;
