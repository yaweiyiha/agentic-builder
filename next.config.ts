import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.ELECTRON === "true" ? "export" : undefined,
  images: {
    unoptimized: process.env.ELECTRON === "true",
  },
  // Per-instance distDir lets two `next dev` processes run from the
  // same project directory in parallel. Next.js 16's dev-server lock
  // lives at `<distDir>/lock`, so giving project B a different dist dir
  // (e.g. `.next-b/`) lets both A and B coexist. Default stays `.next`.
  // Set NEXT_DIST_DIR=.next-b in `.env.parallel` for project B.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
