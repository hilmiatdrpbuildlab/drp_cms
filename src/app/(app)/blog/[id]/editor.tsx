"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";

import {
  CATEGORIES,
  CATEGORY_LABELS,
  DEFAULT_LANGS,
  LANG_NAMES,
  LANGS,
  SLUG_RE,
  slugify,
  VIDEO_ASPECTS,
  type ArticleVideo,
  type Category,
  type Lang,
} from "@/lib/blog/contract";
import { mediaUrl, PLACEHOLDER_SLUG_PREFIX } from "@/lib/blog/publish-plan";
import { articleUrl } from "@/lib/site";

import { deletePost, publishPost, savePost, unpublishPost, type SaveInput } from "../actions";
import { StatusBadge } from "../status-badge";
import { Preview } from "./preview";
import { PublishProgress, type Tracking } from "./publish-progress";

// TipTap touches the DOM on load; keep it out of the server render.
const RichEditor = dynamic(() => import("./rich-editor").then((m) => m.RichEditor), {
  ssr: false,
  loading: () => <div className="min-h-[60vh] px-6 py-5 text-zinc-400">Loading the editor…</div>,
});

export type EditorPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  category: Category;
  tags: string[];
  langs: Lang[];
  authorName: string;
  date: string | null;
  coverKey: string | null;
  coverAlt: string;
  video: ArticleVideo | null;
  updatedAt: string;
  publishedSlug: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  publishedCommit: string | null;
};

type Fields = Omit<EditorPost, "id" | "updatedAt" | "publishedSlug" | "publishedAt" | "publishedBy" | "publishedCommit">;
type Message = { tone: "error" | "ok"; text: string; list?: string[]; href?: string };
type SaveState = { state: "saved" | "saving" | "unsaved" | "error"; error?: string };

const AUTOSAVE_MS = 2500;
/** On opening an article published this recently, keep showing its progress. */
const RESUME_TRACKING_MS = 30 * 60 * 1000;

const fieldsOf = (p: EditorPost): Fields => ({
  title: p.title,
  slug: p.slug,
  excerpt: p.excerpt,
  body: p.body,
  category: p.category,
  tags: p.tags,
  langs: p.langs,
  authorName: p.authorName,
  date: p.date,
  coverKey: p.coverKey,
  coverAlt: p.coverAlt,
  video: p.video,
});

