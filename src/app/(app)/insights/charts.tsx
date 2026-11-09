import { LANG_NAMES, type Lang } from "@/lib/blog/contract";

/** Hover/focus tooltip for one bar. Text in ink colours; the bar carries the accent. */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 rounded-md bg-zinc-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow group-hover:block group-focus:block"
    >
      {children}
    </span>
  );
}

/** Active subscribers per language: a ranked horizontal bar list with the count beside each bar. */
export function LanguageBars({ data }: { data: { lang: Lang; count: number }[] }) {
  if (data.length === 0) return <p className="text-sm text-zinc-500">No active subscribers yet.</p>;
  const max = Math.max(...data.map((d) => d.count));
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.lang} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-zinc-700">{LANG_NAMES[d.lang]}</span>
          <span className="h-2.5 rounded-r bg-zinc-100">
            <span className="block h-full rounded-r bg-accent" style={{ width: `${(d.count / max) * 100}%` }} />
          </span>
          <span className="text-right text-zinc-900 tabular-nums">{d.count}</span>
        </li>
      ))}
    </ul>
  );
}

const monthLabel = (key: string, style: "short" | "long") =>
  new Intl.DateTimeFormat("en-GB", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" }).format(
    new Date(`${key}-15T00:00:00Z`),
  );

/** New subscribers per month: columns anchored to the baseline, value on hover or focus. */
export function MonthColumns({ data }: { data: { month: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((n, d) => n + d.count, 0);
  return (
    <div>
      <div className="flex h-32 items-end gap-0.5 border-b border-zinc-200" aria-label={`New subscribers per month, ${total} in total`}>
        {data.map((d) => {
          const label = `${monthLabel(d.month, "long")}: ${d.count} new`;
          return (
            <div key={d.month} tabIndex={0} aria-label={label} className="group relative flex h-full flex-1 items-end outline-none">
              <Tip>{label}</Tip>
              <span
                className="block w-full rounded-t bg-accent group-hover:bg-accent-hover group-focus:bg-accent-hover"
                style={{ height: d.count ? `max(${(d.count / max) * 100}%, 3px)` : 0 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-0.5 text-[11px] text-zinc-500">
        {data.map((d, i) => (
          <span key={d.month} className="flex-1 text-center">
            {(data.length - 1 - i) % 2 === 0 ? monthLabel(d.month, "short") : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
