import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { test } from "node:test";

import { seal, unseal, verifySvix } from "./crypto.ts";
import {
  audienceByLang,
  consentRequestEmail,
  FALLBACK_STRINGS,
  interestTags,
  marketPrefix,
  offerEmail,
  offerMailStrings,
  offerVersionSchema,
  slugFromLink,
  UNSUBSCRIBE,
} from "./offers.ts";

const v = {
  subject: "20% off Tinrate",
  heading: "Chatbots that answer like you would",
  body: "First paragraph <b>not bold</b>.\n\nSecond line one\nline two",
  buttonLabel: "See the offer",
  buttonUrl: "https://tinrate.com/?ref=drp",
};

test("offerVersionSchema wants https links and real text", () => {
  assert.equal(offerVersionSchema.safeParse(v).success, true);
  assert.equal(offerVersionSchema.safeParse({ ...v, buttonUrl: "http://x.com" }).success, false);
  assert.equal(offerVersionSchema.safeParse({ ...v, body: "short" }).success, false);
});

test("offerEmail escapes text, names the partner and carries Resend's unsubscribe link", () => {
  const m = offerEmail({ s: FALLBACK_STRINGS, lang: "en", v, partner: "Tinrate" });
  assert.equal(m.subject, "20% off Tinrate");
  assert.match(m.html, /An offer from our partner: Tinrate/);
  assert.match(m.html, /&lt;b&gt;not bold&lt;\/b&gt;/);
  assert.match(m.html, /Second line one<br>line two/);
  assert.ok(m.html.includes(`href="${UNSUBSCRIBE}"`));
  assert.ok(m.text.includes(`Unsubscribe from offers: ${UNSUBSCRIBE}`));
  assert.doesNotMatch(offerEmail({ s: FALLBACK_STRINGS, lang: "en", v }).html, /partner:/);
  assert.match(offerEmail({ s: FALLBACK_STRINGS, lang: "ar", v }).html, /dir="rtl"/);
});

test("consentRequestEmail links to the consent page", () => {
  const m = consentRequestEmail({ s: FALLBACK_STRINGS, lang: "nl", link: "https://drpbuildlab.com/be/blog/offers/#t=abc" });
  assert.match(m.html, /href="https:\/\/drpbuildlab\.com\/be\/blog\/offers\/#t=abc"/);
  assert.equal(m.subject, FALLBACK_STRINGS.osubj);
});

test("offerMailStrings reads the #mail block and refuses an incomplete one", () => {
  const spans = Object.entries(FALLBACK_STRINGS).map(([k, s]) => `<span data-k="${k}">${s.replace(/'/g, "&#39;")}</span>`).join("\n");
  assert.deepEqual(offerMailStrings(`<p>x</p><div id="mail" hidden>${spans}</div>`), FALLBACK_STRINGS);
  assert.throws(() => offerMailStrings(`<div id="mail" hidden><span data-k="osubj">x</span></div>`), /missing mail strings/);
  assert.throws(() => offerMailStrings("<p>no block</p>"), /no #mail block/);
});

test("marketPrefix follows the site's LANG_HOME", () => {
  assert.equal(marketPrefix("nl"), "be");
  assert.equal(marketPrefix("af"), "za/af");
});

test("slugFromLink finds blog articles on the site only", () => {
  assert.equal(slugFromLink("https://drpbuildlab.com/ie/blog/ai-chatbots-101/"), "ai-chatbots-101");
  assert.equal(slugFromLink("https://www.drpbuildlab.com/za/af/blog/ai-chatbots-101"), "ai-chatbots-101");
  assert.equal(slugFromLink("https://drpbuildlab.com/ie/blog/"), null);
  assert.equal(slugFromLink("https://drpbuildlab.com/ie/blog/subscribe/"), null);
  assert.equal(slugFromLink("https://evil.com/ie/blog/ai/"), null);
  assert.equal(slugFromLink("not a url"), null);
});

test("interestTags ranks the tags of clicked articles", () => {
  const tags = new Map([
    ["a", ["AI", "chatbots"]],
    ["b", ["automation", "ai"]],
  ]);
  assert.deepEqual(
    interestTags(
      [
        { slug: "a", clicks: 1 },
        { slug: "b", clicks: 2 },
        { slug: "gone", clicks: 5 },
      ],
      tags,
    ),
    ["ai", "automation", "chatbots"],
  );
});

test("audienceByLang: no tags = everyone consenting; tags = any match", () => {
  const members = [
    { email: "a@x", lang: "en" as const, tags: ["ai"] },
    { email: "b@x", lang: "nl" as const, tags: [] },
    { email: "c@x", lang: "en" as const, tags: ["websites"] },
  ];
  assert.deepEqual([...audienceByLang(members, [])], [["en", ["a@x", "c@x"]], ["nl", ["b@x"]]]);
  assert.deepEqual([...audienceByLang(members, ["AI"])], [["en", ["a@x"]]]);
});

test("verifySvix accepts Resend's signature and refuses tampering and replays", () => {
  const secret = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;
  const body = '{"type":"email.clicked"}';
  const now = 1_800_000_000;
  const sig = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`msg_1.${now}.${body}`).digest("base64");
  const h = { id: "msg_1", timestamp: String(now), signature: `v1,bogus v1,${sig}` };
  assert.equal(verifySvix(secret, h, body, now), true);
  assert.equal(verifySvix(secret, h, body + " ", now), false);
  assert.equal(verifySvix(secret, h, body, now + 301), false);
  assert.equal(verifySvix(secret, { ...h, signature: null }, body, now), false);
});

test("seal/unseal round-trip, and the site's algorithm can open it", async () => {
  const t = await seal({ e: "a@x.be", l: "nl", m: "be", t: 1, p: "offers" }, "s3cret");
  assert.match(t, /^[A-Za-z0-9_-]{40,}$/);
  assert.deepEqual(await unseal(t, "s3cret"), { e: "a@x.be", l: "nl", m: "be", t: 1, p: "offers" });
  assert.equal(await unseal(t, "other"), null);

  // subscribe.js open(), transcribed: atob-based base64url and the same key derivation
  const raw = Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
  const key = await webcrypto.subtle.importKey(
    "raw",
    await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("drp-newsletter-token-v1:s3cret")),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const pt = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
  assert.equal(JSON.parse(new TextDecoder().decode(pt)).p, "offers");
});
