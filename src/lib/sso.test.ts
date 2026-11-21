import assert from "node:assert/strict";
import { test } from "node:test";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  basicAuthHeader,
  isAllowedEmail,
  sanitizeNext,
  SESSION_SECONDS,
  SsoError,
  signFlow,
  signSession,
  verifyFlow,
  verifyIdToken,
  verifySession,
} from "./sso.ts";

const SECRET = "x".repeat(40);
const OTHER = "y".repeat(40);
const id = { email: "ann@drpbuildlab.com", name: "Ann", sub: "abc-123" };

test("sanitizeNext keeps same-origin paths only", () => {
  assert.equal(sanitizeNext("/blog/42?tab=x#y"), "/blog/42?tab=x#y");
  assert.equal(sanitizeNext("/"), "/");
  for (const bad of [null, undefined, "", "blog", "https://evil.example", "//evil.example", "/\\evil.example", "/a\\b", "/a\nb", "javascript:alert(1)", "/" + "a".repeat(3000)]) {
    assert.equal(sanitizeNext(bad), "/", String(bad));
  }
});

test("isAllowedEmail checks the domain, case-insensitively", () => {
  assert.ok(isAllowedEmail("Ann@DRPBuildLab.com", "drpbuildlab.com"));
  assert.ok(!isAllowedEmail("ann@drpbuildlab.com.evil.example", "drpbuildlab.com"));
  assert.ok(!isAllowedEmail("ann@notdrpbuildlab.com", "drpbuildlab.com"));
});

test("session cookie round-trips and lasts 8 hours", async () => {
  const now = Date.UTC(2026, 10, 21, 9, 0, 0);
  const token = await signSession(id, SECRET, now);
  assert.deepEqual(await verifySession(token, SECRET, now), id);
  assert.deepEqual(await verifySession(token, SECRET, now + (SESSION_SECONDS - 60) * 1000), id);
  assert.equal(await verifySession(token, SECRET, now + (SESSION_SECONDS + 60) * 1000), null);
});

test("session cookie is refused with another secret, tampered, or as a flow cookie", async () => {
  const token = await signSession(id, SECRET);
  assert.equal(await verifySession(token, OTHER), null);
  assert.equal(await verifySession(token.slice(0, -2) + "AA", SECRET), null);
  assert.equal(await verifySession(undefined, SECRET), null);
  const flow = await signFlow({ state: "s", nonce: "n", next: "/" }, SECRET);
  assert.equal(await verifySession(flow, SECRET), null);
  assert.equal(await verifyFlow(token, SECRET), null);
});

test("flow cookie round-trips, expires after 10 minutes, and re-sanitizes next", async () => {
  const now = Date.now();
  const token = await signFlow({ state: "s", nonce: "n", next: "/blog" }, SECRET, now);
  assert.deepEqual(await verifyFlow(token, SECRET, now), { state: "s", nonce: "n", next: "/blog" });
  assert.equal(await verifyFlow(token, SECRET, now + 11 * 60 * 1000), null);
  const evil = await signFlow({ state: "s", nonce: "n", next: "//evil.example" }, SECRET, now);
  assert.equal((await verifyFlow(evil, SECRET, now))?.next, "/");
});

test("basicAuthHeader form-encodes id and secret first", () => {
  const h = basicAuthHeader("id 1", "s:e/c");
  assert.equal(Buffer.from(h.slice(6), "base64").toString(), "id+1:s%3Ae%2Fc");
});

const ISSUER = "https://drp.cloudflareaccess.com/cdn-cgi/access/sso/oidc/client-1";

async function idTokenSetup() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: number } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience(opts.aud ?? "client-1")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 300)
      .sign(privateKey);
  return { keys, sign };
}

test("verifyIdToken accepts a good token and reads email, name and sub", async () => {
  const { keys, sign } = await idTokenSetup();
  const token = await sign({ sub: "u1", email: " Ann@DRPBuildLab.com ", name: "Ann Smith", nonce: "n1" });
  assert.deepEqual(await verifyIdToken(token, { issuer: ISSUER, clientId: "client-1", nonce: "n1", keys }), {
    email: "ann@drpbuildlab.com",
    name: "Ann Smith",
    sub: "u1",
  });
  const noName = await sign({ sub: "u1", email: "bob@drpbuildlab.com", nonce: "n1" });
  assert.equal((await verifyIdToken(noName, { issuer: ISSUER, clientId: "client-1", nonce: "n1", keys })).name, "bob");
});

test("verifyIdToken refuses wrong nonce, issuer, audience, expiry, key, or missing email", async () => {
  const { keys, sign } = await idTokenSetup();
  const other = await idTokenSetup();
  const opts = { issuer: ISSUER, clientId: "client-1", nonce: "n1", keys };
  const claims = { sub: "u1", email: "ann@drpbuildlab.com", nonce: "n1" };
  const cases: [string, Promise<string>][] = [
    ["nonce", sign({ ...claims, nonce: "other" })],
    ["issuer", sign(claims, { iss: "https://evil.example" })],
    ["audience", sign(claims, { aud: "client-2" })],
    ["expired", sign(claims, { exp: Math.floor(Date.now() / 1000) - 600 })],
    ["key", other.sign(claims)],
    ["email", sign({ sub: "u1", nonce: "n1" })],
  ];
  for (const [what, token] of cases) {
    await assert.rejects(verifyIdToken(await token, opts), SsoError, what);
  }
});
