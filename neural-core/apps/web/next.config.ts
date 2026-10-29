import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@neural-core/shared"],
  reactStrictMode: true,
};

export default nextConfig;
