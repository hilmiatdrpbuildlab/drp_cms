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
  /** Full-access key on the Resend team that drpbuildlab.com's newsletter uses. Without it, Insights explains what's missing. */
  RESEND_API_KEY: z.string().optional(),
  // Offers (docs/offers-consent-contract.md). Each is optional; Insights lists what's missing.
  /** The same sender as the site's newsletter: 'DRP BuildLab <…@drpbuildlab.com>'. */
  MAIL_FROM: z.string().optional(),
  /** The lawyer-approved consent text version, the same value as on the site. Unset = no sending. */
  MARKETING_CONSENT_VERSION: z.string().optional(),
  /** The site's NEWSLETTER_SECRET, to seal consent-request links the site can open. */
  NEWSLETTER_SECRET: z.string().optional(),
  /** whsec_… of the Resend webhook pointing at /api/webhooks/resend. */
  RESEND_WEBHOOK_SECRET: z.string().optional(),
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
  const opt = (v: string | undefined) => v?.trim() || undefined;
  const siteUrl = env.SITE_URL ? env.SITE_URL.replace(/\/+$/, "") : undefined;
  return {
    ...env,
    DATABASE_URL: url.toString(),
    GITHUB_TOKEN: opt(env.GITHUB_TOKEN),
    SITE_URL: siteUrl,
    /** Where newsletter emails link and the offers page lives: SITE_URL, or the live site. */
    SITE_ORIGIN: siteUrl ?? "https://drpbuildlab.com",
    RESEND_API_KEY: opt(env.RESEND_API_KEY),
    MAIL_FROM: opt(env.MAIL_FROM),
    MARKETING_CONSENT_VERSION: opt(env.MARKETING_CONSENT_VERSION),
    NEWSLETTER_SECRET: opt(env.NEWSLETTER_SECRET),
    RESEND_WEBHOOK_SECRET: opt(env.RESEND_WEBHOOK_SECRET),
  };
}

let cached: ReturnType<typeof load> | undefined;
/** Lazy, so `next build` needs no env. */
export const getEnv = () => (cached ??= load());
