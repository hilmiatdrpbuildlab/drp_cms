"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { refreshWebsiteAnalytics } from "./actions";

/** A server time in the viewer's own time zone (rendered after hydration, so server and browser agree). */
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    setText(
      new Intl.DateTimeFormat("en-GB", sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" }).format(d),
    );
  }, [iso]);
  return <time dateTime={iso}>{text ?? "…"}</time>;
}

/** Ask Google Analytics now, skipping the hour-long cache. */
export function RefreshButton({ days }: { days: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await refreshWebsiteAnalytics(String(days));
            if (!r.ok) setError(r.error);
            router.refresh();
          })
        }
      >
        {pending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
