import { defineConfig } from "@neon/config/v1";

// `neon deploy` applies this to the linked branch and writes .env.local.
// Project: drp-cms (gentle-bird-32275869), aws-eu-central-1.
export default defineConfig({
  // Managed Better Auth. Sign-in is email + password with OTP email verification
  // (Microsoft 365 isn't an OAuth option in Neon Auth). The app only admits verified
  // @drpbuildlab.com addresses; see src/auth/server.ts.
  auth: true,
  buckets: {
    // Private: the CMS serves uploads to signed-in staff via /api/media/*, and
    // copies an article's images into drp_compro when it is published.
    media: { access: "private" },
  },
});
