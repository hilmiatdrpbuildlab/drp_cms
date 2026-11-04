import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { requireStaff } from "@/auth/server";
import { CATEGORY_LABELS } from "@/lib/blog/contract";
import { getDb } from "@/lib/db";
import { posts } from "@/lib/schema";

import { createPost } from "./actions";
import { NewArticleButton } from "./new-article-button";
import { StatusBadge } from "./status-badge";

export const metadata: Metadata = { title: "Blog" };

export default async function BlogList() {
  await requireStaff();
  const rows = await getDb()
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      category: posts.category,
      langs: posts.langs,
      authorName: posts.authorName,
      publishedSlug: posts.publishedSlug,
      publishedAt: posts.publishedAt,
      updatedAt: posts.updatedAt,
      updatedBy: posts.updatedBy,
    })
    .from(posts)
    .orderBy(desc(posts.updatedAt));

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Blog</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Drafts stay here. Publish commits the article to drp_compro, which builds and translates it for drpbuildlab.com/blog.
          </p>
        </div>
        <form action={createPost}>
          <NewArticleButton />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
          No articles yet. Start with “New article”.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Languages</th>
                <th className="px-4 py-2.5 font-medium">Last edited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link href={`/blog/${p.id}`} className="font-medium hover:text-accent">
                      {p.title}
                    </Link>
                    <div className="text-xs text-zinc-400">/blog/{p.slug}/</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge published={!!p.publishedSlug} dirty={!!p.publishedAt && p.updatedAt > p.publishedAt} />
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{CATEGORY_LABELS[p.category]}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500 uppercase">{p.langs.join(" ")}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {fmt.format(p.updatedAt)}
                    <div>{p.updatedBy}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
