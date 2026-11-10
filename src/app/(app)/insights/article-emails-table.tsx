"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { LANG_NAMES } from "@/lib/blog/contract";
import type { ArticleEmailSnapshot } from "@/lib/insights/article-emails-server";

/** How often an open, visible dashboard asks Resend again. */
const POLL_MS = 30_000;

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeStyle: "medium", timeZone: "Europe/Brussels" });
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * The new-article email results, re-read from Resend every 30 seconds while the tab is visible and
 * whenever it comes back into view. If a read fails the table says so and when its numbers are from,
 * so it never passes off old numbers as current.
 */
export function ArticleEmailsTable({ initial }: { initial: ArticleEmailSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [failedAt, setFailedAt] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/insights/article-emails", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setSnapshot((await res.json()) as ArticleEmailSnapshot);
      setFailedAt(null);
    } catch {
      setFailedAt(new Date().toISOString());
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const { rows, fetchedAt } = snapshot;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2 text-xs">
        {failedAt ? (
          <span className="text-red-700">
            Could not reach Resend at {timeFmt.format(new Date(failedAt))}. These numbers are from {timeFmt.format(new Date(fetchedAt))}.
          </span>
        ) : (
          <span className="text-zinc-500">
            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500 align-middle" aria-hidden />
            Live from Resend, checked at {timeFmt.format(new Date(fetchedAt))}. Updates every 30 seconds.
          </span>
        )}
        <button type="button" onClick={() => void refresh()} disabled={loading} className="font-medium text-accent hover:underline disabled:text-zinc-400 disabled:no-underline">
          {loading ? "Checking…" : "Check now"}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-sm text-zinc-500">No new-article emails have been sent yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Article</th>
                <th className="px-4 py-2.5 font-medium">Language</th>
                <th className="px-4 py-2.5 font-medium">Sent</th>
                <th className="px-4 py-2.5 text-right font-medium">Delivered</th>
                <th className="px-4 py-2.5 text-right font-medium">Opened</th>
                <th className="px-4 py-2.5 text-right font-medium">Clicked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((s) => (
                <tr key={s.broadcastId} className="hover:bg-zinc-50">
                  <td className="px-4 py-2.5">
                    {s.postId ? (
                      <Link href={`/blog/${s.postId}`} className="font-medium hover:text-accent">
                        {s.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{s.slug}</span>
                    )}
                    <div className="text-xs text-zinc-400">/blog/{s.slug}/</div>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600">{LANG_NAMES[s.lang]}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500">{s.sentAt ? dateFmt.format(new Date(s.sentAt)) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.delivered}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {s.opened} <span className="text-xs text-zinc-400">{pct(s.opened, s.delivered)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {s.clicked} <span className="text-xs text-zinc-400">{pct(s.clicked, s.delivered)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
