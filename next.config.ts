import type { NextConfig } from "next";

// Every business screen is per-user and dynamic, so Cache Components and
// partial prefetching are intentionally left off for this module.
const nextConfig: NextConfig = {
  // Development only: lets the owner's phone on the local network load the dev server for the Module 008 phone check.
  allowedDevOrigins: ["192.168.1.7"],
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
