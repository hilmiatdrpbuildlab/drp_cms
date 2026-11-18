import assert from "node:assert/strict";
import { test } from "node:test";

import {
  averageEngagement,
  change,
  fillDays,
  formatDuration,
  gaDateRanges,
  groupPages,
  MARKETS,
  marketFilter,
  marketName,
  marketPrefix,
  marketsIn,
  splitPath,
  parseRange,
  parseServiceAccount,
  readThroughCache,
  type CacheEntry,
  type PageRow,
} from "./website.ts";

// ---- Duration formatting ----

test("formatDuration shows Xm Ys, rounded to the second", () => {
  assert.equal(formatDuration(0), "0m 0s");
  assert.equal(formatDuration(42), "0m 42s");
  assert.equal(formatDuration(60), "1m 0s");
  assert.equal(formatDuration(65.4), "1m 5s");
  assert.equal(formatDuration(59.6), "1m 0s");
  assert.equal(formatDuration(3725), "62m 5s");
});

test("formatDuration treats missing or impossible values as 0m 0s", () => {
  assert.equal(formatDuration(Number.NaN), "0m 0s");
  assert.equal(formatDuration(Number.POSITIVE_INFINITY), "0m 0s");
  assert.equal(formatDuration(-5), "0m 0s");
});

// ---- Averages ----

test("averageEngagement is total engagement divided by active users, 0 for nobody", () => {
  assert.equal(averageEngagement(300, 4), 75);
  assert.equal(averageEngagement(300, 0), 0);
  assert.equal(averageEngagement(Number.NaN, 3), 0);
});

const pages: PageRow[] = [
  { path: "/", views: 400, activeUsers: 200, engagementSeconds: 6000 }, // 30s
  { path: "/blog/long-read", views: 40, activeUsers: 10, engagementSeconds: 2400 }, // 240s
  { path: "/contact", views: 12, activeUsers: 5, engagementSeconds: 250 }, // 50s
  { path: "/blog/odd", views: 3, activeUsers: 2, engagementSeconds: 1200 }, // 600s, but only 2 users
];

test("groupPages adds each page's average per active user and sorts by it, longest first", () => {
  const rows = groupPages(pages);
  assert.deepEqual(
    rows.map((r) => [r.path, r.avgSeconds]),
    [
      ["/blog/odd", 600],
      ["/blog/long-read", 240],
      ["/contact", 50],
      ["/", 30],
    ],
  );
});

test("groupPages hides pages under the active-user minimum, keeping the boundary", () => {
  assert.deepEqual(
    groupPages(pages, { minUsers: 5 }).map((r) => r.path),
    ["/blog/long-read", "/contact", "/"],
  );
});

test("groupPages sorts by other columns; path A-Z, numbers high to low, either way on request", () => {
  assert.deepEqual(groupPages(pages, { sortBy: "views" }).map((r) => r.views), [400, 40, 12, 3]);
  assert.deepEqual(groupPages(pages, { sortBy: "views", ascending: true }).map((r) => r.views), [3, 12, 40, 400]);
  assert.deepEqual(groupPages(pages, { sortBy: "path" }).map((r) => r.path), ["/", "/blog/long-read", "/blog/odd", "/contact"]);
});

test("groupPages breaks ties by active users, then path", () => {
  const tied: PageRow[] = [
    { path: "/b", views: 1, activeUsers: 5, engagementSeconds: 50 },
    { path: "/a", views: 1, activeUsers: 5, engagementSeconds: 50 },
    { path: "/c", views: 1, activeUsers: 10, engagementSeconds: 100 },
  ];
  assert.deepEqual(groupPages(tied).map((r) => r.path), ["/c", "/a", "/b"]);
});

test("groupPages does not change the rows it was given", () => {
  const copy = structuredClone(pages);
  groupPages(pages, { minUsers: 5, sortBy: "views" });
  assert.deepEqual(pages, copy);
});

// ---- Ranges and change ----

