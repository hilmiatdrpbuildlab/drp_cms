import "server-only";

import { createNeonAuth } from "@neon/auth/next/server";
import { redirect } from "next/navigation";

import { getEnv } from "@/lib/env";

let auth: ReturnType<typeof createNeonAuth> | undefined;
/** Lazy: createNeonAuth throws without the cookie secret, and `next build` has no env. */
export function getAuth() {
  return (auth ??= createNeonAuth({
    baseUrl: getEnv().NEON_AUTH_BASE_URL,
    // No `domain`: the session cookie stays on cms.drpbuildlab.com and never reaches the public site.
    cookies: { secret: getEnv().NEON_AUTH_COOKIE_SECRET },
  }));
}

export type Staff = { id: string; email: string; name: string };

export function isStaffEmail(email: string) {
  return email.toLowerCase().endsWith(`@${getEnv().ALLOWED_EMAIL_DOMAIN.toLowerCase()}`);
}

/**
 * The session user, only if they are staff: a verified address on the company domain.
 * This is the security boundary. Call it in every page, Server Action and Route Handler;
 * proxy.ts only redirects signed-out page loads.
 */
export async function getStaff(): Promise<Staff | null> {
  const { data, error } = await getAuth().getSession();
  if (error) console.warn("[auth] getSession failed", error.code);
  const user = data?.user;
  if (!user || !user.emailVerified || !isStaffEmail(user.email)) return null;
  return { id: user.id, email: user.email, name: user.name || user.email.split("@")[0] };
}

/** For pages: signed out -> sign-in, signed in but not staff -> /no-access. */
export async function requireStaff(): Promise<Staff> {
  const staff = await getStaff();
  if (staff) return staff;
  const { data } = await getAuth().getSession();
  redirect(data?.user ? "/no-access" : "/sign-in");
}
