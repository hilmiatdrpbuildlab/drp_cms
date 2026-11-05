import "server-only";

import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  NEON_AUTH_BASE_URL: z.string().url(),
  NEON_AUTH_COOKIE_SECRET: z.string().min(32, "NEON_AUTH_COOKIE_SECRET must be at least 32 characters"),
  ALLOWED_EMAIL_DOMAIN: z.string().min(3).default("drpbuildlab.com"),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_REPO: z.string().regex(/^[\w.-]+\/[\w.-]+$/).default("Lathif21/drp_compro"),
  GITHUB_BRANCH: z.string().min(1).default("main"),
  /** The website GITHUB_REPO deploys to, e.g. https://drpbuildlab.com. Lets the CMS link to
   *  articles and check when a publish is live. Optional: without it, progress stops at "built". */
  SITE_URL: z.string().url().optional().or(z.literal("")),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment (${issues}). Run \`neon env pull\` and see README.md.`);
  }
  const env = parsed.data;
  const url = new URL(env.DATABASE_URL);
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode === "prefer" || sslmode === "require" || sslmode === "verify-ca") url.searchParams.set("sslmode", "verify-full");
  return {
    ...env,
    DATABASE_URL: url.toString(),
    GITHUB_TOKEN: env.GITHUB_TOKEN || undefined,
    SITE_URL: env.SITE_URL ? env.SITE_URL.replace(/\/+$/, "") : undefined,
  };
}

let cached: ReturnType<typeof load> | undefined;
/** Lazy, so `next build` needs no env. */
export const getEnv = () => (cached ??= load());
