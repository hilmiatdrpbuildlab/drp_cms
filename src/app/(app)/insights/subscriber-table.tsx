"use client";

import { useMemo, useState, useTransition } from "react";

import { LANG_NAMES, type Lang } from "@/lib/blog/contract";
import type { OfferConsentInfo, Subscriber } from "@/lib/insights/newsletter";

import { deleteSubscriber, unsubscribeSubscriber } from "./actions";

const PAGE = 100;
const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Brussels" });

const consentTitle = (o: OfferConsentInfo) =>
  `Consent version ${o.version ?? "unknown"}${o.consentedAt ? `, given ${fmt.format(new Date(o.consentedAt))}` : ""}`;

type Status = "all" | "subscribed" | "unsubscribed" | "offers";

export function SubscriberTable({ subscribers, offers }: { subscribers: Subscriber[]; offers: Record<string, OfferConsentInfo> }) {
  const hasOffers = (s: Subscriber) => !s.unsubscribed && !!offers[s.email]?.optedIn;
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<Lang | "">("");
  const [status, setStatus] = useState<Status>("all");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const langs = useMemo(() => [...new Set(subscribers.flatMap((s) => s.langs))].sort(), [subscribers]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return subscribers.filter(
      (s) =>
        (!q || s.email.includes(q)) &&
        (!lang || s.langs.includes(lang)) &&
        (status === "all" || (status === "offers" ? hasOffers(s) : (status === "unsubscribed") === s.unsubscribed)),
    );
  }, [subscribers, offers, query, lang, status]);

  function run(s: Subscriber, kind: "unsubscribe" | "delete") {
    const ask =
      kind === "unsubscribe"
        ? `Unsubscribe ${s.email}?\n\nThey get no more blog emails. Their address stays in Resend, marked unsubscribed, and they can subscribe again on the site.`
        : `Permanently delete ${s.email}?\n\nThis erases the address from Resend. Use it for a GDPR erasure request. If they only want no more emails, use Unsubscribe instead.`;
    if (!window.confirm(ask)) return;
    setBusy(s.id);
    setMessage(null);
    startTransition(async () => {
      const res = kind === "unsubscribe" ? await unsubscribeSubscriber(s.email) : await deleteSubscriber(s.email);
      setBusy(null);
      setMessage(
        res.ok
          ? { ok: true, text: kind === "unsubscribe" ? `${s.email} is unsubscribed.` : `${s.email} is deleted from Resend.` }
          : { ok: false, text: res.error },
      );
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 border-b border-zinc-200 p-4">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="sub-q">
            Search
          </label>
          <input
            id="sub-q"
            type="search"
            className="field"
            placeholder="Email address"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="sub-lang">
            Language
          </label>
          <select id="sub-lang" className="field" value={lang} onChange={(e) => setLang(e.target.value as Lang | "")}>
            <option value="">All languages</option>
            {langs.map((l) => (
              <option key={l} value={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sub-status">
            Status
          </label>
          <select id="sub-status" className="field" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="all">All</option>
            <option value="subscribed">Subscribed</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="offers">With offers consent</option>
          </select>
        </div>
        <p className="ml-auto pb-2 text-xs text-zinc-500 tabular-nums">
          {rows.length} of {subscribers.length}
        </p>
      </div>

      {message && (
        <p
          role="status"
          className={`border-b px-4 py-2.5 text-sm ${message.ok ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-red-100 bg-red-50 text-red-700"}`}
        >
          {message.text}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-zinc-500">
          {subscribers.length === 0 ? "Nobody has subscribed yet." : "No subscribers match these filters."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Language</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Offers</th>
                <th className="px-4 py-2.5 font-medium">Interests</th>
                <th className="px-4 py-2.5 font-medium">First subscribed</th>
                <th className="px-4 py-2.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.slice(0, shown).map((s) => (
                <tr key={s.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-2.5 font-medium break-all">{s.email}</td>
                  <td className="px-4 py-2.5 text-zinc-600">{s.langs.map((l) => LANG_NAMES[l]).join(", ")}</td>
                  <td className="px-4 py-2.5">
                    {s.unsubscribed ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">Unsubscribed</span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Subscribed</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {hasOffers(s) ? (
                      <span
                        className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-accent"
                        title={consentTitle(offers[s.email])}
                      >
                        Offers
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-600">
                    {hasOffers(s) && offers[s.email].interests.length ? (
                      offers[s.email].interests.slice(0, 4).join(", ")
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500">{s.createdAt ? fmt.format(new Date(s.createdAt)) : "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      {!s.unsubscribed && (
                        <button className="btn-secondary py-1 text-xs" disabled={busy !== null} onClick={() => run(s, "unsubscribe")}>
                          Unsubscribe
                        </button>
                      )}
                      <button className="btn-danger py-1 text-xs" disabled={busy !== null} onClick={() => run(s, "delete")}>
                        {busy === s.id ? "Working…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown && (
            <div className="border-t border-zinc-200 p-3 text-center">
              <button className="btn-secondary" onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(PAGE, rows.length - shown)} more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
