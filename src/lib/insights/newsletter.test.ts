import assert from "node:assert/strict";
import { test } from "node:test";

import {
  csvCell,
  langOfSegment,
  mergeSegmentContacts,
  parseBroadcastName,
  parseResendDate,
  summarize,
  toCsv,
} from "./newsletter.ts";

test("langOfSegment reads only the site's blog segments", () => {
  assert.equal(langOfSegment("Blog newsletter (nl)"), "nl");
  assert.equal(langOfSegment("Blog newsletter (xx)"), null);
  assert.equal(langOfSegment("Client zone"), null);
  assert.equal(langOfSegment(undefined), null);
});

test("parseBroadcastName reads blog:<slug>:<lang>", () => {
  assert.deepEqual(parseBroadcastName("blog:ai-chatbots-101:fr"), { slug: "ai-chatbots-101", lang: "fr" });
  assert.equal(parseBroadcastName("blog:Bad Slug:fr"), null);
  assert.equal(parseBroadcastName("promo:x:en"), null);
});

test("parseResendDate accepts Resend's timestamp format", () => {
  assert.equal(parseResendDate("2026-10-06 23:47:56.678+00")?.toISOString(), "2026-10-06T23:47:56.678Z");
  assert.equal(parseResendDate("2026-10-06T23:47:56.678Z")?.toISOString(), "2026-10-06T23:47:56.678Z");
  // What the API actually returns: microseconds
  assert.equal(parseResendDate("2026-11-06 13:34:33.593688+00")?.toISOString(), "2026-11-06T13:34:33.593Z");
  assert.equal(parseResendDate("nonsense"), null);
  assert.equal(parseResendDate(null), null);
});

test("mergeSegmentContacts dedupes by id, keeps every language, newest first", () => {
  const subs = mergeSegmentContacts([
    { lang: "nl", contacts: [{ id: "a", email: "A@x.be", created_at: "2026-10-01 10:00:00+00" }] },
    {
      lang: "en",
      contacts: [
        { id: "a", email: "a@x.be", created_at: "2026-10-01 10:00:00+00" },
        { id: "b", email: "b@x.be", created_at: "2026-11-01 10:00:00+00", unsubscribed: true },
      ],
    },
  ]);
  assert.deepEqual(
    subs.map((s) => [s.id, s.email, s.langs, s.unsubscribed]),
    [
      ["b", "b@x.be", ["en"], true],
      ["a", "a@x.be", ["nl", "en"], false],
    ],
  );
});

test("summarize counts active per language and new per month", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const subs = mergeSegmentContacts([
    {
      lang: "nl",
      contacts: [
        { id: "1", email: "1@x", created_at: "2026-11-05 09:00:00+00" },
        { id: "2", email: "2@x", created_at: "2026-10-20 09:00:00+00" },
        { id: "3", email: "3@x", created_at: "2026-09-01 09:00:00+00", unsubscribed: true },
      ],
    },
    { lang: "fr", contacts: [{ id: "4", email: "4@x", created_at: "2025-01-01 09:00:00+00" }] },
  ]);
  const s = summarize(subs, now, 3);
  assert.equal(s.active, 3);
  assert.equal(s.unsubscribed, 1);
  assert.equal(s.newLast30Days, 2);
  assert.deepEqual(s.byLang, [
    { lang: "nl", count: 2 },
    { lang: "fr", count: 1 },
  ]);
  assert.deepEqual(s.byMonth, [
    { month: "2026-09", count: 1 },
    { month: "2026-10", count: 1 },
    { month: "2026-11", count: 1 },
  ]);
});

test("csvCell quotes and defuses formulas", () => {
  assert.equal(csvCell("a@b.be"), "a@b.be");
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
});

test("toCsv writes a header, a BOM and the consent scope", () => {
  const csv = toCsv([{ id: "a", email: "a@x.be", langs: ["nl"], unsubscribed: false, createdAt: "2026-10-01T10:00:00.000Z" }]);
  assert.ok(csv.startsWith("﻿email,language,status,first_subscribed,consent,offers_consent,"));
  assert.match(csv, /^a@x\.be,nl,subscribed,2026-10-01T10:00:00\.000Z,"Blog newsletter: new-article emails only[^\r\n]*,no,,,\r$/m);
});

test("toCsv shows offers consent and interests only for a subscribed, consenting address", () => {
  const sub = { id: "a", email: "a@x.be", langs: ["en" as const], unsubscribed: false, createdAt: null };
  const info = new Map([["a@x.be", { optedIn: true, version: "2026-11-v1", consentedAt: "2026-11-09T10:00:00.000Z", interests: ["ai", "chatbots"] }]]);
  assert.match(toCsv([sub], info), /,yes,2026-11-v1,2026-11-09T10:00:00\.000Z,ai chatbots\r\n$/);
  assert.match(toCsv([{ ...sub, unsubscribed: true }], info), /,no,,,\r\n$/);
});
