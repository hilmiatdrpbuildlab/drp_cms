import { and, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { requireStaff } from "@/auth/server";
import { LANG_NAMES, type Lang } from "@/lib/blog/contract";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { blogComments, posts } from "@/lib/schema";
import { articleUrl } from "@/lib/site";

import { CommentActions } from "./comment-actions";

export const metadata: Metadata = { title: "Comments" };

export default async function CommentsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireStaff();
  const show = (await searchParams).show === "approved" ? "approved" : "pending";
  const db = getDb();
  const rows = await db
    .select()
    .from(blogComments)
    .where(eq(blogComments.status, show))
    .orderBy(desc(blogComments.createdAt))
    .limit(200);
  const slugs = [...new Set(rows.map((r) => r.slug))];
  const articles = slugs.length
    ? await db.select({ id: posts.id, title: posts.title, slug: posts.publishedSlug }).from(posts).where(and(inArray(posts.publishedSlug, slugs)))
    : [];
  const bySlug = new Map(articles.map((a) => [a.slug!, a]));
  const siteUrl = getEnv().SITE_URL;
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Reader comments</h1>
      <p className="mt-1 text-base text-zinc-600">
        Visitors can comment on articles without an account. A new comment stays hidden until someone here approves it.
      </p>

      <div className="mt-6 mb-4 inline-flex rounded-lg border border-zinc-200 bg-white p-1 text-sm">
        <Link href="/comments" className={`rounded-md px-4 py-2 ${show === "pending" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
          Waiting for approval
        </Link>
        <Link href="/comments?show=approved" className={`rounded-md px-4 py-2 ${show === "approved" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
          On the website
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          {show === "pending" ? "No comments are waiting. Nice and tidy." : "No approved comments yet."}
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => {
            const article = bySlug.get(c.slug);
            return (
              <li key={c.id} className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-zinc-500">
                  <span className="text-base font-semibold text-zinc-900">{c.name}</span>
                  <span>{fmt.format(c.createdAt)}</span>
                  <span>wrote in {LANG_NAMES[c.lang as Lang] ?? c.lang}</span>
                </div>
                <p className="mt-2 text-base whitespace-pre-wrap text-zinc-800">{c.body}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-zinc-500">
                    On{" "}
                    {article ? (
                      <Link className="font-medium text-zinc-800 underline" href={`/blog/${article.id}`}>{article.title}</Link>
                    ) : (
                      <span className="font-mono">{c.slug}</span>
                    )}
                    {siteUrl && (
                      <>
                        {" · "}
                        <a className="underline" href={articleUrl(siteUrl, c.slug)} target="_blank" rel="noreferrer">view on website</a>
                      </>
                    )}
                  </span>
                  <CommentActions id={c.id} status={c.status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
