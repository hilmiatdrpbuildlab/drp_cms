import "server-only";

import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { cookies } from "next/headers";

import { getEnv, type SsoConfig } from "@/lib/env";
import { isAllowedEmail, SESSION_COOKIE, SESSION_SECONDS, verifySession, type SsoIdentity } from "@/lib/sso";

/** Microsoft sign-in settings, or undefined when it is not configured (password login only). */
export const getSso = (): SsoConfig | undefined => getEnv().SSO;

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
};

let discovered: { issuer: string; doc: Promise<Discovery> } | undefined;
let keySet: { uri: string; keys: JWTVerifyGetKey } | undefined;

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** The SaaS app's OIDC endpoints, fetched once per server instance. */
export function getDiscovery(cfg: SsoConfig): Promise<Discovery> {
  if (discovered?.issuer !== cfg.issuer) {
    const doc = (async () => {
      const res = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, { cache: "no-store" });
      if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
      const d = (await res.json()) as Discovery;
      if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri || !d.issuer) throw new Error("OIDC discovery document is incomplete");
      // OpenID Connect Discovery 4.3: the document must be for the issuer we configured.
      if (trimSlash(d.issuer) !== cfg.issuer) throw new Error("OIDC discovery issuer does not match ACCESS_OIDC_ISSUER");
      return d;
    })();
    doc.catch(() => (discovered = undefined)); // retry on the next sign-in
    discovered = { issuer: cfg.issuer, doc };
  }
  return discovered.doc;
}

/** jose caches the keys and refetches when Access rotates them. */
export function getKeys(jwksUri: string): JWTVerifyGetKey {
  if (keySet?.uri !== jwksUri) keySet = { uri: jwksUri, keys: createRemoteJWKSet(new URL(jwksUri)) };
  return keySet.keys;
}

export function cookieOptions(secure: boolean, maxAge: number, path = "/") {
  return { httpOnly: true, secure, sameSite: "lax" as const, path, maxAge };
}

export const sessionCookieOptions = (secure: boolean) => cookieOptions(secure, SESSION_SECONDS);

/** The person in a valid drp_staff cookie, if they are on the company domain. */
export async function readSsoSession(token: string | undefined): Promise<SsoIdentity | null> {
  const sso = getSso();
  if (!sso || !token) return null;
  const id = await verifySession(token, sso.sessionSecret);
  if (!id || !isAllowedEmail(id.email, getEnv().ALLOWED_EMAIL_DOMAIN)) return null;
  return id;
}

/** Same, from the request's cookies (Server Components, Server Actions, Route Handlers). */
export async function getSsoSession(): Promise<SsoIdentity | null> {
  if (!getSso()) return null;
  return readSsoSession((await cookies()).get(SESSION_COOKIE)?.value);
}
