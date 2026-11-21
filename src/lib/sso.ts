// Sign in with Microsoft through Cloudflare Access for SaaS (generic OIDC). README.md, "Access".
// Pure functions only (no Next.js, no env), so `node --test` can load them; the routes and
// getStaff() wire them up in src/auth/sso-server.ts.

import { jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";

/** The app's own session after a Microsoft sign-in. */
export const SESSION_COOKIE = "drp_staff";
/** state + nonce + next, between /sso/login and /sso/callback. */
export const FLOW_COOKIE = "drp_sso_flow";
export const SESSION_SECONDS = 8 * 60 * 60;
export const FLOW_SECONDS = 10 * 60;

const ISSUER = "drp-cms";
const SESSION_AUD = "drp-cms:staff";
const FLOW_AUD = "drp-cms:sso-flow";

export type SsoIdentity = { email: string; name: string; sub: string };
export type SsoFlow = { state: string; nonce: string; next: string };

const key = (secret: string) => new TextEncoder().encode(secret);

/**
 * Where to go after sign-in. Only a same-origin path: one leading "/", no "//" or "/\"
 * (protocol-relative), no backslashes or control characters. Anything else is "/".
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (!next || next.length > 2048) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return "/";
  return next;
}

export function isAllowedEmail(email: string, domain: string): boolean {
  return email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
}

export async function signSession(id: SsoIdentity, secret: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ email: id.email, name: id.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id.sub)
    .setIssuer(ISSUER)
    .setAudience(SESSION_AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_SECONDS)
    .sign(key(secret));
}

/** The identity in a valid, unexpired session cookie; null for anything else. */
export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<SsoIdentity | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: SESSION_AUD,
      algorithms: ["HS256"],
      currentDate: new Date(now),
    });
    const { email, name, sub } = payload;
    if (typeof email !== "string" || !email || typeof sub !== "string") return null;
    return { email, name: typeof name === "string" ? name : "", sub };
  } catch {
    return null;
  }
}

export async function signFlow(flow: SsoFlow, secret: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(FLOW_AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + FLOW_SECONDS)
    .sign(key(secret));
}

export async function verifyFlow(token: string | undefined, secret: string, now = Date.now()): Promise<SsoFlow | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: FLOW_AUD,
      algorithms: ["HS256"],
      currentDate: new Date(now),
    });
    const { state, nonce, next } = payload;
    if (typeof state !== "string" || typeof nonce !== "string" || typeof next !== "string") return null;
    return { state, nonce, next: sanitizeNext(next) };
  } catch {
    return null;
  }
}

export class SsoError extends Error {}

/**
 * Checks the id_token from Cloudflare Access: RS256 signature against the app's JWKS, issuer,
 * audience (our client id), expiry, and the nonce we sent. Returns who signed in.
 */
export async function verifyIdToken(
  idToken: string,
  opts: { issuer: string; clientId: string; nonce: string; keys: JWTVerifyGetKey; now?: number },
): Promise<SsoIdentity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, opts.keys, {
      issuer: opts.issuer,
      audience: opts.clientId,
      algorithms: ["RS256"],
      currentDate: opts.now === undefined ? undefined : new Date(opts.now),
    }));
  } catch (e) {
    throw new SsoError(`invalid id_token: ${(e as Error).message}`);
  }
  if (payload.nonce !== opts.nonce) throw new SsoError("id_token nonce does not match");
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) throw new SsoError("id_token has no email claim");
  if (typeof payload.sub !== "string" || !payload.sub) throw new SsoError("id_token has no sub claim");
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : email.split("@")[0];
  return { email, name, sub: payload.sub };
}

/** A random URL-safe value for state and nonce. */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(buf).toString("base64url");
}

/** client_secret_basic: id and secret form-urlencoded first (RFC 6749, 2.3.1). */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, "+");
  return "Basic " + Buffer.from(`${enc(clientId)}:${enc(clientSecret)}`).toString("base64");
}
