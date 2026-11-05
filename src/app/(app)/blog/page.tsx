import { count, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { requireStaff } from "@/auth/server";
import { CATEGORY_LABELS } from "@/lib/blog/contract";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { blogComments, blogLikes, posts } from "@/lib/schema";
import { articleUrl } from "@/lib/site";

import { createPost } from "./actions";
import { NewArticleButton } from "./new-article-button";
import { StatusBadge } from "./status-badge";

export const metadata: Metadata = { title: "Articles" };

export default async function BlogList() {
  await requireStaff();
  const db = getDb();
  const [rows, likes, comments] = await Promise.all([
    db
      .select({
        id: posts.id,
        title: posts.title,
        category: posts.category,
        langs: posts.langs,
        publishedSlug: posts.publishedSlug,
        publishedAt: posts.publishedAt,
        updatedAt: posts.updatedAt,
        updatedBy: posts.updatedBy,
      })
      .from(posts)
      .orderBy(desc(posts.updatedAt)),
    db.select({ slug: blogLikes.slug, n: count() }).from(blogLikes).groupBy(blogLikes.slug),
    db.select({ slug: blogComments.slug, n: count() }).from(blogComments).where(eq(blogComments.status, "approved")).groupBy(blogComments.slug),
  ]);
  const likesBy = new Map(likes.map((r) => [r.slug, r.n]));
  const commentsBy = new Map(comments.map((r) => [r.slug, r.n]));
  const siteUrl = getEnv().SITE_URL;
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Articles</h1>
          <p className="mt-1 max-w-2xl text-base text-zinc-600">
            Write an article, save it as a draft as often as you like, and press <b>Publish</b> when it&apos;s ready.
            Drafts are only visible here.
          </p>
        </div>
        <form action={createPost}>
          <NewArticleButton />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-600">
          <p className="text-lg font-medium text-zinc-900">No articles yet</p>
          <p className="mt-1">Press “New article” to write the first one.</p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {rows.map((p) => {
            const slug = p.publishedSlug;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 hover:bg-zinc-50">
                <div className="min-w-0 flex-1 basis-72">
                  <Link href={`/blog/${p.id}`} className="text-base font-medium hover:text-accent">
                    {p.title || <span className="text-zinc-400 italic">Untitled article</span>}
                  </Link>
                  <div className="mt-0.5 text-sm text-zinc-500">
                    {CATEGORY_LABELS[p.category]} · {p.langs.length} {p.langs.length === 1 ? "language" : "languages"} · edited{" "}
                    {fmt.format(p.updatedAt)} by {p.updatedBy.split("@")[0]}
                  </div>
                </div>
                {slug && (
                  <div className="flex items-center gap-4 text-sm text-zinc-500" title="Likes and approved comments on the website">
                    <span>♥ {likesBy.get(slug) ?? 0}</span>
                    <span>💬 {commentsBy.get(slug) ?? 0}</span>
                  </div>
                )}
                <StatusBadge published={!!slug} dirty={!!p.publishedAt && p.updatedAt > p.publishedAt} />
                <div className="flex gap-2">
                  {slug && siteUrl && (
                    <a className="btn-secondary" href={articleUrl(siteUrl, slug)} target="_blank" rel="noreferrer">
                      View on website ↗
                    </a>
                  )}
                  <Link href={`/blog/${p.id}`} className="btn-secondary">
                    Edit
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
