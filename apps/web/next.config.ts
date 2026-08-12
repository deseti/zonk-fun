import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@zonk/contracts-sdk", "@zonk/types"],
};

export default nextConfig;
