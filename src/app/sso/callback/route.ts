import { NextResponse, type NextRequest } from "next/server";

import { cookieOptions, getDiscovery, getKeys, getSso, sessionCookieOptions } from "@/auth/sso-server";
import { getEnv } from "@/lib/env";
import { basicAuthHeader, FLOW_COOKIE, isAllowedEmail, SESSION_COOKIE, signSession, SsoError, verifyFlow, verifyIdToken } from "@/lib/sso";

export const dynamic = "force-dynamic";

/** Cloudflare Access sends the browser back here with ?code&state after the Microsoft sign-in. */
export async function GET(request: NextRequest) {
  const sso = getSso();
  if (!sso) return NextResponse.redirect(new URL("/sign-in", request.url), 303);
  const secure = sso.origin.startsWith("https:");

  // Failures go back to the sign-in page with a short code; the reason is logged, never a token.
  const fail = (code: string, reason: string) => {
    console.warn(`[sso] callback refused: ${reason}`);
    const res = NextResponse.redirect(new URL(`/sign-in?error=${code}`, sso.origin), 303);
    res.cookies.set(FLOW_COOKIE, "", cookieOptions(secure, 0, "/sso"));
    return res;
  };

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail("sso_denied", `provider returned error=${params.get("error")}`);

  const flow = await verifyFlow(request.cookies.get(FLOW_COOKIE)?.value, sso.sessionSecret);
  if (!flow) return fail("sso_expired", "missing or expired flow cookie");
  if (!params.get("state") || params.get("state") !== flow.state) return fail("sso_expired", "state does not match");
  const code = params.get("code");
  if (!code) return fail("sso_failed", "no code");

  let identity;
  try {
    const d = await getDiscovery(sso);
    const basic = !d.token_endpoint_auth_methods_supported || d.token_endpoint_auth_methods_supported.includes("client_secret_basic");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: new URL("/sso/callback", sso.origin).toString(),
    });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (basic) headers.authorization = basicAuthHeader(sso.clientId, sso.clientSecret);
    else {
      body.set("client_id", sso.clientId);
      body.set("client_secret", sso.clientSecret);
    }
    const res = await fetch(d.token_endpoint, { method: "POST", headers, body, cache: "no-store" });
    if (!res.ok) throw new SsoError(`token endpoint answered HTTP ${res.status}`);
    const tokens = (await res.json()) as { id_token?: unknown };
    if (typeof tokens.id_token !== "string") throw new SsoError("token response has no id_token");
    identity = await verifyIdToken(tokens.id_token, { issuer: d.issuer, clientId: sso.clientId, nonce: flow.nonce, keys: getKeys(d.jwks_uri) });
  } catch (e) {
    return fail("sso_failed", (e as Error).message);
  }

  if (!isAllowedEmail(identity.email, getEnv().ALLOWED_EMAIL_DOMAIN)) return fail("sso_domain", `not a company address (${identity.email.split("@")[1]})`);

  const res = NextResponse.redirect(new URL(flow.next, sso.origin), 303);
  res.cookies.set(SESSION_COOKIE, await signSession(identity, sso.sessionSecret), sessionCookieOptions(secure));
  res.cookies.set(FLOW_COOKIE, "", cookieOptions(secure, 0, "/sso"));
  return res;
}
