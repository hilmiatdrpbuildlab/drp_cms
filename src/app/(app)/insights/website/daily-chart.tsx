"use client";

import { useRef, useState } from "react";

import type { DayRow } from "@/lib/insights/website";

const W = 720;
const H = 160;

const dayLabel = (date: string, style: "short" | "long") =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: style === "long" ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: style === "long" ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

/** A round step (1, 2 or 5 × 10ⁿ) giving at most ~4 gridlines up to `max`. */
function yTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/** Daily active users: one line, a crosshair with the day's number on hover or arrow keys, and a table view. */
export function DailyChart({ data }: { data: DayRow[] }) {
  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);

  const ticks = yTicks(Math.max(0, ...data.map((d) => d.activeUsers)));
  const top = ticks[ticks.length - 1];
  const n = data.length;
  const xPct = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const yPct = (v: number) => 100 - (v / top) * 100;
  const points = data.map((d, i) => `${(xPct(i) / 100) * W},${(yPct(d.activeUsers) / 100) * H}`).join(" ");
  const peak = data.reduce((best, d) => (d.activeUsers > best.activeUsers ? d : best), data[0] ?? { date: "", activeUsers: 0 });

  if (n === 0) return <p className="text-sm text-zinc-500">No days in this range.</p>;

  const pick = (clientX: number) => {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const i = Math.round(((clientX - rect.left) / rect.width) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };

  const shown = active === null ? null : data[active];
  const xLabels = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div>
      <div className="flex gap-2">
        {/* y axis */}
        <div className="relative w-8 shrink-0 text-right text-[11px] text-zinc-500 tabular-nums" style={{ height: H }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${yPct(t)}%` }}>
              {t}
            </span>
          ))}
        </div>

        <div
          ref={plot}
          className="relative flex-1 touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          style={{ height: H }}
          tabIndex={0}
          role="img"
          aria-label={`Active users per day, ${dayLabel(data[0].date, "long")} to ${dayLabel(data[n - 1].date, "long")}. Highest: ${peak.activeUsers} on ${dayLabel(peak.date, "long")}. Use the arrow keys to read each day.`}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setActive((a) => Math.min(n - 1, Math.max(0, (a ?? (e.key === "ArrowLeft" ? n : -1)) + (e.key === "ArrowLeft" ? -1 : 1))));
            } else if (e.key === "Escape") setActive(null);
          }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {ticks.map((t) => (
              <line
                key={t}
                x1={0}
                x2={W}
                y1={(yPct(t) / 100) * H}
                y2={(yPct(t) / 100) * H}
                className={t === 0 ? "stroke-zinc-300" : "stroke-zinc-100"}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <polyline
              points={points}
              fill="none"
              className="stroke-accent"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {shown && active !== null && (
            <>
              <span className="pointer-events-none absolute inset-y-0 w-px bg-zinc-400" style={{ left: `${xPct(active)}%` }} aria-hidden />
              <span
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-white"
                style={{ left: `${xPct(active)}%`, top: `${yPct(shown.activeUsers)}%` }}
                aria-hidden
              />
              <span
                role="status"
                className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-md bg-zinc-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow"
                style={xPct(active) > 70 ? { right: `${100 - xPct(active)}%` } : { left: `${xPct(active)}%` }}
              >
                {dayLabel(shown.date, "long")}: <strong className="font-semibold tabular-nums">{shown.activeUsers}</strong> active{" "}
                {shown.activeUsers === 1 ? "user" : "users"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* x axis */}
      <div className="relative mt-1.5 ml-10 h-4 text-[11px] text-zinc-500" aria-hidden>
        {xLabels.map((i) => (
          <span
            key={i}
            className={`absolute whitespace-nowrap ${i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${xPct(i)}%` }}
          >
            {dayLabel(data[i].date, "short")}
          </span>
        ))}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day</th>
                <th className="px-3 py-1.5 text-right font-medium">Active users</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t border-zinc-100">
                  <td className="px-3 py-1">{dayLabel(d.date, "long")}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{d.activeUsers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
