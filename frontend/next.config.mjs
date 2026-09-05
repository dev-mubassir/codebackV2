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
  allowedDevOrigins: ['app.siffty.com', 'app.citykirana.in', 'localhost', 'local.codeback.test'],
};

export default nextConfig;
