import "server-only";

import { getDb } from "@/lib/db";
import { getArticleEmailStats, type ArticleEmailStats } from "@/lib/resend";
import { posts } from "@/lib/schema";

export type ArticleEmailRow = ArticleEmailStats & { postId: string | null; title: string | null };
export type ArticleEmailSnapshot = { fetchedAt: string; rows: ArticleEmailRow[] };

/** The recent new-article emails, live from Resend, with the CMS title of each article. */
export async function articleEmailSnapshot(): Promise<ArticleEmailSnapshot> {
  const stats = await getArticleEmailStats();
  const fetchedAt = new Date().toISOString();
  if (stats.length === 0) return { fetchedAt, rows: [] };

  const found = await getDb().select({ id: posts.id, slug: posts.slug, publishedSlug: posts.publishedSlug, title: posts.title }).from(posts);
  const bySlug = new Map<string, { id: string; title: string }>();
  for (const p of found) {
    bySlug.set(p.slug, p);
    if (p.publishedSlug) bySlug.set(p.publishedSlug, p);
  }
  return {
    fetchedAt,
    rows: stats.map((s) => {
      const post = bySlug.get(s.slug);
      return { ...s, postId: post?.id ?? null, title: post?.title ?? null };
    }),
  };
}
