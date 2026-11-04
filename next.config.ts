import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let `next dev` write AGENTS.md / CLAUDE.md into the app.
  agentRules: false,
  // Internal tool: never indexed, never framed. netlify.toml's [[headers]] only reach static files,
  // so pages rendered by the Next.js function need them from here.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  experimental: {
    // Image uploads go through a Route Handler, but keep Server Action bodies roomy for long articles.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
