import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.ELECTRON === "true" ? "export" : undefined,
  images: {
    unoptimized: process.env.ELECTRON === "true",
  },
};

export default nextConfig;