test("parseRange accepts 7, 28 and 90 and defaults to 28", () => {
  assert.equal(parseRange("7"), 7);
  assert.equal(parseRange("90"), 90);
  assert.equal(parseRange(["7", "90"]), 7);
  assert.equal(parseRange(undefined), 28);
  assert.equal(parseRange("30"), 28);
  assert.equal(parseRange("abc"), 28);
});

test("gaDateRanges ends yesterday and the previous period is the same length before it", () => {
  assert.deepEqual(gaDateRanges(28), {
    current: { name: "current", startDate: "28daysAgo", endDate: "yesterday" },
    previous: { name: "previous", startDate: "56daysAgo", endDate: "29daysAgo" },
  });
  assert.deepEqual(gaDateRanges(7).previous, { name: "previous", startDate: "14daysAgo", endDate: "8daysAgo" });
});

test("change is relative to the previous period, null with nothing before", () => {
  assert.equal(change(150, 100), 0.5);
  assert.equal(change(50, 100), -0.5);
  assert.equal(change(5, 0), null);
});

// ---- Daily series ----

test("fillDays covers every day of the range up to yesterday in the property's zone, 0 where GA4 had nothing", () => {
  // 18 Nov 2026, 23:30 UTC is already 19 Nov in Jakarta, so yesterday there is 18 Nov.
  const now = new Date("2026-11-18T23:30:00Z");
  const days = fillDays(
    [
      { date: "20261118", activeUsers: 9 },
      { date: "20261116", activeUsers: 4 },
      { date: "20261101", activeUsers: 99 }, // outside the range
    ],
    3,
    "Asia/Jakarta",
    now,
  );
  assert.deepEqual(days, [
    { date: "2026-11-16", activeUsers: 4 },
    { date: "2026-11-17", activeUsers: 0 },
    { date: "2026-11-18", activeUsers: 9 },
  ]);
  // The same moment is still 18 Nov in UTC, so there yesterday is 17 Nov.
  assert.deepEqual(
    fillDays([], 2, "UTC", now).map((d) => d.date),
    ["2026-11-16", "2026-11-17"],
  );
});

test("fillDays crosses month ends", () => {
  const days = fillDays([{ date: "20261031", activeUsers: 1 }], 3, "UTC", new Date("2026-11-02T12:00:00Z"));
  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-10-30", "2026-10-31", "2026-11-01"],
  );
});

// ---- Cache with fallback ----

function memoryCache<T>(initial?: CacheEntry<T>) {
  let entry = initial ?? null;
  const writes: CacheEntry<T>[] = [];
  return {
    read: async () => entry,
    write: async (e: CacheEntry<T>) => {
      entry = e;
      writes.push(e);
    },
    writes,
  };
}

const at = (iso: string) => () => new Date(iso);
const HOUR = 60 * 60 * 1000;

test("readThroughCache reuses an answer younger than the max age without calling Google", async () => {
  const cache = memoryCache({ data: "old", fetchedAt: new Date("2026-11-18T10:00:00Z") });
  let loads = 0;
  const r = await readThroughCache({ ...cache, load: async () => (loads++, "new"), maxAgeMs: HOUR, now: at("2026-11-18T10:59:00Z") });
  assert.deepEqual([r.data, r.source, loads], ["old", "cache", 0]);
});

test("readThroughCache loads and stores fresh data once the cache is an hour old", async () => {
  const cache = memoryCache({ data: "old", fetchedAt: new Date("2026-11-18T10:00:00Z") });
  const r = await readThroughCache({ ...cache, load: async () => "new", maxAgeMs: HOUR, now: at("2026-11-18T11:00:00Z") });
  assert.deepEqual([r.data, r.source, r.fetchedAt.toISOString()], ["new", "live", "2026-11-18T11:00:00.000Z"]);
  assert.equal(cache.writes.length, 1);
});

