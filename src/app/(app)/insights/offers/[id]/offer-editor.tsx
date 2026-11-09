"use client";

import { useMemo, useState, useTransition } from "react";

import { LANG_NAMES, LANGS, type Lang } from "@/lib/blog/contract";
import { audienceByLang, FALLBACK_STRINGS, offerEmail, type OfferMailStrings, type OfferVersion } from "@/lib/insights/offers";
import type { OfferResult } from "@/lib/schema";

import { deleteOffer, saveOffer, sendOffer, sendOfferTest } from "../actions";

type Status = "draft" | "sending" | "sent";
type Versions = Partial<Record<Lang, OfferVersion>>;

const EMPTY: OfferVersion = { subject: "", heading: "", body: "", buttonLabel: "", buttonUrl: "https://" };
const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });

export function OfferEditor({
  offer,
  tags,
  tagHints,
  audience,
  footers,
  canSend,
}: {
  offer: { id: string; name: string; partner: string; audienceTags: string[]; versions: Versions; status: Status; results: OfferResult[] };
  tags: string[];
  /** Reader activity per tag, e.g. "3 likes · 1 comment". */
  tagHints: Record<string, string>;
  audience: { lang: Lang; tags: string[] }[];
  footers: Partial<Record<Lang, OfferMailStrings & { live: boolean }>>;
  canSend: boolean;
}) {
  const [name, setName] = useState(offer.name);
  const [partner, setPartner] = useState(offer.partner);
  const [audienceTags, setAudienceTags] = useState(offer.audienceTags);
  const [versions, setVersions] = useState<Versions>(offer.versions);
  const langs = (Object.keys(versions) as Lang[]).sort((a, b) => LANGS.indexOf(a) - LANGS.indexOf(b));
  const [active, setActive] = useState<Lang | null>(langs[0] ?? null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);
  const [, start] = useTransition();

  const locked = offer.status !== "draft";
  const sentLangs = new Set(offer.results.map((r) => r.lang));
  const counts = useMemo(
    () => audienceByLang(audience.map((a, i) => ({ email: String(i), ...a })), audienceTags),
    [audience, audienceTags],
  );
  const count = (l: Lang) => counts.get(l)?.length ?? 0;
  const toSend = langs.filter((l) => !sentLangs.has(l) && count(l) > 0);
  const total = toSend.reduce((n, l) => n + count(l), 0);
  const skipped = [...counts.keys()].filter((l) => !versions[l]);

  const edit = (fn: () => void) => {
    fn();
    setDirty(true);
    setMsg(null);
  };
  const setField = (k: keyof OfferVersion, v: string) =>
    edit(() => setVersions((vs) => ({ ...vs, [active!]: { ...(vs[active!] ?? EMPTY), [k]: v } })));

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string; errors?: string[] } & Record<string, unknown>>, ok: (r: never) => string) => {
    setBusy(label);
    setMsg(null);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (r.ok) setMsg({ ok: true, text: ok(r as never) });
      else setMsg({ ok: false, text: r.error ?? "Failed.", list: r.errors });
    });
  };

  const save = () =>
    run(
      "save",
      async () => {
        const r = await saveOffer({ id: offer.id, name, partner, audienceTags, versions });
        if (r.ok) setDirty(false);
        return r;
      },
      () => "Saved.",
    );

  const preview = useMemo(() => {
    if (!active || !versions[active]) return "";
    const s = footers[active] ?? { ...FALLBACK_STRINGS, live: false };
    return offerEmail({ s, lang: active, v: versions[active]!, partner }).html.split("{{{RESEND_UNSUBSCRIBE_URL}}}").join("#");
  }, [active, versions, partner, footers]);

  const v = active ? versions[active] : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{name || "Untitled offer"}</h1>
        {!locked && (
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-danger"
              disabled={busy !== null}
              onClick={() => window.confirm("Delete this draft?") && run("delete", () => deleteOffer(offer.id), () => "Deleted.")}
            >
              Delete draft
            </button>
            <button className="btn-primary" disabled={busy !== null || !dirty} onClick={save}>
              {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div role="status" className={`rounded-lg border px-4 py-2.5 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {msg.text}
          {msg.list && (
            <ul className="mt-1 list-disc pl-5">
              {msg.list.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {offer.results.length > 0 && (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">{offer.status === "sent" ? "Sent" : "Partly sent"}</h2>
          <ul className="mt-2 space-y-1 text-zinc-600">
            {offer.results.map((r) => (
              <li key={r.lang}>
                {LANG_NAMES[r.lang]}: {r.recipients} recipient{r.recipients === 1 ? "" : "s"}, {fmt.format(new Date(r.sentAt))}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">Delivery, opens and clicks are in Resend under Broadcasts (named offer:…).</p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="o-name">Internal name</label>
              <input id="o-name" className="field" disabled={locked} value={name} onChange={(e) => edit(() => setName(e.target.value))} />
            </div>
            <div>
              <label className="label" htmlFor="o-partner">Partner (named in the email)</label>
              <input
                id="o-partner"
                className="field"
                disabled={locked}
                placeholder="e.g. Tinrate; empty for our own offer"
                value={partner}
                onChange={(e) => edit(() => setPartner(e.target.value))}
              />
            </div>
          </div>

          <fieldset>
            <legend className="label">Audience: subscribers with offers consent who clicked articles tagged…</legend>
            {tags.length === 0 ? (
              <p className="text-xs text-zinc-500">No article tags yet. The offer goes to everyone with consent.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const on = audienceTags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={locked}
                      aria-pressed={on}
                      onClick={() => edit(() => setAudienceTags((ts) => (on ? ts.filter((x) => x !== t) : [...ts, t])))}
                      className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"}`}
                    >
                      {t}
                      {tagHints[t] && <span className={on ? "ml-1 text-white/80" : "ml-1 text-zinc-400"}>· {tagHints[t]}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-1.5 text-xs text-zinc-500">
              {audienceTags.length ? "Anyone with at least one of these." : "None picked: everyone with offers consent."} The numbers are all
              readers&apos; likes, comments and email clicks on articles with that tag (see Reader activity).
            </p>
          </fieldset>

          <div>
            <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200">
              {langs.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setActive(l)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${l === active ? "border-accent font-medium" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}
                >
                  {l.toUpperCase()} <span className="text-xs text-zinc-400 tabular-nums">{count(l)}</span>
                </button>
              ))}
              {!locked && (
                <select
                  aria-label="Add a language"
                  className="ml-auto rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs"
                  value=""
                  onChange={(e) => {
                    const l = e.target.value as Lang;
                    edit(() => setVersions((vs) => ({ ...vs, [l]: { ...EMPTY } })));
                    setActive(l);
                  }}
                >
                  <option value="">+ Add language</option>
                  {LANGS.filter((l) => !versions[l]).map((l) => (
                    <option key={l} value={l}>
                      {LANG_NAMES[l]} ({count(l)} with consent)
                    </option>
                  ))}
                </select>
              )}
            </div>

            {!active || !v ? (
              <p className="py-6 text-center text-sm text-zinc-500">Add a language to write the email.</p>
            ) : (
              <div className="space-y-3 pt-3">
                <div>
                  <label className="label" htmlFor="o-subject">Subject</label>
                  <input id="o-subject" className="field" disabled={locked} value={v.subject} onChange={(e) => setField("subject", e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="o-heading">Heading</label>
                  <input id="o-heading" className="field" disabled={locked} value={v.heading} onChange={(e) => setField("heading", e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="o-body">Text (a blank line starts a new paragraph)</label>
                  <textarea id="o-body" rows={8} className="field" disabled={locked} value={v.body} onChange={(e) => setField("body", e.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                  <div>
                    <label className="label" htmlFor="o-btn">Button text</label>
                    <input id="o-btn" className="field" disabled={locked} value={v.buttonLabel} onChange={(e) => setField("buttonLabel", e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="o-url">Button link</label>
                    <input id="o-url" type="url" className="field" disabled={locked} value={v.buttonUrl} onChange={(e) => setField("buttonUrl", e.target.value)} />
                  </div>
                </div>
                {!locked && (
                  <div className="flex flex-wrap justify-between gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() =>
                        window.confirm(`Remove the ${LANG_NAMES[active]} version?`) &&
                        edit(() => {
                          setVersions((vs) => {
                            const next = { ...vs };
                            delete next[active];
                            return next;
                          });
                          setActive(langs.find((l) => l !== active) ?? null);
                        })
                      }
                    >
                      Remove {active.toUpperCase()}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy !== null || dirty}
                      title={dirty ? "Save first" : undefined}
                      onClick={() => run("test", () => sendOfferTest(offer.id, active), (r: { to: string }) => `Test sent to ${r.to}.`)}
                    >
                      {busy === "test" ? "Sending…" : "Send test to me"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-col rounded-xl border border-zinc-200 bg-white">
          <header className="border-b border-zinc-200 px-4 py-2.5 text-xs text-zinc-500">
            Preview{active ? ` (${LANG_NAMES[active]})` : ""}
            {active && !footers[active]?.live && " · footer in English until the site's offers page is live"}
          </header>
          {preview ? (
            <iframe title="Email preview" className="min-h-[36rem] w-full flex-1 rounded-b-xl" sandbox="" srcDoc={preview} />
          ) : (
            <p className="p-6 text-sm text-zinc-500">The preview appears once a language is added.</p>
          )}
        </section>
      </div>

      {!locked || offer.status === "sending" ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-sm">
            <p>
              Sends to <strong className="tabular-nums">{total}</strong> subscriber{total === 1 ? "" : "s"} with offers consent
              {toSend.length ? ` (${toSend.map((l) => `${l.toUpperCase()} ${count(l)}`).join(", ")})` : ""}.
            </p>
            {skipped.length > 0 && (
              <p className="text-xs text-zinc-500">
                Not written, so skipped: {skipped.map((l) => `${LANG_NAMES[l]} (${count(l)})`).join(", ")}.
              </p>
            )}
            {!canSend && <p className="text-xs text-amber-700">Locked: see the Offers consent checklist on the Subscribers tab (lawyer approval first).</p>}
          </div>
          <button
            className="btn-primary"
            disabled={busy !== null || dirty || !canSend || total === 0}
            title={dirty ? "Save first" : undefined}
            onClick={() =>
              window.confirm(`Send "${name}" to ${total} subscriber(s) now? This can't be undone.`) &&
              run("send", () => sendOffer(offer.id), (r: { sent: OfferResult[] }) => `Sent: ${r.sent.map((x) => `${x.lang.toUpperCase()} ${x.recipients}`).join(", ")}.`)
            }
          >
            {busy === "send" ? "Sending…" : offer.status === "sending" ? "Send remaining languages" : `Send to ${total}`}
          </button>
        </section>
      ) : null}
    </div>
  );
}
