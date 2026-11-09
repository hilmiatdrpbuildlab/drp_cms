import Link from "next/link";

import { LANG_NAMES } from "@/lib/blog/contract";
import { getDb } from "@/lib/db";
import { getArticleEmailStats } from "@/lib/resend";
import { posts } from "@/lib/schema";

const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/** The most recent new-article emails, with how many people they reached. Slow-ish: wrapped in Suspense. */
export async function ArticleEmails() {
  let stats;
  try {
    stats = await getArticleEmailStats();
  } catch (e) {
    console.error("[insights] article email stats failed", e instanceof Error ? e.message : e);
    return <p className="p-6 text-sm text-red-700">Could not load the email results from Resend. Reload the page to try again.</p>;
  }
  if (stats.length === 0) return <p className="p-6 text-sm text-zinc-500">No new-article emails have been sent yet.</p>;

  const rows = await getDb().select({ id: posts.id, slug: posts.slug, publishedSlug: posts.publishedSlug, title: posts.title }).from(posts);
  const bySlug = new Map<string, { id: string; title: string }>();
  for (const p of rows) {
    bySlug.set(p.slug, p);
    if (p.publishedSlug) bySlug.set(p.publishedSlug, p);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Article</th>
            <th className="px-4 py-2.5 font-medium">Language</th>
            <th className="px-4 py-2.5 font-medium">Sent</th>
            <th className="px-4 py-2.5 text-right font-medium">Delivered</th>
            <th className="px-4 py-2.5 text-right font-medium">Opened</th>
            <th className="px-4 py-2.5 text-right font-medium">Clicked</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {stats.map((s) => {
            const post = bySlug.get(s.slug);
            return (
              <tr key={s.broadcastId} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5">
                  {post ? (
                    <Link href={`/blog/${post.id}`} className="font-medium hover:text-accent">
                      {post.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{s.slug}</span>
                  )}
                  <div className="text-xs text-zinc-400">/blog/{s.slug}/</div>
                </td>
                <td className="px-4 py-2.5 text-zinc-600">{LANG_NAMES[s.lang]}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">{s.sentAt ? fmt.format(new Date(s.sentAt)) : "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{s.delivered}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {s.opened} <span className="text-xs text-zinc-400">{pct(s.opened, s.delivered)}</span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {s.clicked} <span className="text-xs text-zinc-400">{pct(s.clicked, s.delivered)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
