"use client";

import { Fragment, useMemo, useState } from "react";

import {
  averageEngagement,
  formatDuration,
  groupPages,
  marketName,
  marketPrefix,
  MIN_PAGE_USERS,
  type MarketRow,
  type PageRow,
  type PageSortKey,
} from "@/lib/insights/website";

const fmt = new Intl.NumberFormat("en-GB");

const pageLabel = (page: string) => (page === "/" ? "/ (home)" : page);

/** Each market's totals as GA4 counts them (a person once per market). Most active users first. */
export function MarketTable({ markets }: { markets: MarketRow[] }) {
  if (markets.length === 0) return <p className="p-6 text-center text-sm text-zinc-500">No visits to a market in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Market
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Views
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Active users
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Avg. time per user
            </th>
          </tr>
        </thead>
        <tbody>
          {markets.map((m) => (
            <tr key={m.market} className="border-t border-zinc-100">
              <td className="px-4 py-2">
                {marketName(m.market)} <span className="text-xs text-zinc-400">{marketPrefix(m.market)}</span>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt.format(m.views)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt.format(m.activeUsers)}</td>
              <td className="px-4 py-2 text-right font-medium tabular-nums">{formatDuration(averageEngagement(m.engagementSeconds, m.activeUsers))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COLUMNS: { key: PageSortKey; label: string; numeric: boolean }[] = [
  { key: "path", label: "Page", numeric: false },
  { key: "views", label: "Views", numeric: true },
  { key: "activeUsers", label: "Active users", numeric: true },
  { key: "avgSeconds", label: "Avg. time per user", numeric: true },
];

/** Pages by time spent, one row per page across all markets; open a row for each market's numbers. */
export function PagesTable({ pages, siteOrigin }: { pages: PageRow[]; siteOrigin: string }) {
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<{ key: PageSortKey; ascending: boolean }>({ key: "avgSeconds", ascending: false });
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const all = useMemo(() => groupPages(pages), [pages]);
  const rows = useMemo(
    () => groupPages(pages, { minUsers: showAll ? 0 : MIN_PAGE_USERS, sortBy: sort.key, ascending: sort.ascending }),
    [pages, showAll, sort],
  );
  const hidden = all.length - all.filter((g) => g.activeUsers >= MIN_PAGE_USERS).length;

  const sortBy = (key: PageSortKey) =>
    setSort((s) => (s.key === key ? { key, ascending: !s.ascending } : { key, ascending: key === "path" }));
  const toggle = (page: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(page)) next.add(page);
      return next;
    });
  const allOpen = rows.length > 0 && rows.every((g) => open.has(g.page));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2.5 text-sm">
        <label className="flex items-center gap-2 text-zinc-700">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="size-4 accent-accent" />
          Show pages with fewer than {MIN_PAGE_USERS} active users{hidden > 0 && !showAll ? ` (${hidden} hidden)` : ""}
        </label>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <button type="button" className="hover:text-zinc-900" onClick={() => setOpen(allOpen ? new Set() : new Set(rows.map((g) => g.page)))}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
          <span>
            {rows.length} of {all.length} pages
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-zinc-500">
          {all.length === 0 ? "No page views in this period." : `No page had ${MIN_PAGE_USERS} or more active users. Tick the box to see them all.`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                {COLUMNS.map((c) => {
                  const current = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={current ? (sort.ascending ? "ascending" : "descending") : undefined}
                      className={`px-4 py-2 font-medium ${c.numeric ? "text-right" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => sortBy(c.key)}
                        className={`inline-flex items-center gap-1 hover:text-zinc-900 ${current ? "text-zinc-900" : ""}`}
                      >
                        {c.label}
                        <span aria-hidden className={current ? "" : "invisible"}>
                          {sort.ascending ? "↑" : "↓"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const isOpen = open.has(g.page);
                return (
                  <Fragment key={g.page}>
                    <tr className="border-t border-zinc-100 hover:bg-zinc-50">
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => toggle(g.page)}
                          aria-expanded={isOpen}
                          className="flex max-w-[14rem] items-center gap-2 text-left sm:max-w-md"
                          title={g.page}
                        >
                          <span aria-hidden className="w-3 shrink-0 text-xs text-zinc-400">
                            {isOpen ? "▾" : "▸"}
                          </span>
                          <span className="truncate">{pageLabel(g.page)}</span>
                          <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 text-[11px] text-zinc-500">
                            {g.markets.length} {g.markets.length === 1 ? "market" : "markets"}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt.format(g.views)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmt.format(g.activeUsers)}</td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums">{formatDuration(g.avgSeconds)}</td>
                    </tr>
                    {isOpen &&
                      g.markets.map((m) => (
                        <tr key={m.path} className="bg-zinc-50/60 text-zinc-600">
                          <td className="py-1.5 pr-4 pl-11">
                            <div className="max-w-[12rem] truncate sm:max-w-md">
                              {marketName(m.market)}{" "}
                              {m.path.startsWith("/") ? (
                                <a
                                  href={siteOrigin + m.path}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-zinc-400 hover:text-accent hover:underline"
                                  title={m.path}
                                >
                                  {m.path}
                                </a>
                              ) : (
                                <span className="text-xs text-zinc-400">{m.path}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums">{fmt.format(m.views)}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums">{fmt.format(m.activeUsers)}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums">{formatDuration(m.avgSeconds)}</td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
