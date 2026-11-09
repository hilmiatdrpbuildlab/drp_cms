/**
 * Reader activity per article and per tag: likes and comments on drpbuildlab.com (anonymous:
 * blog_likes keeps a random browser id, blog_comments a typed name) and clicks in our article
 * emails. None of it identifies a subscriber, so it describes what readers care about, not who.
 *
 * Pure module (no server/DB imports) so it can be unit-tested with `node --test`.
 */

export type ArticleActivity = {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  likes: number;
  likesLast30Days: number;
  comments: number;
  pendingComments: number;
  /** People who clicked the article in our new-article emails (recent emails only). */
  emailClicks: number;
};

export type TagActivity = { tag: string; articles: number; likes: number; comments: number; emailClicks: number };

/** Sums articles per tag (lower-cased), most active first: likes + comments + email clicks, then name. */
export function activityByTag(articles: ArticleActivity[]): TagActivity[] {
  const byTag = new Map<string, TagActivity>();
  for (const a of articles) {
    for (const raw of new Set(a.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))) {
      const t = byTag.get(raw) ?? { tag: raw, articles: 0, likes: 0, comments: 0, emailClicks: 0 };
      t.articles++;
      t.likes += a.likes;
      t.comments += a.comments;
      t.emailClicks += a.emailClicks;
      byTag.set(raw, t);
    }
  }
  const score = (t: TagActivity) => t.likes + t.comments + t.emailClicks;
  return [...byTag.values()].sort((a, b) => score(b) - score(a) || a.tag.localeCompare(b.tag));
}

/** "3 likes · 1 comment", or "" when there is nothing yet. For the offer editor's tag picker. */
export function activityLabel(t: Pick<TagActivity, "likes" | "comments" | "emailClicks">): string {
  const parts = [
    t.likes ? `${t.likes} like${t.likes === 1 ? "" : "s"}` : "",
    t.comments ? `${t.comments} comment${t.comments === 1 ? "" : "s"}` : "",
    t.emailClicks ? `${t.emailClicks} email click${t.emailClicks === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
