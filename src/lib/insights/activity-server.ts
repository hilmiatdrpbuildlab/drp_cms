import "server-only";

import { count, gte, isNotNull } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { getArticleEmailStats, resendConfigured } from "@/lib/resend";
import { blogComments, blogLikes, posts } from "@/lib/schema";

import type { ArticleActivity } from "./activity";

/**
 * Likes, comments and email clicks for every article on the site. Email clicks cover only the
 * recent new-article emails and need click tracking in Resend; without it they stay 0.
 */
export async function articleActivity(): Promise<{ articles: ArticleActivity[]; emailClicksAvailable: boolean }> {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [published, likes, recentLikes, comments, stats] = await Promise.all([
    db
      .select({ id: posts.id, slug: posts.publishedSlug, title: posts.title, tags: posts.tags })
      .from(posts)
      .where(isNotNull(posts.publishedSlug)),
    db.select({ slug: blogLikes.slug, n: count() }).from(blogLikes).groupBy(blogLikes.slug),
    db.select({ slug: blogLikes.slug, n: count() }).from(blogLikes).where(gte(blogLikes.createdAt, since)).groupBy(blogLikes.slug),
    db.select({ slug: blogComments.slug, status: blogComments.status, n: count() }).from(blogComments).groupBy(blogComments.slug, blogComments.status),
    resendConfigured() ? getArticleEmailStats().catch(() => null) : Promise.resolve(null),
  ]);

  const bySlug = <T extends { slug: string; n: number }>(rows: T[]) => new Map(rows.map((r) => [r.slug, Number(r.n)]));
  const likeMap = bySlug(likes);
  const recentMap = bySlug(recentLikes);
  const approved = bySlug(comments.filter((c) => c.status === "approved"));
  const pending = bySlug(comments.filter((c) => c.status === "pending"));
  const clicks = new Map<string, number>();
  for (const s of stats ?? []) clicks.set(s.slug, (clicks.get(s.slug) ?? 0) + s.clicked);

  const articles = published.map((p) => {
    const slug = p.slug!;
    return {
      id: p.id,
      slug,
      title: p.title,
      tags: p.tags,
      likes: likeMap.get(slug) ?? 0,
      likesLast30Days: recentMap.get(slug) ?? 0,
      comments: approved.get(slug) ?? 0,
      pendingComments: pending.get(slug) ?? 0,
      emailClicks: clicks.get(slug) ?? 0,
    };
  });
  articles.sort((a, b) => b.likes + b.comments + b.emailClicks - (a.likes + a.comments + a.emailClicks) || a.title.localeCompare(b.title));
  return { articles, emailClicksAvailable: !!stats };
}

