import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // The fitting room's MediaPipe models (tens of MB, never edited): kept by the browser for 30 days
  // instead of being checked again on every visit
  async headers() {
    return [
      {
        source: "/static-libs/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
