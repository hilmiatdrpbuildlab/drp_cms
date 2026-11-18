import type { Metadata } from "next";
import Link from "next/link";

import { requireStaff } from "@/auth/server";
import { getEnv } from "@/lib/env";
import {
  averageEngagement,
  change,
  formatDuration,
  parseRange,
  RANGES,
  type CachedResult,
  type RangeDays,
  type WebsiteSnapshot,
} from "@/lib/insights/website";
import { getWebsiteAnalytics, websiteSetupProblems } from "@/lib/insights/website-server";

import { InsightsTabs } from "../tabs";
import { DailyChart } from "./daily-chart";
import { MarketTable, PagesTable } from "./pages-table";
import { LocalTime, RefreshButton } from "./refresh-button";

export const metadata: Metadata = { title: "Website analytics" };

const fmt = new Intl.NumberFormat("en-GB");

function Card({ title, note, children, flush }: { title: string; note?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white">
      <header className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-zinc-500">{note}</p>}
      </header>
      {flush ? children : <div className="p-4">{children}</div>}
    </section>
  );
}

function Change({ value, days }: { value: number | null; days: number }) {
  if (value === null) return <p className="mt-0.5 text-xs text-zinc-500">No data for the {days} days before</p>;
  const pct = Math.round(value * 100);
  const [arrow, tone] = pct > 0 ? ["▲", "text-emerald-700"] : pct < 0 ? ["▼", "text-red-700"] : ["", "text-zinc-500"];
  return (
    <p className="mt-0.5 text-xs text-zinc-500">
      <span className={`font-medium ${tone}`}>
        {arrow && <span aria-hidden>{arrow} </span>}
        {pct > 0 ? "+" : pct < 0 ? "−" : "±"}
        {Math.abs(pct)}%
      </span>{" "}
      vs the {days} days before
    </p>
  );
}

function Stat({ label, value, delta, days }: { label: string; value: string; delta: number | null; days: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      <Change value={delta} days={days} />
    </div>
  );
}

export default async function WebsiteAnalytics({ searchParams }: { searchParams: Promise<{ days?: string | string[] }> }) {
  const staff = await requireStaff();
  if (!staff.isAdmin) {
    return (
      <Shell>
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-600">
          Website analytics is for admins. Ask an admin to give your account the admin role if you need it.
        </div>
      </Shell>
    );
  }

  const days = parseRange((await searchParams).days);

  const problems = websiteSetupProblems();
  if (problems.length) {
    return (
      <Shell days={days}>
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-600">
          <p className="font-medium text-zinc-900">Google Analytics is not connected yet.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-3">See README.md, “Website analytics”, for the setup steps.</p>
        </div>
      </Shell>
    );
  }

  let result: CachedResult<WebsiteSnapshot>;
  try {
    result = await getWebsiteAnalytics(days);
  } catch {
    return (
      <Shell days={days} controls={<RefreshButton days={days} />}>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not read the report from Google Analytics, and there is no saved data to show yet. Try Refresh in a minute. If it keeps
          failing, check that the service account has the Viewer role on the GA4 property (README.md, “Website analytics”).
        </div>
      </Shell>
    );
  }

  const { data, fetchedAt, source } = result;
  const { current: cur, previous: prev } = data;
  const avgNow = averageEngagement(cur.engagementSeconds, cur.activeUsers);
  const avgBefore = averageEngagement(prev.engagementSeconds, prev.activeUsers);

  return (
    <Shell
      days={days}
      controls={
        <>
          <span className="text-xs text-zinc-500">
            {source === "stale" ? "Data from " : "Updated "}
            <LocalTime iso={fetchedAt.toISOString()} />
          </span>
          <RefreshButton days={days} />
        </>
      }
    >
      {source === "stale" && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Google Analytics could not be reached.</strong> Showing the last saved data, from{" "}
          <LocalTime iso={fetchedAt.toISOString()} />.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active users" value={fmt.format(cur.activeUsers)} delta={change(cur.activeUsers, prev.activeUsers)} days={days} />
        <Stat label="New users" value={fmt.format(cur.newUsers)} delta={change(cur.newUsers, prev.newUsers)} days={days} />
        <Stat label="Page views" value={fmt.format(cur.views)} delta={change(cur.views, prev.views)} days={days} />
        <Stat label="Avg. time on site" value={formatDuration(avgNow)} delta={change(avgNow, avgBefore)} days={days} />
      </div>

      <p className="text-xs text-zinc-500">
        Numbers exclude or only estimate visitors who declined analytics cookies. “Avg. time on site” is total engagement time divided by
        active users, as in GA4. The last {days} days up to yesterday, in the property’s time zone ({data.timeZone}).
      </p>

      <Card title="Active users per day" note="Hover, or focus and use the arrow keys, to read a day.">
        <DailyChart data={data.daily} />
      </Card>

      <Card title="By market" note="Each market’s pages together, counted by GA4: someone who read several of its pages counts once." flush>
        <MarketTable markets={data.markets} />
      </Card>

      <Card
        title="Pages by time spent"
        note="One row per page across all markets (/be/prijzen/ and /nl/prijzen/ are /prijzen/); open a row to see each market. Active users are added up per market, so someone who read the same page in two markets counts twice. Click a column to sort."
        flush
      >
        <PagesTable pages={data.pages} siteOrigin={getEnv().SITE_ORIGIN} />
      </Card>
    </Shell>
  );
}

function Shell({ children, days, controls }: { children: React.ReactNode; days?: RangeDays; controls?: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="mt-1 text-sm text-zinc-500">Visitors to drpbuildlab.com, from Google Analytics 4. Admins only.</p>
      </div>
      <InsightsTabs active="website" />
      {days && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="inline-flex rounded-lg border border-zinc-200 bg-white p-1 text-sm" aria-label="Date range">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/insights/website?days=${r}`}
                aria-current={r === days ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 ${r === days ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
              >
                Last {r} days
              </Link>
            ))}
          </nav>
          {controls && <div className="flex flex-wrap items-center gap-3">{controls}</div>}
        </div>
      )}
      {children}
    </main>
  );
}
