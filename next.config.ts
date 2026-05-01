import type { NextConfig } from "next";
const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
});

const nextConfig: NextConfig = {
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL || "http://localhost:8001";
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

module.exports = withPWA(nextConfig);
