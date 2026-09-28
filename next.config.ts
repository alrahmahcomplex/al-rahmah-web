import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Lets staff pages call forbidden() for someone whose role lacks the
    // permission a page needs.
    authInterrupts: true,
  },
};

export default nextConfig;
