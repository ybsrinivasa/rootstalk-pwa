import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
});

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL || "http://localhost:8001";
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

module.exports = withPWA(withNextIntl(nextConfig));
