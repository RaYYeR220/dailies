import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@dailies/core", "@dailies/pipeline"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
