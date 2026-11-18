/**
 * Website analytics for drpbuildlab.com, from Google Analytics 4 (property "DRP Build Lab").
 * GA4 collects through the site's Google Tag Manager container; the CMS only reads reports.
 *
 * Pure module (no server/DB imports) so it can be unit-tested with `node --test`.
 * The Google client and the cache table are in website-server.ts.
 */

export const RANGES = [7, 28, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export const DEFAULT_RANGE: RangeDays = 28;

/** Pages with fewer active users than this are hidden by default: their averages are noise. */
export const MIN_PAGE_USERS = 5;

/** How long a GA4 answer is reused before asking Google again. */
export const CACHE_MAX_AGE_MS = 60 * 60 * 1000;

export function parseRange(v: string | string[] | undefined): RangeDays {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : DEFAULT_RANGE;
}

/**
 * GA4 date ranges, in the property's time zone. Like GA4's own "Last 28 days", a range ends
 * yesterday (today is still incomplete), and the previous period is the same length right before it.
 */
export function gaDateRanges(days: RangeDays) {
  return {
    current: { name: "current", startDate: `${days}daysAgo`, endDate: "yesterday" },
    previous: { name: "previous", startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` },
  };
}

export type Totals = { activeUsers: number; newUsers: number; views: number; engagementSeconds: number };
export type PageRow = { path: string; views: number; activeUsers: number; engagementSeconds: number };
export type DayRow = { date: string; activeUsers: number };

/** Everything the panel shows for one range: what is cached and what the page renders. */
export type WebsiteSnapshot = {
  days: RangeDays;
  /** The GA4 property's time zone; dates are days in this zone. */
  timeZone: string;
  current: Totals;
  previous: Totals;
  /** Up to 100 pages with the most total engagement time. */
  pages: PageRow[];
  /** One entry per day of the range, oldest first, `YYYY-MM-DD`; days without visitors are 0. */
  daily: DayRow[];
};

/** Average engagement time per active user, in seconds; 0 when nobody was active. */
export function averageEngagement(engagementSeconds: number, activeUsers: number): number {
  return activeUsers > 0 && Number.isFinite(engagementSeconds) ? engagementSeconds / activeUsers : 0;
}

/** Seconds as "Xm Ys", rounded to the second, like GA4 shows engagement time. */
export function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/** Change versus the previous period as a fraction (0.25 = +25%), or null when there was nothing before. */
export function change(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return (current - previous) / previous;
}

export type PageWithAverage = PageRow & { avgSeconds: number };
export type PageSortKey = "path" | "views" | "activeUsers" | "avgSeconds";

/**
 * The top-pages table: each page's average engagement time per active user, optionally only pages
 * with at least `minUsers` active users, sorted by `sortBy` (path A-Z ascending, numbers descending
 * unless `ascending`). Ties go to the page with more active users, then by path.
 */
export function pageTable(
  pages: PageRow[],
  { minUsers = 0, sortBy = "avgSeconds", ascending }: { minUsers?: number; sortBy?: PageSortKey; ascending?: boolean } = {},
): PageWithAverage[] {
  const asc = ascending ?? sortBy === "path";
  const rows = pages
    .filter((p) => p.activeUsers >= minUsers)
    .map((p) => ({ ...p, avgSeconds: averageEngagement(p.engagementSeconds, p.activeUsers) }));
  const dir = asc ? 1 : -1;
  return rows.sort((a, b) => {
    const primary = sortBy === "path" ? a.path.localeCompare(b.path) : a[sortBy] - b[sortBy];
    return primary * dir || b.activeUsers - a.activeUsers || a.path.localeCompare(b.path);
  });
}

/** Today's date in `timeZone` as YYYY-MM-DD. */
function dateIn(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * GA4 leaves out days without data, so fill the range: `days` days ending yesterday in the
 * property's time zone. `rows` are GA4's `date` dimension values (YYYYMMDD).
 */
export function fillDays(rows: { date: string; activeUsers: number }[], days: number, timeZone: string, now = new Date()): DayRow[] {
  const byDate = new Map(rows.map((r) => [`${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`, r.activeUsers]));
  const yesterday = addDays(dateIn(timeZone, now), -1);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(yesterday, i - days + 1);
    return { date, activeUsers: byDate.get(date) ?? 0 };
  });
}

// ---- Cache with fallback ----------------------------------------------------------------------

export type CacheEntry<T> = { data: T; fetchedAt: Date };
export type CachedResult<T> = CacheEntry<T> & {
  /** cache: reused, under an hour old. live: just fetched. stale: Google failed, this is the last good answer. */
  source: "cache" | "live" | "stale";
};

/**
 * Serve from the cache while it is younger than `maxAgeMs`; otherwise (or with `force`) load fresh
 * data and store it. If loading fails, fall back to whatever the cache has, however old, so the
 * panel is never blank; only with no cached data at all does the error reach the caller.
 * `read` and `write` must not throw (the server versions log and swallow database errors).
 */
export async function readThroughCache<T>({
  read,
  write,
  load,
  maxAgeMs,
  force = false,
  now = () => new Date(),
}: {
  read: () => Promise<CacheEntry<T> | null>;
  write: (entry: CacheEntry<T>) => Promise<void>;
  load: () => Promise<T>;
  maxAgeMs: number;
  force?: boolean;
  now?: () => Date;
}): Promise<CachedResult<T>> {
  const cached = await read();
  if (cached && !force && now().getTime() - cached.fetchedAt.getTime() < maxAgeMs) return { ...cached, source: "cache" };
  try {
    const entry = { data: await load(), fetchedAt: now() };
    await write(entry);
    return { ...entry, source: "live" };
  } catch (e) {
    if (cached) return { ...cached, source: "stale" };
    throw e;
  }
}

// ---- Service account key ----------------------------------------------------------------------

export type ServiceAccount = { client_email: string; private_key: string; project_id?: string };

/**
 * GA4_SERVICE_ACCOUNT_JSON: the downloaded key file's JSON, as is or base64-encoded.
 * Errors never quote the value: it holds the private key.
 */
export function parseServiceAccount(raw: string | undefined): ServiceAccount {
  const text = raw?.trim();
  if (!text) throw new Error("GA4_SERVICE_ACCOUNT_JSON is not set");
  let json: unknown;
  try {
    json = JSON.parse(text.startsWith("{") ? text : Buffer.from(text, "base64").toString("utf8"));
  } catch {
    throw new Error("GA4_SERVICE_ACCOUNT_JSON is not valid JSON (paste the whole key file, or its base64)");
  }
  const key = json as Partial<Record<string, unknown>>;
  if (key?.type !== "service_account" || typeof key.client_email !== "string" || typeof key.private_key !== "string") {
    throw new Error("GA4_SERVICE_ACCOUNT_JSON is not a service account key (needs type, client_email and private_key)");
  }
  return {
    client_email: key.client_email,
    // Some env editors turn the key's newlines into literal "\n".
    private_key: key.private_key.replace(/\\n/g, "\n"),
    project_id: typeof key.project_id === "string" ? key.project_id : undefined,
  };
}
