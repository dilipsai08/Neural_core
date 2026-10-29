import type { NextConfig } from "next";

/**
 * Static export: `pnpm build` writes apps/web/out, which the API serves on the
 * same port as the REST/WebSocket endpoints. One process, one URL, fully
 * offline at the venue.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@neural-core/shared"],
  reactStrictMode: true,
};

export default nextConfig;