test("readThroughCache with force skips a fresh cache (the Refresh button)", async () => {
  const cache = memoryCache({ data: "old", fetchedAt: new Date("2026-11-18T10:00:00Z") });
  const r = await readThroughCache({ ...cache, load: async () => "new", maxAgeMs: HOUR, force: true, now: at("2026-11-18T10:01:00Z") });
  assert.deepEqual([r.data, r.source], ["new", "live"]);
});

test("readThroughCache falls back to the last cached data, however old, when Google fails", async () => {
  const fetchedAt = new Date("2026-11-15T08:00:00Z");
  const cache = memoryCache({ data: "last good", fetchedAt });
  const r = await readThroughCache({
    ...cache,
    load: async () => {
      throw new Error("quota exceeded");
    },
    maxAgeMs: HOUR,
    now: at("2026-11-18T10:00:00Z"),
  });
  assert.deepEqual([r.data, r.source, r.fetchedAt], ["last good", "stale", fetchedAt]);
  assert.equal(cache.writes.length, 0, "a failure must not overwrite the last good data");
});

test("readThroughCache falls back on a failed forced refresh too", async () => {
  const cache = memoryCache({ data: "last good", fetchedAt: new Date("2026-11-18T09:59:00Z") });
  const r = await readThroughCache({
    ...cache,
    load: () => Promise.reject(new Error("down")),
    maxAgeMs: HOUR,
    force: true,
    now: at("2026-11-18T10:00:00Z"),
  });
  assert.equal(r.source, "stale");
});

test("readThroughCache passes the error on when there is nothing cached to show", async () => {
  const cache = memoryCache<string>();
  await assert.rejects(
    readThroughCache({ ...cache, load: () => Promise.reject(new Error("down")), maxAgeMs: HOUR }),
    /down/,
  );
});

// ---- Service account key ----

const KEY = {
  type: "service_account",
  project_id: "drp-analytics",
  client_email: "cms-ga4@drp-analytics.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nSECRETSECRET\n-----END PRIVATE KEY-----\n",
};

test("parseServiceAccount reads the key file JSON, as is or base64-encoded", () => {
  const json = JSON.stringify(KEY);
  const expected = { client_email: KEY.client_email, private_key: KEY.private_key, project_id: "drp-analytics" };
  assert.deepEqual(parseServiceAccount(json), expected);
  assert.deepEqual(parseServiceAccount(Buffer.from(json).toString("base64")), expected);
});

test("parseServiceAccount restores newlines an env editor turned into \\n", () => {
  const mangled = JSON.stringify({ ...KEY, private_key: KEY.private_key.replace(/\n/g, "\\n") });
  assert.equal(parseServiceAccount(mangled).private_key, KEY.private_key);
});

test("parseServiceAccount errors never quote the key", () => {
  for (const bad of [JSON.stringify(KEY).slice(0, -5), JSON.stringify({ ...KEY, type: "user" }), "  "]) {
    assert.throws(
      () => parseServiceAccount(bad),
      (e: Error) => !e.message.includes("SECRET") && !e.message.includes(KEY.client_email) && e.message.startsWith("GA4_SERVICE_ACCOUNT_JSON"),
    );
  }
});

// ---- Markets ----

test("splitPath separates the market prefix from the page, nested language versions included", () => {
  assert.deepEqual(splitPath("/be/prijzen/"), { market: "be", page: "/prijzen/" });
  assert.deepEqual(splitPath("/be/fr/prijzen/"), { market: "be-fr", page: "/prijzen/" });
  assert.deepEqual(splitPath("/ch/de/blog/a-post/"), { market: "ch-de", page: "/blog/a-post/" });
  assert.deepEqual(splitPath("/be/"), { market: "be", page: "/" });
  assert.deepEqual(splitPath("/be"), { market: "be", page: "/" });
  assert.deepEqual(splitPath("/be/werk"), { market: "be", page: "/werk" });
  // 'be-de' is not a market, so 'de' is a page under Belgium.
  assert.deepEqual(splitPath("/be/de/"), { market: "be", page: "/de/" });
});

