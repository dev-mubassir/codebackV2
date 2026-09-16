/** @type {import("next").NextConfig} */
const nextConfig = {
  // Standalone marketing site. No rewrites, no proxying to the API — every
  // link to the product is an absolute URL to app.siffty.com, because the
  // two run on different origins.
};

export default nextConfig;
