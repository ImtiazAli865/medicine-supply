import type { NextConfig } from "next";

// Every business screen is per-user and dynamic, so Cache Components and
// partial prefetching are intentionally left off for this module.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
