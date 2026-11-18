import "server-only";

import { getDb } from "@/lib/db";
import { broadcastSlugKey } from "@/lib/insights/newsletter";
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
  // Keyed the way broadcast names carry a slug: a long slug is shortened there (broadcastSlugKey).
  const byKey = new Map<string, { id: string; title: string; slug: string }>();
  for (const p of found) {
    byKey.set(broadcastSlugKey(p.slug), p);
    if (p.publishedSlug) byKey.set(broadcastSlugKey(p.publishedSlug), { ...p, slug: p.publishedSlug });
  }
  return {
    fetchedAt,
    rows: stats.map((s) => {
      const post = byKey.get(s.slug);
      return { ...s, slug: post?.slug ?? s.slug, postId: post?.id ?? null, title: post?.title ?? null };
    }),
  };
}