async function uploadImage(postId: string, file: File): Promise<{ key: string; url: string }> {
  const body = new FormData();
  body.set("file", file);
  body.set("postId", postId);
  const res = await fetch("/api/media", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { key?: string; url?: string; error?: string };
  if (!res.ok || !json.key || !json.url) throw new Error(json.error || `Upload failed (${res.status})`);
  return { key: json.key, url: json.url };
}

const altFromName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");

export function Editor({
  initial,
  repo,
  branch,
  canPublish,
  siteUrl,
}: {
  initial: EditorPost;
  repo: string;
  branch: string;
  canPublish: boolean;
  siteUrl: string | null;
}) {
  const [fields, setFields] = useState<Fields>(() => fieldsOf(initial));
  const [saved, setSaved] = useState<Fields>(() => fieldsOf(initial));
  const [meta, setMeta] = useState(() => ({
    updatedAt: initial.updatedAt,
    publishedSlug: initial.publishedSlug,
    publishedAt: initial.publishedAt,
    publishedCommit: initial.publishedCommit,
  }));
  // A new article's web address follows its title until someone edits the address by hand.
  const [slugAuto, setSlugAuto] = useState(
    () => !initial.publishedSlug && (initial.slug.startsWith(PLACEHOLDER_SLUG_PREFIX) || initial.slug === slugify(initial.title)),
  );
  const [writeMode, setWriteMode] = useState<"visual" | "markdown">("visual");
  const [showPreview, setShowPreview] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ state: "saved" });
  const [autosaveBlocked, setAutosaveBlocked] = useState(false);
  const [tracking, setTracking] = useState<Tracking | null>(() =>
    initial.publishedSlug && initial.publishedAt && Date.now() - Date.parse(initial.publishedAt) < RESUME_TRACKING_MS
      ? { kind: "publish", startedAt: Date.parse(initial.publishedAt) }
      : null,
  );
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  // Saves run one after another and always send the latest fields, so autosave and the buttons
  // never race each other into a false "someone else saved" conflict.
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));

  const dirty = useMemo(() => JSON.stringify(fields) !== JSON.stringify(saved), [fields, saved]);
  const published = !!meta.publishedSlug;
  const liveIsStale = published && !!meta.publishedAt && (dirty || meta.updatedAt > meta.publishedAt);
  const set = useCallback(<K extends keyof Fields>(key: K, value: Fields[K]) => setFields((f) => ({ ...f, [key]: value })), []);

  // Remember the preferred editor on this computer.
  useEffect(() => {
    try {
      if (localStorage.getItem("cms-write-mode") === "markdown") setWriteMode("markdown");
    } catch {}
  }, []);
  const chooseMode = (m: "visual" | "markdown") => {
    setWriteMode(m);
    try {
      localStorage.setItem("cms-write-mode", m);
    } catch {}
  };

  // Lets the editor toolbar stick just under the action bar.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--bar-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- save -------------------------------------------------------------------------------------
  const save = useCallback(
    (how: "auto" | "manual"): Promise<boolean> =>
      (queue.current = queue.current.then(async () => {
        const snapshot = fieldsRef.current;
        setSaveState({ state: "saving" });
        const input: SaveInput = {
          id: initial.id,
          expectedUpdatedAt: metaRef.current.updatedAt,
          ...snapshot,
          video: snapshot.video?.url ? snapshot.video : null,
        };
        try {
          const res = await savePost(input);
          if (!res.ok) {
            const conflict = res.error.startsWith("Someone else saved");
            if (conflict) setAutosaveBlocked(true);
            setSaveState({ state: "error", error: res.errors?.[0] ?? res.error });
            if (how === "manual" || conflict) setMessage({ tone: "error", text: res.error, list: res.errors });
            return false;
          }
          setSaved(snapshot);
          setMeta((m) => ({ ...m, updatedAt: res.updatedAt }));
          metaRef.current = { ...metaRef.current, updatedAt: res.updatedAt };
          setSaveState({ state: "saved" });
          return true;
        } catch {
          setSaveState({ state: "error", error: "No connection. Your text is still here; it will save when the connection is back." });
          return false;
        }
      })),
    [initial.id],
  );

  useEffect(() => {
    if (!dirty) return;
    setSaveState((s) => (s.state === "saving" ? s : { state: s.state === "error" ? "error" : "unsaved", error: s.error }));
    if (autosaveBlocked || pending) return;
    const t = setTimeout(() => void save("auto"), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [fields, dirty, autosaveBlocked, pending, save]);

  const onSave = () =>
    startTransition(async () => {
      if (await save("manual")) setMessage({ tone: "ok", text: "Draft saved. It isn't on the website until you press Publish." });
    });

  // ---- publish ----------------------------------------------------------------------------------
  const onPublish = () =>
    startTransition(async () => {
      setMessage(null);
      if (dirty && !(await save("manual"))) return;
      await queue.current;
      const startedAt = Date.now();
      const res = await publishPost(initial.id);
      if (!res.ok) return setMessage({ tone: "error", text: res.error, list: res.errors });
      const next = { ...fieldsRef.current, date: res.date };
      setFields(next);
      setSaved(next);
      setSlugAuto(false);
      setMeta({ updatedAt: res.updatedAt, publishedSlug: next.slug, publishedAt: res.updatedAt, publishedCommit: res.commitSha });
      setTracking({ kind: "publish", startedAt, commitUrl: res.commitUrl });
    });

  const onUnpublish = () => {
    if (!confirm("Take this article off the website?\n\nIt stays here as a draft, and you can publish it again later.")) return;
    startTransition(async () => {
      setMessage(null);
      const startedAt = Date.now();
      const res = await unpublishPost(initial.id);
      if (!res.ok) return setMessage({ tone: "error", text: res.error });
      setMeta((m) => ({ ...m, updatedAt: res.updatedAt, publishedSlug: null, publishedCommit: res.commitSha }));
      setTracking({ kind: "unpublish", startedAt, commitUrl: res.commitUrl });
    });
  };

  const onDelete = () => {
    if (!confirm("Delete this draft and its pictures for good? This can't be undone.")) return;
    startTransition(async () => {
      const res = await deletePost(initial.id); // redirects on success
      if (res && !res.ok) setMessage({ tone: "error", text: res.error });
    });
  };

  // Ctrl/Cmd+S saves; warn before leaving with unsaved edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!pending) onSave();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  });

  // ---- title / slug -----------------------------------------------------------------------------
  const onTitle = (title: string) =>
    setFields((f) => ({ ...f, title, ...(slugAuto && slugify(title).length >= 3 ? { slug: slugify(title) } : {}) }));

  // ---- checklist --------------------------------------------------------------------------------
  const video = fields.video;
  const checks = [
    { ok: fields.title.trim().length >= 3, label: "A title" },
    {
      ok: SLUG_RE.test(fields.slug) && fields.slug.length >= 3 && !fields.slug.startsWith(PLACEHOLDER_SLUG_PREFIX),
      label: "A web address",
    },
    { ok: fields.excerpt.trim().length >= 20, label: "A short summary (20 characters or more)" },
    { ok: fields.body.trim().length >= 50, label: "The article text" },
    ...(fields.coverKey ? [{ ok: fields.coverAlt.trim().length > 0, label: "A description of the cover picture" }] : []),
    ...(video?.url ? [{ ok: /^https:\/\/\S+\.\S+/.test(video.url.trim()), label: "A video link starting with https://" }] : []),
  ];
  const ready = checks.every((c) => c.ok);

  // ---- markdown helpers (Markdown mode) ---------------------------------------------------------
  const insert = (before: string, after = "", placeholder = "") => {
    const el = textarea.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const selected = value.slice(s, e) || placeholder;
    const next = value.slice(0, s) + before + selected + after + value.slice(e);
    set("body", next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + selected.length);
    });
  };
  const linePrefix = (prefix: string) => {
    const el = textarea.current;
    if (!el) return;
    const start = el.value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    el.setSelectionRange(start, start);
    insert(prefix);
  };

  // ---- uploads ----------------------------------------------------------------------------------
  const uploadFiles = useCallback(
    async (files: File[]) => {
      const list = files.filter((f) => f.type.startsWith("image/"));
      if (!list.length) return [];
      setUploading(true);
      setMessage(null);
      const done: { key: string; url: string; alt: string }[] = [];
      try {
        for (const file of list) done.push({ ...(await uploadImage(initial.id, file)), alt: altFromName(file.name) });
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "Upload failed." });
      } finally {
        setUploading(false);
      }
      return done;
    },
    [initial.id],
  );

  const uploadInto = async (files: FileList | File[], target: "body" | "cover" | "poster") => {
    for (const { key, url, alt } of await uploadFiles([...files])) {
      if (target === "cover") setFields((f) => ({ ...f, coverKey: key, coverAlt: f.coverAlt || alt }));
      else if (target === "poster") setFields((f) => ({ ...f, video: { ...(f.video ?? { url: "", aspect: "16:9" }), poster: url } }));
      else insert(`\n![${alt}](${url})\n`);
    }
  };

  const setVideo = (patch: Partial<ArticleVideo>) => set("video", { ...(video ?? { url: "", aspect: "16:9" as const }), ...patch });

  const publishLabel = pending ? "Working…" : published ? "Publish changes" : "Publish";
  const publishDisabledReason = !canPublish
    ? "Publishing is not set up (GITHUB_TOKEN)"
    : !ready
      ? "Complete the checklist first"
      : published && !liveIsStale
        ? "The website already shows this version"
        : undefined;

  // ---- render -----------------------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16">
      {/* Action bar, with the latest result under it so it stays visible while scrolled */}
      <div ref={bar} className="sticky top-0 z-10 -mx-4 mb-4 border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/blog" className="text-[15px] text-zinc-600 hover:text-zinc-900">← All articles</Link>
          <StatusBadge published={published} dirty={liveIsStale} />
          <SaveIndicator state={saveState} dirty={dirty} />
          <div className="ml-auto flex flex-wrap gap-2">
            {!published && (
              <button className="btn-danger" onClick={onDelete} disabled={pending}>Delete draft</button>
            )}
            {published && (
              <button className="btn-secondary" onClick={onUnpublish} disabled={pending || !canPublish}>Take off website</button>
            )}
            {published && siteUrl && meta.publishedSlug && (
              <a className="btn-secondary" href={articleUrl(siteUrl, meta.publishedSlug)} target="_blank" rel="noreferrer">View on website ↗</a>
            )}
            <button className="btn-secondary" onClick={onSave} disabled={pending || !dirty} title="Ctrl+S">
              Save now
            </button>
            <button
              className="btn-primary px-5"
              onClick={onPublish}
              disabled={pending || !!publishDisabledReason}
              title={publishDisabledReason ?? `Sends content/blog/${fields.slug}.md to ${repo}@${branch}`}
            >
              {publishLabel}
            </button>
          </div>
        </div>

        {tracking && <PublishProgress key={tracking.startedAt} postId={initial.id} tracking={tracking} onClose={() => setTracking(null)} />}

        {message && (
          <div
            role={message.tone === "error" ? "alert" : "status"}
            className={`mt-3 max-h-48 overflow-auto rounded-lg px-4 py-3 text-[15px] ${message.tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"}`}
          >
            <div className="flex items-start justify-between gap-4">
              <p>
                {message.text}{" "}
                {message.href && (
                  <a href={message.href} target="_blank" rel="noreferrer" className="font-medium underline">Details</a>
                )}
              </p>
              <button className="text-sm opacity-60 hover:opacity-100" onClick={() => setMessage(null)} aria-label="Dismiss">✕</button>
            </div>
            {message.list && message.list.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm">{message.list.map((m) => <li key={m}>{m}</li>)}</ul>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Writing area */}
        <section className="min-w-0">
          <input
            className="mb-3 w-full bg-transparent text-3xl font-semibold outline-none placeholder:text-zinc-300"
            placeholder="Write the title here…"
            value={fields.title}
            onChange={(e) => onTitle(e.target.value)}
            aria-label="Title"
            autoFocus={!initial.title}
          />

          <div className="mb-2 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1 text-sm" role="tablist">
              <button role="tab" aria-selected={!showPreview} onClick={() => setShowPreview(false)} className={`rounded-md px-3 py-1.5 ${!showPreview ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
                ✏️ Write
              </button>
              <button role="tab" aria-selected={showPreview} onClick={() => setShowPreview(true)} className={`rounded-md px-3 py-1.5 ${showPreview ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
                👁 Preview
              </button>
            </div>
            {!showPreview && (
              <label className="ml-auto flex items-center gap-2 text-sm text-zinc-500" title="Markdown is plain text with symbols like ## and **. For people who prefer it.">
                Editor:
                <select className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm" value={writeMode} onChange={(e) => chooseMode(e.target.value as "visual" | "markdown")}>
                  <option value="visual">Visual (like Word)</option>
                  <option value="markdown">Markdown (advanced)</option>
                </select>
              </label>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white">
            {showPreview ? (
              <div className="min-h-[60vh] p-6">
                <Preview title={fields.title} body={fields.body} coverUrl={fields.coverKey ? mediaUrl(fields.coverKey) : null} coverAlt={fields.coverAlt} video={video?.url ? video : null} />
              </div>
            ) : writeMode === "visual" ? (
              <RichEditor value={fields.body} onChange={(md) => set("body", md)} upload={uploadFiles} uploading={uploading} />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-2 py-1.5">
                  <Tool onClick={() => linePrefix("## ")} label="Heading">H2</Tool>
                  <Tool onClick={() => linePrefix("### ")} label="Subheading">H3</Tool>
                  <Tool onClick={() => insert("**", "**", "bold")} label="Bold"><b>B</b></Tool>
                  <Tool onClick={() => insert("_", "_", "italic")} label="Italic"><i>I</i></Tool>
                  <Tool onClick={() => insert("[", "](https://)", "link text")} label="Link">Link</Tool>
                  <Tool onClick={() => linePrefix("- ")} label="List">• List</Tool>
                  <Tool onClick={() => linePrefix("> ")} label="Quote">Quote</Tool>
                  <Tool onClick={() => insert("`", "`", "code")} label="Inline code">{"<>"}</Tool>
                  <Tool onClick={() => insert("\n```ts\n", "\n```\n", "// code")} label="Code block">Code</Tool>
                  <label className="cursor-pointer rounded px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100">
                    {uploading ? "Uploading…" : "Image"}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" multiple hidden onChange={(e) => e.target.files && uploadInto(e.target.files, "body")} />
                  </label>
                </div>
                <textarea
                  ref={textarea}
                  className="min-h-[60vh] w-full resize-y border-0 p-4 font-mono text-sm leading-relaxed outline-none"
                  placeholder={"Write in Markdown.\n\n## A heading\n\nParagraphs, **bold**, [links](https://…), lists, code blocks.\nPaste or drop images to upload them."}
                  value={fields.body}
                  onChange={(e) => set("body", e.target.value)}
                  onPaste={(e) => {
                    if (e.clipboardData.files.length) {
                      e.preventDefault();
                      void uploadInto(e.clipboardData.files, "body");
                    }
                  }}
                  onDrop={(e) => {
                    if (e.dataTransfer.files.length) {
                      e.preventDefault();
                      void uploadInto(e.dataTransfer.files, "body");
                    }
                  }}
                  spellCheck
                />
              </>
            )}
          </div>
        </section>

        {/* Settings */}
        <aside className="space-y-4">
          <Panel title={published ? "Before publishing changes" : "Before you publish"}>
            <ul className="space-y-1.5 text-[15px]">
              {checks.map((c) => (
                <li key={c.label} className="flex items-center gap-2">
                  <span className={`inline-flex size-5 items-center justify-center rounded-full text-xs font-bold ${c.ok ? "bg-emerald-600 text-white" : "border-2 border-zinc-300"}`} aria-hidden="true">
                    {c.ok ? "✓" : ""}
                  </span>
                  <span className={c.ok ? "text-zinc-500 line-through decoration-zinc-300" : "text-zinc-900"}>{c.label}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-zinc-500">
              {ready ? "All set. Press Publish when you're happy with the preview." : "Publish becomes available when everything is ticked."}
            </p>
          </Panel>

          <Panel title="About the article">
            <Field
              group
              label="Web address"
              hint={slugAuto ? "Filled in from the title. You can change it." : "Lowercase letters, numbers and hyphens."}
            >
              <div className="flex gap-1">
                <span className="self-center text-sm whitespace-nowrap text-zinc-400">…/blog/</span>
                <input
                  className="field font-mono text-sm"
                  value={fields.slug.startsWith(PLACEHOLDER_SLUG_PREFIX) ? "" : fields.slug}
                  placeholder="appears when you type a title"
                  onChange={(e) => {
                    setSlugAuto(false);
                    set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"));
                  }}
                  aria-label="Web address"
                />
                <button
                  type="button"
                  className="btn-secondary px-2 text-sm"
                  onClick={() => {
                    if (slugify(fields.title).length >= 3) set("slug", slugify(fields.title));
                    setSlugAuto(!published);
                  }}
                  title="Make it from the title again"
                >
                  ↻
                </button>
              </div>
              {published && meta.publishedSlug !== fields.slug && (
                <span className="mt-1 block text-sm text-amber-700">Publishing moves the article: links to the old address /blog/{meta.publishedSlug}/ stop working.</span>
              )}
            </Field>
            <Field label="Type of article">
              <select className="field" value={fields.category} onChange={(e) => set("category", e.target.value as Category)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </Field>
            <Field label="Short summary" hint={`${fields.excerpt.length}/300 · shown on the blog page, in Google and when the link is shared`}>
              <textarea className="field min-h-28" maxLength={300} value={fields.excerpt} onChange={(e) => set("excerpt", e.target.value)} placeholder="One or two sentences that make people want to read on." />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Author">
                <input className="field" value={fields.authorName} onChange={(e) => set("authorName", e.target.value)} />
              </Field>
              <Field label="Date" hint={fields.date ? undefined : "Today, when published"}>
                <input className="field" type="date" value={fields.date ?? ""} onChange={(e) => set("date", e.target.value || null)} />
              </Field>
            </div>
            <Field label="Tags" hint="Separate with commas, e.g. webshop, automation">
              <input
                className="field"
                defaultValue={fields.tags.join(", ")}
                onBlur={(e) => set("tags", [...new Set(e.target.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))])}
              />
            </Field>
          </Panel>

          <Panel title="Languages" note="Write in English. The website translates it automatically into every language you tick.">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="btn-secondary px-2.5 py-1 text-sm" onClick={() => set("langs", [...LANGS])} disabled={fields.langs.length === LANGS.length}>
                Select all
              </button>
              <button type="button" className="btn-secondary px-2.5 py-1 text-sm" onClick={() => set("langs", [...DEFAULT_LANGS])}>
                EN · NL · FR
              </button>
              <button type="button" className="btn-secondary px-2.5 py-1 text-sm" onClick={() => set("langs", ["en"])} disabled={fields.langs.length === 1}>
                English only
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
              {LANGS.map((l) => (
                <label key={l} className="flex items-center gap-2 text-[15px]">
                  <input
                    type="checkbox"
                    className="size-4"
                    disabled={l === "en"}
                    title={l === "en" ? "The language you write in; always published" : undefined}
                    checked={l === "en" || fields.langs.includes(l)}
                    onChange={(e) => set("langs", e.target.checked ? LANGS.filter((x) => x === l || fields.langs.includes(x)) : fields.langs.filter((x) => x !== l))}
                  />
                  {LANG_NAMES[l]}
                </label>
              ))}
            </div>
            <p className="text-sm text-zinc-500">
              {new Set(["en", ...fields.langs]).size} of {LANGS.length} languages. Machine translation is good but not perfect: ask a native speaker to check important articles.
            </p>
          </Panel>

          <Panel title="Cover picture" note="Shown at the top of the article, on the blog page and when the link is shared.">
            {fields.coverKey ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(fields.coverKey)} alt={fields.coverAlt} className="aspect-[16/9] w-full rounded-md object-cover" />
                <Field label="Describe the picture" hint="For blind visitors and Google, e.g. “Laptop showing a webshop checkout”">
                  <input className="field" value={fields.coverAlt} onChange={(e) => set("coverAlt", e.target.value)} />
                </Field>
                <button className="text-sm text-red-700 hover:underline" onClick={() => set("coverKey", null)}>Remove picture</button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-zinc-300 px-3 py-8 text-[15px] text-zinc-600 hover:bg-zinc-50">
                <span className="text-2xl" aria-hidden="true">🖼</span>
                {uploading ? "Uploading…" : "Choose a picture"}
                <span className="text-sm text-zinc-400">Landscape works best</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden onChange={(e) => e.target.files && uploadInto(e.target.files, "cover")} />
              </label>
            )}
          </Panel>

          <Panel title="Video (optional)" note="Put the video on YouTube or Vimeo first, then paste its link here.">
            <Field label="Video link">
              <input className="field" placeholder="https://www.youtube.com/watch?v=…" value={video?.url ?? ""} onChange={(e) => setVideo({ url: e.target.value })} />
            </Field>
            {video?.url && (
              <>
                <Field label="Shape">
                  <select className="field" value={video.aspect} onChange={(e) => setVideo({ aspect: e.target.value as ArticleVideo["aspect"] })}>
                    {VIDEO_ASPECTS.map((a) => (
                      <option key={a} value={a}>{a === "9:16" ? "Tall (Reels / TikTok / Shorts)" : a === "1:1" ? "Square" : "Wide (normal video)"}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Picture shown before playing" group>
                  <label className="btn-secondary w-full cursor-pointer text-sm">
                    {video.poster ? "Replace picture" : "Choose a picture"}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden onChange={(e) => e.target.files && uploadInto(e.target.files, "poster")} />
                  </label>
                </Field>
                <Field label="Made by" hint="Collaborations: the partner's name or @handle">
                  <input className="field" value={video.creator ?? ""} onChange={(e) => setVideo({ creator: e.target.value || undefined })} />
                </Field>
                <Field label="Original post link">
                  <input className="field" placeholder="https://www.instagram.com/p/…" value={video.sourceUrl ?? ""} onChange={(e) => setVideo({ sourceUrl: e.target.value || undefined })} />
                </Field>
                <button className="text-sm text-red-700 hover:underline" onClick={() => set("video", null)}>Remove video</button>
              </>
            )}
          </Panel>

          {meta.publishedCommit && (
            <p className="px-1 text-sm text-zinc-500">
              Last change sent to the website:{" "}
              <a className="underline" target="_blank" rel="noreferrer" href={`https://github.com/${repo}/commit/${meta.publishedCommit}`}>
                {meta.publishedCommit.slice(0, 7)}
              </a>
              {initial.publishedBy && ` by ${initial.publishedBy}`}
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

function SaveIndicator({ state, dirty }: { state: SaveState; dirty: boolean }) {
  if (state.state === "saving") return <span className="text-sm text-zinc-500">Saving…</span>;
  if (state.state === "error")
    return (
      <span className="max-w-xs truncate text-sm text-red-700" title={state.error}>
        ⚠ Not saved: {state.error}
      </span>
    );
  if (dirty) return <span className="text-sm text-zinc-500">Unsaved changes</span>;
  return <span className="text-sm text-emerald-700">✓ Draft saved</span>;
}

function Tool({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="rounded px-2 py-1 text-sm text-zinc-700 hover:bg-zinc-100">
      {children}
    </button>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {note && <p className="-mt-2 text-sm text-zinc-500">{note}</p>}
      {children}
    </section>
  );
}

/** A <label> around its control, so clicking the text focuses it and screen readers announce it.
 *  `group` for fields whose content has its own label (file pickers). */
function Field({ label, hint, group, children }: { label: string; hint?: string; group?: boolean; children: ReactNode }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-zinc-500">{hint}</span>}
    </Tag>
  );
}
