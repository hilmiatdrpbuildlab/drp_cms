"use client";

import { useMemo, useState } from "react";

import { formatDuration, MIN_PAGE_USERS, pageTable, type PageRow, type PageSortKey } from "@/lib/insights/website";

const COLUMNS: { key: PageSortKey; label: string; numeric: boolean }[] = [
  { key: "path", label: "Page", numeric: false },
  { key: "views", label: "Views", numeric: true },
  { key: "activeUsers", label: "Active users", numeric: true },
  { key: "avgSeconds", label: "Avg. time per user", numeric: true },
];

const fmt = new Intl.NumberFormat("en-GB");

/** Top pages by time spent: sortable by any column, small pages hidden unless asked for. */
export function PagesTable({ pages, siteOrigin }: { pages: PageRow[]; siteOrigin: string }) {
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<{ key: PageSortKey; ascending: boolean }>({ key: "avgSeconds", ascending: false });

  const rows = useMemo(
    () => pageTable(pages, { minUsers: showAll ? 0 : MIN_PAGE_USERS, sortBy: sort.key, ascending: sort.ascending }),
    [pages, showAll, sort],
  );
  const hidden = pages.length - pageTable(pages, { minUsers: MIN_PAGE_USERS }).length;

  const sortBy = (key: PageSortKey) =>
    setSort((s) => (s.key === key ? { key, ascending: !s.ascending } : { key, ascending: key === "path" }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-2.5 text-sm">
        <label className="flex items-center gap-2 text-zinc-700">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="size-4 accent-accent" />
          Show pages with fewer than {MIN_PAGE_USERS} active users{hidden > 0 && !showAll ? ` (${hidden} hidden)` : ""}
        </label>
        <span className="text-xs text-zinc-500">
          {rows.length} of {pages.length} pages
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-zinc-500">
          {pages.length === 0 ? "No page views in this period." : `No page had ${MIN_PAGE_USERS} or more active users. Tick the box to see them all.`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
              {rows.map((p) => (
                <tr key={p.path} className="border-t border-zinc-100 hover:bg-zinc-50">
                  <td className="px-4 py-2">
                    <div className="max-w-[12rem] truncate sm:max-w-md">
                      {p.path.startsWith("/") ? (
                        <a href={siteOrigin + p.path} target="_blank" rel="noopener noreferrer" title={p.path} className="hover:text-accent hover:underline">
                          {p.path}
                        </a>
                      ) : (
                        <span title={p.path}>{p.path}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt.format(p.views)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt.format(p.activeUsers)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatDuration(p.avgSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
