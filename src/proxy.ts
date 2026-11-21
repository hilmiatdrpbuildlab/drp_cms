import { NextResponse, type NextRequest } from "next/server";

import { getAuth } from "@/auth/server";
import { getSso, readSsoSession } from "@/auth/sso-server";
import { SESSION_COOKIE } from "@/lib/sso";

let middleware: ReturnType<ReturnType<typeof getAuth>["middleware"]> | undefined;

// Sends signed-out page loads to the sign-in and refreshes sessions. Not the security boundary:
// pages, actions and API routes check getStaff() themselves.
// With Microsoft sign-in configured, signed-out page loads go straight to it (/sso/login), which is
// silent while the Cloudflare Access session lives (Lathif, 21 Nov 2026). The password form stays
// reachable at /sign-in until the password login is removed.
export default async function proxy(request: NextRequest) {
  if (request.headers.has("next-action")) return;
  // Signed in with Microsoft: nothing for Neon Auth to do.
  if (await readSsoSession(request.cookies.get(SESSION_COOKIE)?.value)) return;
  middleware ??= getAuth().middleware({ loginUrl: "/sign-in" });
  const response = await middleware(request);

  const location = response?.headers.get("location");
  if (location && getSso() && new URL(location, request.url).pathname === "/sign-in") {
    const login = new URL("/sso/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(login, 307);
    // Neon's redirect may clear a stale session cookie; keep that.
    for (const cookie of response.headers.getSetCookie()) redirect.headers.append("Set-Cookie", cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/|sso/|sign-in|no-access|_next/|favicon.ico|robots.txt).*)"],
};
