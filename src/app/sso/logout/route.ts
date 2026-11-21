import { NextResponse, type NextRequest } from "next/server";

import { getAuth } from "@/auth/server";
import { cookieOptions, getSso } from "@/auth/sso-server";
import { SESSION_COOKIE } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * Ends this app's session (Microsoft and, if any, Neon Auth), then Cloudflare Access's logout
 * page, which ends the shared sign-in session for every app that uses it.
 */
async function logout(request: NextRequest) {
  const sso = getSso();
  try {
    // Reads and clears the Neon Auth cookies through next/headers.
    await getAuth().signOut();
  } catch {
    // No Neon Auth session, or it is already gone.
  }
  const target = sso ? `https://${sso.teamDomain}/cdn-cgi/access/logout` : new URL("/sign-in", request.url);
  const res = NextResponse.redirect(target, 303);
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(sso ? sso.origin.startsWith("https:") : request.nextUrl.protocol === "https:", 0));
  return res;
}

export const GET = logout;
export const POST = logout;
