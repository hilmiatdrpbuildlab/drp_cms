"use client";

import { useEffect, useState } from "react";

import { getPublishProgress, type PublishProgress as Progress, type StepState } from "../actions";

const POLL_MS = 5000;
/** The rebuild usually takes 2–6 minutes; past this we stop polling and say so. */
const GIVE_UP_MS = 25 * 60 * 1000;

export type Tracking = { kind: "publish" | "unpublish"; startedAt: number; commitUrl?: string };

/**
 * Step-by-step status after Publish/Unpublish, polled until the website shows the result:
 *   1. sent to the website's repository (instant)
 *   2. the site is rebuilt and translated (GitHub Action)
 *   3. the new version is on the website (checked on the page itself)
 */
export function PublishProgress({ postId, tracking, onClose }: { postId: string; tracking: Tracking; onClose: () => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const finished = progress?.live === "done" || progress?.build === "failed";
  const gaveUp = !finished && now - tracking.startedAt > GIVE_UP_MS;
  const unknownEnd = progress?.live === "unknown" && (progress.build === "done" || progress.build === "unknown");

  useEffect(() => {
    if (finished || gaveUp || unknownEnd) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await getPublishProgress(postId);
        if (!alive) return;
        if (res.ok) {
          setProgress(res.progress);
          setError(null);
        } else setError(res.error);
      } catch {
        if (alive) setError("Lost contact with the CMS. Retrying…");
      }
    };
    void tick();
    const poll = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [postId, finished, gaveUp, unknownEnd]);

  useEffect(() => {
    if (finished || gaveUp) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [finished, gaveUp]);

  // Show the outcome in the browser tab too, for whoever switched to another tab meanwhile.
  useEffect(() => {
    if (progress?.live !== "done" && progress?.build !== "failed") return;
    const original = document.title;
    document.title = progress.live === "done" ? "✓ Live — " + original : "⚠ Failed — " + original;
    return () => {
      document.title = original;
    };
  }, [progress?.live, progress?.build]);

  const unpublish = tracking.kind === "unpublish";
  const elapsed = Math.max(0, Math.round((now - tracking.startedAt) / 1000));
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const build = progress?.build ?? "waiting";
  const live = progress?.live ?? "waiting";

  const tone =
    progress?.build === "failed" ? "border-red-200 bg-red-50" : live === "done" ? "border-emerald-200 bg-emerald-50" : "border-sky-200 bg-sky-50";

  return (
    <div role="status" aria-live="polite" className={`mt-3 rounded-xl border px-5 py-4 ${tone}`}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-base font-semibold">
          {live === "done"
            ? unpublish
              ? "The article is off the website."
              : "🎉 Your article is live on the website!"
            : build === "failed"
              ? "The website could not be rebuilt."
              : gaveUp
                ? "This is taking much longer than usual."
                : unknownEnd
                  ? "Built. The website updates within a minute or two."
                  : unpublish
                    ? "Taking the article off the website…"
                    : "Putting your article on the website…"}
        </p>
        <div className="flex items-center gap-3">
          {!finished && !gaveUp && !unknownEnd && <span className="font-mono text-sm text-zinc-500" title="Time since you pressed the button">{clock}</span>}
          <button className="text-sm text-zinc-500 hover:text-zinc-900" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>

      <ol className="mt-3 space-y-2 text-[15px]">
        <Step state="done" label={unpublish ? "Removal sent to the website" : "Article sent to the website"} href={tracking.commitUrl} linkText="details" />
        <Step
          // queued counts as under way: the editor should see something moving right after the click
          state={build === "waiting" ? "running" : build}
          label={build === "failed" ? "Rebuilding and translating failed" : "Rebuilding the website and translating the article"}
          hint={build === "running" || build === "waiting" ? "usually 2–5 minutes, longer with many languages" : undefined}
          href={progress?.buildUrl}
          linkText="see the build"
        />
        <Step
          state={live === "unknown" ? "unknown" : build === "failed" ? "waiting" : live}
          label={unpublish ? "Gone from the website" : "Visible on the website"}
          href={live === "done" && !unpublish ? progress?.liveUrl : undefined}
          linkText="open the article ↗"
        />
      </ol>

      {live === "done" && !unpublish && progress?.liveUrl && (
        <a className="btn-primary mt-4" href={progress.liveUrl} target="_blank" rel="noreferrer">
          Open the article on the website ↗
        </a>
      )}
      {build === "failed" && (
        <p className="mt-3 text-sm text-red-800">
          Nothing changed on the website. Ask a developer to open “see the build” and check the error, then press Publish again.
        </p>
      )}
      {gaveUp && <p className="mt-3 text-sm text-zinc-700">Check again later, or ask a developer to look at the build.</p>}
      {progress?.note && <p className="mt-3 text-xs text-zinc-500">{progress.note}</p>}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {!finished && !gaveUp && !unknownEnd && (
        <p className="mt-3 text-sm text-zinc-600">You can keep editing or close this page; publishing continues on its own.</p>
      )}
    </div>
  );
}

function Step({ state, label, hint, href, linkText }: { state: StepState; label: string; hint?: string; href?: string; linkText?: string }) {
  return (
    <li className="flex items-center gap-3">
      <StepIcon state={state} />
      <span className={state === "waiting" ? "text-zinc-500" : state === "failed" ? "text-red-800" : "text-zinc-900"}>
        {label}
        {hint && <span className="text-zinc-500"> · {hint}</span>}
        {href && (
          <>
            {" · "}
            <a className="underline" href={href} target="_blank" rel="noreferrer">{linkText}</a>
          </>
        )}
      </span>
    </li>
  );
}

function StepIcon({ state }: { state: StepState }) {
  const base = "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold";
  if (state === "done") return <span className={`${base} bg-emerald-600 text-white`} aria-label="done">✓</span>;
  if (state === "failed") return <span className={`${base} bg-red-600 text-white`} aria-label="failed">!</span>;
  if (state === "unknown") return <span className={`${base} bg-zinc-200 text-zinc-600`} aria-label="unknown">?</span>;
  if (state === "running")
    return (
      <svg className="size-6 shrink-0 animate-spin text-sky-600" viewBox="0 0 24 24" fill="none" aria-label="in progress">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  return <span className={`${base} border-2 border-dashed border-zinc-300`} aria-label="waiting" />;
}
