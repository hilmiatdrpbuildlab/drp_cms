"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";

import {
  CATEGORIES,
  CATEGORY_LABELS,
  LANG_NAMES,
  LANGS,
  slugify,
  VIDEO_ASPECTS,
  type ArticleVideo,
  type Category,
  type Lang,
} from "@/lib/blog/contract";
import { mediaUrl } from "@/lib/blog/publish-plan";

import { deletePost, publishPost, savePost, unpublishPost, type SaveInput } from "../actions";
import { StatusBadge } from "../status-badge";
import { Preview } from "./preview";

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

export function Editor({ initial, repo, branch, canPublish }: { initial: EditorPost; repo: string; branch: string; canPublish: boolean }) {
  const [fields, setFields] = useState<Fields>(() => fieldsOf(initial));
  const [saved, setSaved] = useState<Fields>(() => fieldsOf(initial));
  const [meta, setMeta] = useState(() => ({
    updatedAt: initial.updatedAt,
    publishedSlug: initial.publishedSlug,
    publishedAt: initial.publishedAt,
    publishedCommit: initial.publishedCommit,
  }));
  const [view, setView] = useState<"write" | "split" | "preview">("split");
  const [message, setMessage] = useState<Message | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const dirty = useMemo(() => JSON.stringify(fields) !== JSON.stringify(saved), [fields, saved]);
  const published = !!meta.publishedSlug;
  const liveIsStale = published && !!meta.publishedAt && (dirty || meta.updatedAt > meta.publishedAt);
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((f) => ({ ...f, [key]: value }));

  // ---- save / publish ---------------------------------------------------------------------------
  const save = useCallback(async (): Promise<boolean> => {
    const input: SaveInput = { id: initial.id, expectedUpdatedAt: meta.updatedAt, ...fields, video: fields.video?.url ? fields.video : null };
    const res = await savePost(input);
    if (!res.ok) {
      setMessage({ tone: "error", text: res.error, list: res.errors });
      return false;
    }
    setSaved(fields);
    setMeta((m) => ({ ...m, updatedAt: res.updatedAt }));
    return true;
  }, [fields, initial.id, meta.updatedAt]);

  const onSave = () =>
    startTransition(async () => {
      if (await save()) setMessage({ tone: "ok", text: "Saved. Not on the site until you publish." });
    });

  const onPublish = () =>
    startTransition(async () => {
      if (dirty && !(await save())) return;
      const res = await publishPost(initial.id);
      if (!res.ok) return setMessage({ tone: "error", text: res.error, list: res.errors });
      const nextFields = { ...fields, date: res.date };
      setFields(nextFields);
      setSaved(nextFields);
      setMeta({ updatedAt: res.updatedAt, publishedSlug: fields.slug, publishedAt: res.updatedAt, publishedCommit: res.commitUrl.split("/").pop()! });
      setMessage({
        tone: "ok",
        text: "Committed to drp_compro. The site's build translates it and deploys it in a few minutes.",
        href: res.commitUrl,
      });
    });

  const onUnpublish = () => {
    if (!confirm("Take this article off drpbuildlab.com? It stays here as a draft.")) return;
    startTransition(async () => {
      const res = await unpublishPost(initial.id);
      if (!res.ok) return setMessage({ tone: "error", text: res.error });
      setMeta((m) => ({ ...m, updatedAt: res.updatedAt, publishedSlug: null }));
      setMessage({ tone: "ok", text: "Removed from the site (on the next build). The draft is kept.", href: res.commitUrl });
    });
  };

  const onDelete = () => {
    if (!confirm("Delete this draft and its images for good?")) return;
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

  // ---- markdown helpers -------------------------------------------------------------------------
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

  const uploadInto = async (files: FileList | File[], target: "body" | "cover" | "poster") => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setUploading(true);
    setMessage(null);
    try {
      for (const file of list) {
        const { key, url } = await uploadImage(initial.id, file);
        const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
        if (target === "cover") setFields((f) => ({ ...f, coverKey: key, coverAlt: f.coverAlt || alt }));
        else if (target === "poster") setFields((f) => ({ ...f, video: { ...(f.video ?? { url: "", aspect: "16:9" }), poster: url } }));
        else insert(`\n![${alt}](${url})\n`);
      }
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setUploading(false);
    }
  };

  const video = fields.video;
  const setVideo = (patch: Partial<ArticleVideo>) =>
    set("video", { ...(video ?? { url: "", aspect: "16:9" as const }), ...patch });

  // ---- render -----------------------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      {/* Action bar, with the latest result under it so it stays visible while scrolled */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/blog" className="text-sm text-zinc-500 hover:text-zinc-900">← All articles</Link>
        <StatusBadge published={published} dirty={liveIsStale} />
        {dirty && <span className="text-xs text-zinc-500">Unsaved changes</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {!published && (
            <button className="btn-danger" onClick={onDelete} disabled={pending}>Delete</button>
          )}
          {published && (
            <button className="btn-secondary" onClick={onUnpublish} disabled={pending || !canPublish}>Unpublish</button>
          )}
          <button className="btn-secondary" onClick={onSave} disabled={pending || !dirty} title="Ctrl+S">
            Save draft
          </button>
          <button
            className="btn-primary"
            onClick={onPublish}
            disabled={pending || !canPublish || (published && !liveIsStale)}
            title={canPublish ? `Commits content/blog/${fields.slug}.md to ${repo}@${branch}` : "GITHUB_TOKEN is not configured"}
          >
            {pending ? "Working…" : published ? "Publish changes" : "Publish"}
          </button>
        </div>
      </div>

      {message && (
        <div
          role={message.tone === "error" ? "alert" : "status"}
          className={`mt-3 max-h-48 overflow-auto rounded-lg px-4 py-3 text-sm ${message.tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"}`}
        >
          <div className="flex items-start justify-between gap-4">
            <p>
              {message.text}{" "}
              {message.href && (
                <a href={message.href} target="_blank" rel="noreferrer" className="font-medium underline">View commit</a>
              )}
            </p>
            <button className="text-xs opacity-60 hover:opacity-100" onClick={() => setMessage(null)} aria-label="Dismiss">✕</button>
          </div>
          {message.list && message.list.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">{message.list.map((m) => <li key={m}>{m}</li>)}</ul>
          )}
        </div>
      )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Writing area */}
        <section className="min-w-0">
          <input
            className="mb-3 w-full bg-transparent text-3xl font-semibold outline-none placeholder:text-zinc-300"
            placeholder="Article title"
            value={fields.title}
            onChange={(e) => set("title", e.target.value)}
            aria-label="Title"
          />

          <div className="rounded-xl border border-zinc-200 bg-white">
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
              <label className="cursor-pointer rounded px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100">
                {uploading ? "Uploading…" : "Image"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" multiple hidden onChange={(e) => e.target.files && uploadInto(e.target.files, "body")} />
              </label>
              <div className="ml-auto flex rounded-md border border-zinc-200 text-xs">
                {(["write", "split", "preview"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 capitalize ${view === v ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className={view === "split" ? "grid lg:grid-cols-2" : ""}>
              {view !== "preview" && (
                <textarea
                  ref={textarea}
                  className="min-h-[65vh] w-full resize-y border-0 p-4 font-mono text-sm leading-relaxed outline-none"
                  placeholder={"Write in Markdown.\n\n## A heading\n\nParagraphs, **bold**, [links](https://…), lists, code blocks.\nPaste or drop images to upload them."}
                  value={fields.body}
                  onChange={(e) => set("body", e.target.value)}
                  onPaste={(e) => {
                    if (e.clipboardData.files.length) {
                      e.preventDefault();
                      uploadInto(e.clipboardData.files, "body");
                    }
                  }}
                  onDrop={(e) => {
                    if (e.dataTransfer.files.length) {
                      e.preventDefault();
                      uploadInto(e.dataTransfer.files, "body");
                    }
                  }}
                  spellCheck
                />
              )}
              {view !== "write" && (
                <div className={`min-h-[65vh] overflow-auto p-4 ${view === "split" ? "border-t border-zinc-200 lg:border-t-0 lg:border-l" : ""}`}>
                  <Preview title={fields.title} body={fields.body} coverUrl={fields.coverKey ? mediaUrl(fields.coverKey) : null} coverAlt={fields.coverAlt} video={video?.url ? video : null} />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Metadata */}
        <aside className="space-y-4">
          <Panel title="Article">
            <Field label="Slug (URL)" hint={`drpbuildlab.com/…/blog/${fields.slug}/`}>
              <div className="flex gap-1">
                <input className="field font-mono text-xs" value={fields.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} />
                <button type="button" className="btn-secondary px-2 text-xs" onClick={() => set("slug", slugify(fields.title))} title="Generate from title">
                  ↻
                </button>
              </div>
              {published && meta.publishedSlug !== fields.slug && (
                <p className="mt-1 text-xs text-amber-700">Publishing moves the article: the old URL /blog/{meta.publishedSlug}/ stops working.</p>
              )}
            </Field>
            <Field label="Type">
              <select className="field" value={fields.category} onChange={(e) => set("category", e.target.value as Category)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </Field>
            <Field label="Excerpt" hint={`${fields.excerpt.length}/300 · shown on the blog index and in search results`}>
              <textarea className="field min-h-24" maxLength={300} value={fields.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Author">
                <input className="field" value={fields.authorName} onChange={(e) => set("authorName", e.target.value)} />
              </Field>
              <Field label="Date" hint={fields.date ? undefined : "Set on publish"}>
                <input className="field" type="date" value={fields.date ?? ""} onChange={(e) => set("date", e.target.value || null)} />
              </Field>
            </div>
            <Field label="Tags" hint="Comma-separated">
              <input
                className="field"
                defaultValue={fields.tags.join(", ")}
                onBlur={(e) => set("tags", [...new Set(e.target.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))])}
              />
            </Field>
          </Panel>

          <Panel title="Languages" note="Write in English: it is always published, and the site's build machine-translates it (DeepL) into each other language you tick. Have translations reviewed.">
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {LANGS.map((l) => (
                <label key={l} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={l === "en"}
                    title={l === "en" ? "The source language; always published" : undefined}
                    checked={l === "en" || fields.langs.includes(l)}
                    onChange={(e) => set("langs", e.target.checked ? LANGS.filter((x) => x === l || fields.langs.includes(x)) : fields.langs.filter((x) => x !== l))}
                  />
                  {LANG_NAMES[l]}
                </label>
              ))}
            </div>
          </Panel>

          <Panel title="Cover image">
            {fields.coverKey ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(fields.coverKey)} alt={fields.coverAlt} className="aspect-[16/9] w-full rounded-md object-cover" />
                <Field label="Alt text">
                  <input className="field" value={fields.coverAlt} onChange={(e) => set("coverAlt", e.target.value)} />
                </Field>
                <button className="text-xs text-red-700 hover:underline" onClick={() => set("coverKey", null)}>Remove cover</button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-zinc-300 px-3 py-6 text-sm text-zinc-500 hover:bg-zinc-50">
                {uploading ? "Uploading…" : "Upload cover (16:9 works best)"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden onChange={(e) => e.target.files && uploadInto(e.target.files, "cover")} />
              </label>
            )}
          </Panel>

          <Panel title="Video" note="Host videos on YouTube, Vimeo or a video CDN and paste the link. The site loads it only after the visitor clicks (cookie consent).">
            <Field label="Video URL">
              <input className="field" placeholder="https://www.youtube.com/watch?v=…" value={video?.url ?? ""} onChange={(e) => setVideo({ url: e.target.value })} />
            </Field>
            {video?.url && (
              <>
                <Field label="Format">
                  <select className="field" value={video.aspect} onChange={(e) => setVideo({ aspect: e.target.value as ArticleVideo["aspect"] })}>
                    {VIDEO_ASPECTS.map((a) => (
                      <option key={a} value={a}>{a === "9:16" ? "9:16 (Reels / TikTok / Shorts)" : a === "1:1" ? "1:1 (square)" : "16:9 (landscape)"}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Poster image">
                  <label className="btn-secondary w-full cursor-pointer text-xs">
                    {video.poster ? "Replace poster" : "Upload poster"}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden onChange={(e) => e.target.files && uploadInto(e.target.files, "poster")} />
                  </label>
                </Field>
                <Field label="Creator" hint="Collab articles: the partner's name or @handle">
                  <input className="field" value={video.creator ?? ""} onChange={(e) => setVideo({ creator: e.target.value || undefined })} />
                </Field>
                <Field label="Original post URL">
                  <input className="field" placeholder="https://www.instagram.com/p/…" value={video.sourceUrl ?? ""} onChange={(e) => setVideo({ sourceUrl: e.target.value || undefined })} />
                </Field>
                <button className="text-xs text-red-700 hover:underline" onClick={() => set("video", null)}>Remove video</button>
              </>
            )}
          </Panel>

          {meta.publishedCommit && (
            <p className="px-1 text-xs text-zinc-500">
              Last site change:{" "}
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

function Tool({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="rounded px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100">
      {children}
    </button>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="-mt-2 text-xs text-zinc-500">{note}</p>}
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs break-all text-zinc-400">{hint}</p>}
    </div>
  );
}
