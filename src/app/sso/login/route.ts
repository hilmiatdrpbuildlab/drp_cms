import { NextResponse, type NextRequest } from "next/server";

import { cookieOptions, getDiscovery, getSso } from "@/auth/sso-server";
import { flowCookie, FLOW_SECONDS, randomToken, sanitizeNext, signFlow } from "@/lib/sso";

export const dynamic = "force-dynamic";

/** Starts "Sign in with Microsoft": off to Cloudflare Access, which asks Microsoft only if needed. */
export async function GET(request: NextRequest) {
  const sso = getSso();
  if (!sso) return NextResponse.redirect(new URL("/sign-in", request.url), 303);

  let authorize: string;
  try {
    authorize = (await getDiscovery(sso)).authorization_endpoint;
  } catch (e) {
    console.error("[sso] login:", (e as Error).message);
    return NextResponse.redirect(new URL("/sign-in?error=sso_failed", sso.origin), 303);
  }

  const flow = { state: randomToken(), nonce: randomToken(), next: sanitizeNext(request.nextUrl.searchParams.get("next")) };
  const url = new URL(authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", sso.clientId);
  url.searchParams.set("redirect_uri", new URL("/sso/callback", sso.origin).toString());
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", flow.state);
  url.searchParams.set("nonce", flow.nonce);

  const res = NextResponse.redirect(url, 303);
  res.cookies.set(flowCookie(flow.state)!, await signFlow(flow, sso.sessionSecret), cookieOptions(sso.origin.startsWith("https:"), FLOW_SECONDS, "/sso"));
  return res;
}
