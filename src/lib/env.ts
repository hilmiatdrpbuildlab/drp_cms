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
  // Website analytics (README.md, "Website analytics"). Each is optional; the Website tab lists what's missing.
  /** The Google Cloud service account's JSON key (or its base64). Server-only: never logged, never sent to the browser. */
  GA4_SERVICE_ACCOUNT_JSON: z.string().optional(),
  /** The GA4 property's numeric id: 552973295 for "DRP Build Lab". */
  GA4_PROPERTY_ID: z.string().optional(),
  // Sign in with Microsoft through Cloudflare Access (README.md, "Access"). All five, or none:
  // with any missing, only the email + password login is offered.
  /** The Cloudflare SaaS app's issuer: https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client id>. */
  ACCESS_OIDC_ISSUER: z.string().optional(),
  ACCESS_OIDC_CLIENT_ID: z.string().optional(),
  ACCESS_OIDC_CLIENT_SECRET: z.string().optional(),
  /** e.g. drp.cloudflareaccess.com. Sign out sends people to its logout page, which ends the shared session. */
  ACCESS_TEAM_DOMAIN: z.string().optional(),
  /** 32+ random characters; signs the drp_staff session cookie. Not the same value as NEON_AUTH_COOKIE_SECRET. */
  STAFF_SESSION_SECRET: z.string().optional(),
});

const SSO_KEYS = ["ACCESS_OIDC_ISSUER", "ACCESS_OIDC_CLIENT_ID", "ACCESS_OIDC_CLIENT_SECRET", "ACCESS_TEAM_DOMAIN", "STAFF_SESSION_SECRET"] as const;

/** The Microsoft sign-in settings, or undefined when it is not (fully) configured. */
function ssoConfig(env: z.infer<typeof schema>) {
  const v = Object.fromEntries(SSO_KEYS.map((k) => [k, env[k]?.trim() || undefined])) as Record<(typeof SSO_KEYS)[number], string | undefined>;
  const missing = SSO_KEYS.filter((k) => !v[k]);
  if (missing.length === SSO_KEYS.length) return undefined;
  if (missing.length) {
    console.warn(`[sso] Microsoft sign-in is off: ${missing.join(", ")} not set`);
    return undefined;
  }
  if (v.STAFF_SESSION_SECRET!.length < 32) throw new Error("Invalid environment (STAFF_SESSION_SECRET must be at least 32 characters).");
  const issuer = new URL(v.ACCESS_OIDC_ISSUER!); // throws on a malformed URL
  const local = issuer.hostname === "localhost" || issuer.hostname === "127.0.0.1"; // a mock provider in local tests
  if (issuer.protocol !== "https:" && !local) throw new Error("Invalid environment (ACCESS_OIDC_ISSUER must be https).");
  return {
    issuer: v.ACCESS_OIDC_ISSUER!.replace(/\/+$/, ""),
    clientId: v.ACCESS_OIDC_CLIENT_ID!,
    clientSecret: v.ACCESS_OIDC_CLIENT_SECRET!,
    teamDomain: v.ACCESS_TEAM_DOMAIN!.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
    sessionSecret: v.STAFF_SESSION_SECRET!,
  };
}

export type SsoConfig = NonNullable<ReturnType<typeof ssoConfig>>;

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
    GA4_SERVICE_ACCOUNT_JSON: opt(env.GA4_SERVICE_ACCOUNT_JSON),
    GA4_PROPERTY_ID: opt(env.GA4_PROPERTY_ID),
    /** Set only when Microsoft sign-in is fully configured. */
    SSO: ssoConfig(env),
  };
}

let cached: ReturnType<typeof load> | undefined;
/** Lazy, so `next build` needs no env. */
export const getEnv = () => (cached ??= load());
