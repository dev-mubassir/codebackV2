import { BACKEND_URL } from './src/lib/backendUrl.js';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const backendUrl = BACKEND_URL;
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: '/auth/:path*',
        destination: `${backendUrl}/auth/:path*`,
      },
    ];
  },
  // Admin panel (Gate 8): never indexed, never framed, never leaks its URL
  // as a referrer. Only header-level rules — the admin data itself comes from
  // /api/admin, which answers no-store with its own security headers.
  async headers() {
    const adminHeaders = [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    return [
      { source: '/admin', headers: adminHeaders },
      { source: '/admin/:path*', headers: adminHeaders },
    ];
  },
  allowedDevOrigins: ['app.siffty.com', 'app.citykirana.in', 'localhost', 'local.codeback.test'],

  // Next's dev-tools badge is a dark circular "N" pinned to the bottom-left of
  // the VIEWPORT, in a shadow root outside our DOM. On an internal page that
  // puts it exactly on top of the sidebar's user block; on /login and /404 it
  // looks like a stray avatar on a page with no user. It is dev-only and never
  // ships, but it made two real screenshots unreadable. Compile and runtime
  // errors still surface — only the idle badge is hidden.
  devIndicators: false,
};

export default nextConfig;
