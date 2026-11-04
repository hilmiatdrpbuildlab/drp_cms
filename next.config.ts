import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let `next dev` write AGENTS.md / CLAUDE.md into the app.
  agentRules: false,
  experimental: {
    // Image uploads go through a Route Handler, but keep Server Action bodies roomy for long articles.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