test("splitPath leaves paths outside a market as they are", () => {
  assert.deepEqual(splitPath("/"), { market: null, page: "/" });
  assert.deepEqual(splitPath("/404.html"), { market: null, page: "/404.html" });
  assert.deepEqual(splitPath("/xx/prijzen/"), { market: null, page: "/xx/prijzen/" });
});

test("groupPages adds a page up across markets and keeps each market's row", () => {
  const groups = groupPages([
    { path: "/be/prijzen/", views: 84, activeUsers: 52, engagementSeconds: 2756 },
    { path: "/nl/prijzen/", views: 6, activeUsers: 5, engagementSeconds: 205 },
    { path: "/be/fr/prijzen/", views: 2, activeUsers: 1, engagementSeconds: 40 },
    { path: "/be/", views: 454, activeUsers: 198, engagementSeconds: 9306 },
    { path: "/", views: 3, activeUsers: 3, engagementSeconds: 6 },
  ]);
  const prijzen = groups.find((g) => g.page === "/prijzen/")!;
  assert.deepEqual([prijzen.views, prijzen.activeUsers, prijzen.engagementSeconds], [92, 58, 3001]);
  assert.equal(prijzen.avgSeconds, 3001 / 58);
  assert.deepEqual(
    prijzen.markets.map((m) => [m.market, m.path, m.avgSeconds]),
    // Market rows sort like the groups: longest average first.
    [
      ["be", "/be/prijzen/", 53],
      ["nl", "/nl/prijzen/", 41],
      ["be-fr", "/be/fr/prijzen/", 40],
    ],
  );
  // The site root and the market homes are all the home page.
  assert.deepEqual(
    groups.find((g) => g.page === "/")!.markets.map((m) => m.market),
    ["be", null],
  );
});

test("groupPages applies the active-user minimum to the page's total, not per market", () => {
  const groups = groupPages(
    [
      { path: "/be/werk/", views: 4, activeUsers: 3, engagementSeconds: 90 },
      { path: "/nl/werk/", views: 3, activeUsers: 2, engagementSeconds: 60 },
      { path: "/be/blog/x/", views: 4, activeUsers: 4, engagementSeconds: 90 },
    ],
    { minUsers: 5 },
  );
  assert.deepEqual(
    groups.map((g) => [g.page, g.markets.length]),
    [["/werk/", 2]],
  );
});

test("marketsIn lists the markets present, once each", () => {
  assert.deepEqual(
    marketsIn([
      { path: "/be/", views: 1, activeUsers: 1, engagementSeconds: 1 },
      { path: "/be/werk/", views: 1, activeUsers: 1, engagementSeconds: 1 },
      { path: "/ch/de/", views: 1, activeUsers: 1, engagementSeconds: 1 },
      { path: "/", views: 1, activeUsers: 1, engagementSeconds: 1 },
    ]),
    ["be", "ch-de"],
  );
});

test("marketFilter takes a market's prefix but not its nested language versions", () => {
  assert.deepEqual(marketFilter("nl"), { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: "/nl/" } } });
  assert.deepEqual(marketFilter("ch-de"), { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: "/ch/de/" } } });
  const ch = marketFilter("ch") as { andGroup: { expressions: { filter?: { stringFilter: { value: string } }; notExpression?: { filter: { stringFilter: { value: string } } } }[] } };
  assert.deepEqual(
    ch.andGroup.expressions.map((e) => (e.filter ? `+${e.filter.stringFilter.value}` : `-${e.notExpression!.filter.stringFilter.value}`)),
    ["+/ch/", "-/ch/de/", "-/ch/it/"],
  );
});

test("every market has a name and a prefix GA4 paths can start with", () => {
  for (const [key, name] of Object.entries(MARKETS)) {
    assert.match(key, /^[a-z]{2}(-[a-z]{2})?$/);
    assert.ok(name.length > 1);
    assert.equal(splitPath(`${marketPrefix(key)}x/`).market, key);
  }
  assert.equal(marketName(null), "No market");
  assert.equal(marketName("be-fr"), "Belgium (French)");
});
