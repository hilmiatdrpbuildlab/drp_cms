import "server-only";

import { BetaAnalyticsDataClient, type protos } from "@google-analytics/data";
import { eq, sql } from "drizzle-orm";
import { GoogleAuth, JWT } from "google-auth-library";

import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { analyticsCache } from "@/lib/schema";

import {
  CACHE_MAX_AGE_MS,
  fillDays,
  gaDateRanges,
  marketFilter,
  marketsIn,
  PAGE_LIMIT,
  parseServiceAccount,
  readThroughCache,
  type CacheEntry,
  type CachedResult,
  type MarketRow,
  type PageRow,
  type RangeDays,
  type Totals,
  type WebsiteSnapshot,
} from "./website";

/**
 * GA4 Data API (v1beta runReport), server-only, with the service account in GA4_SERVICE_ACCOUNT_JSON.
 * Answers are kept in the `analytics_cache` table for an hour; see website.ts for the rules.
 */

type Report = protos.google.analytics.data.v1beta.IRunReportResponse;

/** What is missing before the panel can work; empty when it's set up. Never includes the values. */
export function websiteSetupProblems(): string[] {
  const env = getEnv();
  const problems: string[] = [];
  if (!env.GA4_PROPERTY_ID) problems.push("GA4_PROPERTY_ID is not set");
  else if (!/^\d+$/.test(env.GA4_PROPERTY_ID)) problems.push("GA4_PROPERTY_ID must be the numeric property id (552973295)");
  try {
    parseServiceAccount(env.GA4_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    problems.push((e as Error).message);
  }
  return problems;
}

let client: BetaAnalyticsDataClient | undefined;
function getClient() {
  if (!client) {
    const key = parseServiceAccount(getEnv().GA4_SERVICE_ACCOUNT_JSON);
    const jwt = new JWT({ email: key.client_email, key: key.private_key, scopes: ["https://www.googleapis.com/auth/analytics.readonly"] });
    // REST instead of gRPC: simpler in serverless functions, and three small reports an hour don't need streaming.
    client = new BetaAnalyticsDataClient({ auth: new GoogleAuth({ authClient: jwt, projectId: key.project_id }), fallback: true });
  }
  return client;
}

const num = (v: string | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function runReport(request: protos.google.analytics.data.v1beta.IRunReportRequest): Promise<Report> {
  const [res] = await getClient().runReport({ property: `properties/${getEnv().GA4_PROPERTY_ID}`, ...request }, { timeout: 20_000 });
  return res;
}

const TOTAL_METRICS = ["activeUsers", "newUsers", "screenPageViews", "userEngagementDuration"].map((name) => ({ name }));
/** Views, active users, engagement time: the order PageRow and MarketRow are read in. */
const PAGE_METRICS = ["screenPageViews", "activeUsers", "userEngagementDuration"].map((name) => ({ name }));

/** The three reports for one range, straight from GA4. */
async function loadSnapshot(days: RangeDays): Promise<WebsiteSnapshot> {
  const ranges = gaDateRanges(days);
  const [totals, pages, daily] = await Promise.all([
    // 1. Site totals, current and previous period. With two date ranges GA4 adds a `dateRange`
    //    dimension holding each range's name; a range without any data has no row.
    runReport({ dateRanges: [ranges.current, ranges.previous], metrics: TOTAL_METRICS }),
    // 2. Pages, most total engagement time first. All of them, so pages grouped across markets add up.
    runReport({
      dateRanges: [ranges.current],
      dimensions: [{ name: "pagePath" }],
      metrics: PAGE_METRICS,
      orderBys: [{ metric: { metricName: "userEngagementDuration" }, desc: true }],
      limit: PAGE_LIMIT,
    }),
    // 3. Active users per day.
    runReport({
      dateRanges: [ranges.current],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
  ]);

  const totalsFor = (name: string): Totals => {
    const row = totals.rows?.find((r) => r.dimensionValues?.[0]?.value === name);
    const m = row?.metricValues ?? [];
    return { activeUsers: num(m[0]?.value), newUsers: num(m[1]?.value), views: num(m[2]?.value), engagementSeconds: num(m[3]?.value) };
  };

  const pageRows: PageRow[] = (pages.rows ?? []).map((r) => ({
    path: r.dimensionValues?.[0]?.value ?? "(not set)",
    views: num(r.metricValues?.[0]?.value),
    activeUsers: num(r.metricValues?.[1]?.value),
    engagementSeconds: num(r.metricValues?.[2]?.value),
  }));

  const timeZone = daily.metadata?.timeZone || totals.metadata?.timeZone || "UTC";
  const dayRows = (daily.rows ?? []).map((r) => ({ date: r.dimensionValues?.[0]?.value ?? "", activeUsers: num(r.metricValues?.[0]?.value) }));

  // 4. Per market, one small report each for the markets that had visits: GA4 counts a person once
  //    per market however many of its pages they read, which adding up page rows can't do.
  const markets = (
    await mapLimit(marketsIn(pageRows), 4, async (market): Promise<MarketRow> => {
      const res = await runReport({ dateRanges: [ranges.current], metrics: PAGE_METRICS, dimensionFilter: marketFilter(market) });
      const m = res.rows?.[0]?.metricValues ?? [];
      return { market, views: num(m[0]?.value), activeUsers: num(m[1]?.value), engagementSeconds: num(m[2]?.value) };
    })
  ).sort((a, b) => b.activeUsers - a.activeUsers || b.views - a.views);

  return {
    days,
    timeZone,
    current: totalsFor("current"),
    previous: totalsFor("previous"),
    pages: pageRows,
    markets,
    daily: fillDays(dayRows, days, timeZone),
  };
}

/** `fn` over `items`, at most `limit` at a time (GA4 allows 10 concurrent requests per property). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// The cache table may not exist before `npm run db:migrate`; the panel then works without it.
async function readCache(key: string): Promise<CacheEntry<WebsiteSnapshot> | null> {
  try {
    const [row] = await getDb().select().from(analyticsCache).where(eq(analyticsCache.key, key));
    return row ? { data: row.data as WebsiteSnapshot, fetchedAt: row.fetchedAt } : null;
  } catch (e) {
    console.error("[website] cache read failed", e instanceof Error ? e.message : e);
    return null;
  }
}

async function writeCache(key: string, entry: CacheEntry<WebsiteSnapshot>) {
  try {
    await getDb()
      .insert(analyticsCache)
      .values({ key, data: entry.data, fetchedAt: entry.fetchedAt })
      .onConflictDoUpdate({ target: analyticsCache.key, set: { data: sql`excluded.data`, fetchedAt: sql`excluded.fetched_at` } });
  } catch (e) {
    console.error("[website] cache write failed", e instanceof Error ? e.message : e);
  }
}

/** Requests for the same range in one server process share one trip to Google. */
const inflight = new Map<string, Promise<CachedResult<WebsiteSnapshot>>>();

/**
 * The panel's data for `days`: cached for an hour, `force` (the Refresh button) asks Google now.
 * If Google fails, the last cached answer comes back with source "stale"; with nothing cached, it throws.
 */
export function getWebsiteAnalytics(days: RangeDays, { force = false } = {}): Promise<CachedResult<WebsiteSnapshot>> {
  // v2: snapshots with per-market totals. Older rows lack them, so they're not reused.
  const key = `ga4:website:v2:${days}`;
  const flightKey = `${key}:${force}`;
  const running = inflight.get(flightKey);
  if (running) return running;
  const p = readThroughCache({
    read: () => readCache(key),
    write: (entry) => writeCache(key, entry),
    load: () =>
      loadSnapshot(days).catch((e: unknown) => {
        // Google's message (e.g. PERMISSION_DENIED) only; the request and credentials stay out of the logs.
        console.error("[website] GA4 report failed", e instanceof Error ? e.message : String(e));
        throw e;
      }),
    maxAgeMs: CACHE_MAX_AGE_MS,
    force,
  }).finally(() => inflight.delete(flightKey));
  inflight.set(flightKey, p);
  return p;
}
