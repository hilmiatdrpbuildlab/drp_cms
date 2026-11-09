/**
 * Webhook signatures (Resend signs with Svix) and the newsletter's sealed tokens.
 * Node built-ins only, so it can be unit-tested with `node --test`.
 */
import { createHmac, timingSafeEqual, webcrypto } from "node:crypto";

/**
 * Svix: HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>" with the base64 secret after "whsec_".
 * svix-signature holds one or more space-separated "v1,<base64>". Timestamps older or newer than
 * `toleranceSec` are refused, against replays.
 */
export function verifySvix(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = createHmac("sha256", Buffer.from(secret.replace(/^whsec_/, ""), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/* The same sealing as drpbuildlab.com's netlify/edge-functions/subscribe.js, so the site can open
   tokens the CMS makes: AES-GCM with key SHA-256("drp-newsletter-token-v1:" + secret), IV first. */

const enc = new TextEncoder();
const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

async function tokenKey(secret: string) {
  const raw = await webcrypto.subtle.digest("SHA-256", enc.encode(`drp-newsletter-token-v1:${secret}`));
  return webcrypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(payload: object, secret: string): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(secret), enc.encode(JSON.stringify(payload))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64u(out);
}

export async function unseal<T = unknown>(token: string, secret: string): Promise<T | null> {
  try {
    const raw = Buffer.from(token, "base64url");
    const pt = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, await tokenKey(secret), raw.subarray(12));
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    return null;
  }
}
