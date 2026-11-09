"use client";

import { useState, useTransition } from "react";

import type { SetupItem } from "@/lib/insights/offers-server";

import { resyncConsents, sendConsentRequests } from "./offers/actions";

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-zinc-400" aria-label="unknown">–</span>;
  return ok ? (
    <span className="text-emerald-700" aria-label="done">✓</span>
  ) : (
    <span className="text-amber-700" aria-label="to do">○</span>
  );
}

/** Phase 2 status: what's still needed, who consented, and the two consent actions. */
export function OffersPanel({
  items,
  consenting,
  notAsked,
  canAsk,
}: {
  items: SetupItem[];
  consenting: number;
  notAsked: number;
  canAsk: boolean;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"sync" | "ask" | null>(null);
  const [, start] = useTransition();

  const sync = () => {
    setBusy("sync");
    setMsg(null);
    start(async () => {
      const r = await resyncConsents();
      setBusy(null);
      setMsg(r.ok ? { ok: true, text: `Checked ${r.checked} subscribers in Resend: ${r.optedIn} with offers consent.` } : { ok: false, text: r.error });
    });
  };
  const ask = () => {
    const q =
      `Email ${notAsked} current subscriber(s) once, asking whether they also want offers?\n\n` +
      "Each gets a link to the consent page on drpbuildlab.com. Nothing changes for anyone who ignores it, and nobody is asked twice.";
    if (!window.confirm(q)) return;
    setBusy("ask");
    setMsg(null);
    start(async () => {
      const r = await sendConsentRequests();
      setBusy(null);
      setMsg(r.ok ? { ok: r.failed === 0, text: `Sent ${r.sent} request(s)${r.failed ? `, ${r.failed} failed (see the logs)` : ""}.` } : { ok: false, text: r.error });
    });
  };

  return (
    <div className="grid gap-6 p-4 lg:grid-cols-[1fr_18rem]">
      <ul className="space-y-2 text-sm">
        {items.map((i) => (
          <li key={i.label} className="grid grid-cols-[1.25rem_1fr] gap-x-2">
            <Mark ok={i.ok} />
            <span>
              <span className="font-medium">{i.label}</span>
              <span className="block text-xs text-zinc-500">{i.hint}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="space-y-3">
        <div className="rounded-lg bg-zinc-50 p-3">
          <p className="text-xs font-medium text-zinc-500">With offers consent</p>
          <p className="text-2xl font-semibold tabular-nums">{consenting}</p>
        </div>
        <button className="btn-secondary w-full" onClick={sync} disabled={busy !== null}>
          {busy === "sync" ? "Checking…" : "Re-check consent in Resend"}
        </button>
        <button
          className="btn-primary w-full"
          onClick={ask}
          disabled={busy !== null || !canAsk || notAsked === 0}
          title={!canAsk ? "Needs lawyer approval (MARKETING_CONSENT_VERSION), NEWSLETTER_SECRET and MAIL_FROM" : undefined}
        >
          {busy === "ask" ? "Sending…" : `Ask ${notAsked} subscriber${notAsked === 1 ? "" : "s"} for consent`}
        </button>
        {msg && (
          <p role="status" className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
