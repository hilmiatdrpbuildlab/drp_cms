import type { Metadata } from "next";
import Link from "next/link";

import { requireStaff } from "@/auth/server";
import { activityByTag } from "@/lib/insights/activity";
import { articleActivity } from "@/lib/insights/activity-server";

import { InsightsTabs } from "../tabs";

export const metadata: Metadata = { title: "Reader activity" };

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** A number with a thin bar behind it, scaled to the column's largest value. */
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-20 rounded-r bg-zinc-100 sm:block">
        <span className="block h-full rounded-r bg-accent" style={{ width: max ? `${(value / max) * 100}%` : 0 }} />
      </span>
      <span className="w-8 text-right tabular-nums">{value}</span>
    </div>
  );
}

const th = "px-4 py-2.5 font-medium";

export default async function ReaderActivity() {
  await requireStaff();
  const { articles, emailClicksAvailable } = await articleActivity();
  const tags = activityByTag(articles);
  const sum = (k: "likes" | "likesLast30Days" | "comments" | "pendingComments" | "emailClicks") => articles.reduce((n, a) => n + a[k], 0);
  const maxTagLikes = Math.max(0, ...tags.map((t) => t.likes));
  const maxLikes = Math.max(0, ...articles.map((a) => a.likes));

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="mt-1 text-sm text-zinc-500">
          What readers respond to on drpbuildlab.com. Likes and comments are anonymous, so this shows which topics interest readers, not who
          they are. Use it to choose the tags for an offer.
        </p>
      </div>
      <InsightsTabs active="activity" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Likes" value={sum("likes")} hint={`${sum("likesLast30Days")} in the last 30 days`} />
        <Stat label="Comments on the site" value={sum("comments")} />
        <Stat label="Comments waiting" value={sum("pendingComments")} hint="Approve them under Comments" />
        <Stat label="Email clicks" value={sum("emailClicks")} hint={emailClicksAvailable ? "Recent article emails" : "Resend not connected"} />
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white">
        <header className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold">By tag</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Each article counts toward every tag it has. Most active first.</p>
        </header>
        {tags.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">No published article has tags yet. Add tags in the article editor to see interests here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className={th}>Tag</th>
                  <th className={`${th} text-right`}>Articles</th>
                  <th className={`${th} text-right`}>Likes</th>
                  <th className={`${th} text-right`}>Comments</th>
                  <th className={`${th} text-right`}>Email clicks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {tags.map((t) => (
                  <tr key={t.tag} className="hover:bg-zinc-50">
                    <td className="px-4 py-2.5 font-medium">{t.tag}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{t.articles}</td>
                    <td className="px-4 py-2.5">
                      <Bar value={t.likes} max={maxTagLikes} />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{t.comments}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{t.emailClicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white">
        <header className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold">By article</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Articles on the website. Comments count approved ones; waiting ones are in brackets.</p>
        </header>
        {articles.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">No article is on the website yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className={th}>Article</th>
                  <th className={th}>Tags</th>
                  <th className={`${th} text-right`}>Likes</th>
                  <th className={`${th} text-right`}>Last 30 days</th>
                  <th className={`${th} text-right`}>Comments</th>
                  <th className={`${th} text-right`}>Email clicks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {articles.map((a) => (
                  <tr key={a.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/blog/${a.id}`} className="font-medium hover:text-accent">
                        {a.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500">{a.tags.join(", ") || "—"}</td>
                    <td className="px-4 py-2.5">
                      <Bar value={a.likes} max={maxLikes} />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{a.likesLast30Days}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {a.comments}
                      {a.pendingComments > 0 && <span className="ml-1 text-xs text-amber-700">(+{a.pendingComments})</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a.emailClicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
